import { randomBytes, randomUUID } from 'node:crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { DomainError, roles, type User } from './domain.js';

const yearLevelEntries: Array<[string, string]> = [
  ['K', 'K'],
  ['KINDERGARTEN', 'K'],
];
for (let index = 1; index <= 12; index += 1) {
  const number = String(index);
  yearLevelEntries.push(
    [`${number}`, number],
    [`G${number}`, number],
    [`GRADE${number}`, number],
    [`GRADE ${number}`, number],
    [`YEAR${number}`, number],
    [`YEAR ${number}`, number],
  );
}
const YEAR_LEVEL_ALIASES = new Map<string, string>(yearLevelEntries);

export type QrCredentialStatus = 'ACTIVE' | 'REVOKED';

export interface StudentRecord {
  id: string;
  studentId: string;
  name: string;
  yearLevel: string;
  course: string | null;
  section: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QrCredential {
  id: string;
  studentId: string;
  token: string;
  status: QrCredentialStatus;
  createdAt: string;
  revokedAt: string | null;
  replacedByCredentialId: string | null;
}

export interface ImportRowError {
  field: 'student_id' | 'name' | 'year_level' | 'file';
  code: string;
  message: string;
}

export interface MasterlistPreviewRow {
  rowNumber: number;
  studentId: string;
  name: string;
  yearLevel: string;
  course: string;
  section: string;
  errors: ImportRowError[];
}

export interface MasterlistPreview {
  id: string;
  filename: string;
  createdById: string;
  createdAt: string;
  headers: string[];
  rows: MasterlistPreviewRow[];
  fileErrors: ImportRowError[];
  canImport: boolean;
}

type ParsedRow = Record<string, string>;

function now(): string {
  return new Date().toISOString();
}

function studentKey(studentId: string): string {
  return studentId.trim().toUpperCase();
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function canonicalHeader(value: unknown): string {
  const normalized = normalizeHeader(value);
  if (['student_id', 'studentid', 'id', 'student_number', 'student_no'].includes(normalized))
    return 'student_id';
  if (['name', 'student_name', 'full_name', 'display_name'].includes(normalized)) return 'name';
  if (['course', 'program', 'strand'].includes(normalized)) return 'course';
  if (['section', 'class_section', 'class'].includes(normalized)) return 'section';
  if (
    ['year_level', 'yearlevel', 'year', 'grade', 'grade_level', 'gradelevel'].includes(normalized)
  )
    return 'year_level';
  return normalized;
}

function cellToString(value: unknown): string {
  return String(value ?? '').trim();
}

function parseCsvFile(buffer: Buffer): { headers: string[]; rows: ParsedRow[] } {
  const rows = parseCsv(buffer.toString('utf8'), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false,
  }) as Array<Record<string, unknown>>;
  const firstRow = rows[0];
  if (!firstRow) return { headers: [], rows: [] };
  const originalHeaders = Object.keys(firstRow);
  const headers = originalHeaders.map(canonicalHeader);
  const parsedRows = rows.map((row) =>
    Object.fromEntries(
      originalHeaders.map((header, index) => [headers[index]!, cellToString(row[header])]),
    ),
  ) as ParsedRow[];
  return { headers, rows: parsedRows };
}

function parseWorkbookFile(buffer: Buffer): { headers: string[]; rows: ParsedRow[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return { headers: [], rows: [] };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const firstRow = matrix[0] ?? [];
  const headers = firstRow.map(canonicalHeader);
  const rows = matrix
    .slice(1)
    .map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, cellToString(row[index])])),
    ) as ParsedRow[];
  return { headers, rows };
}

function parseFile(filename: string, buffer: Buffer): { headers: string[]; rows: ParsedRow[] } {
  const extension = filename.toLowerCase().split('.').pop();
  if (extension === 'csv') return parseCsvFile(buffer);
  if (extension === 'xlsx' || extension === 'xls') return parseWorkbookFile(buffer);
  throw new DomainError('UNSUPPORTED_FILE_TYPE', 400, 'Upload a CSV or XLSX file.');
}

function normalizeYearLevel(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/\s+/g, ' ');
  return YEAR_LEVEL_ALIASES.get(compact) ?? null;
}

function publicCredential(credential: QrCredential | undefined) {
  if (!credential) return null;
  return {
    id: credential.id,
    status: credential.status,
    createdAt: credential.createdAt,
    revokedAt: credential.revokedAt,
  };
}

export function publicStudent(student: StudentRecord, credential: QrCredential | undefined) {
  return { ...student, qrCredential: publicCredential(credential) };
}

export class StudentService {
  readonly students = new Map<string, StudentRecord>();
  readonly credentials = new Map<string, QrCredential>();
  readonly previews = new Map<string, MasterlistPreview>();
  private catalogVersion = 1;

  constructor(private readonly requireManager: (user: User) => void) {}

  previewMasterlist(user: User, filename: string, buffer: Buffer): MasterlistPreview {
    this.requireManager(user);
    const preview: MasterlistPreview = {
      id: randomUUID(),
      filename,
      createdById: user.id,
      createdAt: now(),
      headers: [],
      rows: [],
      fileErrors: [],
      canImport: false,
    };
    try {
      const parsed = parseFile(filename, buffer);
      preview.headers = parsed.headers;
      const requiredHeaders = ['student_id', 'name', 'year_level'];
      const missingHeaders = requiredHeaders.filter(
        (required) => !parsed.headers.includes(required),
      );
      if (missingHeaders.length) {
        preview.fileErrors.push({
          field: 'file',
          code: 'INVALID_FILE_STRUCTURE',
          message: `Missing required column(s): ${missingHeaders.join(', ')}.`,
        });
      }
      if (!parsed.headers.length)
        preview.fileErrors.push({
          field: 'file',
          code: 'EMPTY_FILE',
          message: 'The file has no header row or data.',
        });
      if (new Set(parsed.headers).size !== parsed.headers.length)
        preview.fileErrors.push({
          field: 'file',
          code: 'DUPLICATE_COLUMN',
          message: 'The file contains duplicate column names after normalization.',
        });
      preview.rows = parsed.rows.map((row, index) =>
        this.validateRow(row, index + 2, parsed.headers),
      );
      const seen = new Map<string, number>();
      for (const row of preview.rows) {
        const key = studentKey(row.studentId);
        if (!key) continue;
        const firstRow = seen.get(key);
        if (firstRow) {
          row.errors.push({
            field: 'student_id',
            code: 'DUPLICATE_STUDENT_ID',
            message: `Student ID duplicates row ${firstRow} in this file.`,
          });
        } else {
          seen.set(key, row.rowNumber);
        }
        if (this.students.has(key))
          row.errors.push({
            field: 'student_id',
            code: 'STUDENT_ID_ALREADY_EXISTS',
            message: 'Student ID already exists in the masterlist.',
          });
      }
    } catch (error) {
      if (error instanceof DomainError)
        preview.fileErrors.push({ field: 'file', code: error.code, message: error.message });
      else
        preview.fileErrors.push({
          field: 'file',
          code: 'INVALID_FILE_STRUCTURE',
          message: 'The file could not be parsed. Check its structure and encoding.',
        });
    }
    preview.canImport =
      preview.fileErrors.length === 0 &&
      preview.rows.length > 0 &&
      preview.rows.every((row) => row.errors.length === 0);
    this.previews.set(preview.id, preview);
    return preview;
  }

  importPreview(user: User, previewId: string): StudentRecord[] {
    this.requireManager(user);
    const preview = this.previews.get(previewId);
    if (!preview || preview.createdById !== user.id)
      throw new DomainError('PREVIEW_NOT_FOUND', 404, 'Import preview was not found.');
    if (!preview.canImport)
      throw new DomainError('PREVIEW_HAS_ERRORS', 400, 'Fix all preview errors before importing.');
    const imported: StudentRecord[] = [];
    for (const row of preview.rows) {
      const timestamp = now();
      const student: StudentRecord = {
        id: randomUUID(),
        studentId: row.studentId,
        name: row.name,
        yearLevel: row.yearLevel,
        course: row.course || null,
        section: row.section || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.students.set(studentKey(student.studentId), student);
      const credential = this.issueQrCredential(student.id);
      this.credentials.set(credential.id, credential);
      imported.push(student);
    }
    this.previews.delete(previewId);
    this.catalogVersion += 1;
    return imported;
  }

  search(
    user: User,
    query: string,
    filters: { yearLevel?: string; course?: string; section?: string } = {},
  ): Array<ReturnType<typeof publicStudent>> {
    this.requireManager(user);
    const needle = query.trim().toLowerCase();
    return [...this.students.values()]
      .filter(
        (student) =>
          !needle ||
          student.studentId.toLowerCase().includes(needle) ||
          student.name.toLowerCase().includes(needle) ||
          student.yearLevel.toLowerCase() === needle,
      )
      .filter((student) => !filters.yearLevel || student.yearLevel === filters.yearLevel)
      .filter(
        (student) =>
          !filters.course || student.course?.toLowerCase().includes(filters.course.toLowerCase()),
      )
      .filter(
        (student) =>
          !filters.section ||
          student.section?.toLowerCase().includes(filters.section.toLowerCase()),
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((student) => publicStudent(student, this.activeOrLatestCredential(student.id)));
  }

  get(user: User, studentId: string): ReturnType<typeof publicStudent> {
    this.requireManager(user);
    const student = this.students.get(studentKey(studentId));
    if (!student) throw new DomainError('STUDENT_NOT_FOUND', 404, 'Student was not found.');
    return publicStudent(student, this.activeOrLatestCredential(student.id));
  }

  generateQr(
    user: User,
    studentId: string,
    regenerate = false,
  ): { student: ReturnType<typeof publicStudent>; token: string; credentialId: string } {
    this.requireManager(user);
    const student = this.students.get(studentKey(studentId));
    if (!student) throw new DomainError('STUDENT_NOT_FOUND', 404, 'Student was not found.');
    const active = this.activeCredential(student.id);
    if (active && !regenerate)
      return {
        student: publicStudent(student, active),
        token: active.token,
        credentialId: active.id,
      };
    if (active) {
      active.status = 'REVOKED';
      active.revokedAt = now();
    }
    const credential = this.issueQrCredential(student.id);
    if (active) active.replacedByCredentialId = credential.id;
    this.credentials.set(credential.id, credential);
    this.catalogVersion += 1;
    return {
      student: publicStudent(student, credential),
      token: credential.token,
      credentialId: credential.id,
    };
  }

  revokeQr(user: User, studentId: string): ReturnType<typeof publicStudent> {
    this.requireManager(user);
    const student = this.students.get(studentKey(studentId));
    if (!student) throw new DomainError('STUDENT_NOT_FOUND', 404, 'Student was not found.');
    const active = this.activeCredential(student.id);
    if (!active)
      throw new DomainError('QR_NOT_ACTIVE', 409, 'Student has no active QR credential.');
    active.status = 'REVOKED';
    active.revokedAt = now();
    this.catalogVersion += 1;
    return publicStudent(student, active);
  }

  isQrTokenActive(token: string): boolean {
    const credential = [...this.credentials.values()].find(
      (candidate) => candidate.token === token,
    );
    return credential?.status === 'ACTIVE';
  }

  resolveQrToken(token: string): { credential: QrCredential; student: StudentRecord } | undefined {
    const credential = [...this.credentials.values()].find(
      (candidate) => candidate.token === token,
    );
    if (!credential) return undefined;
    const student = [...this.students.values()].find(
      (candidate) => candidate.id === credential.studentId,
    );
    return student ? { credential, student } : undefined;
  }

  activeQrTokens(): string[] {
    return [...this.credentials.values()]
      .filter((credential) => credential.status === 'ACTIVE')
      .map((credential) => credential.token);
  }

  currentCatalogVersion(): number {
    return this.catalogVersion;
  }

  private validateRow(row: ParsedRow, rowNumber: number, headers: string[]): MasterlistPreviewRow {
    const studentId = cellToString(row.student_id);
    const name = cellToString(row.name);
    const rawYearLevel = cellToString(row.year_level);
    const errors: ImportRowError[] = [];
    if (!headers.includes('student_id') || !studentId)
      errors.push({
        field: 'student_id',
        code: 'MISSING_STUDENT_ID',
        message: 'Student ID is required.',
      });
    if (!headers.includes('name') || !name)
      errors.push({ field: 'name', code: 'MISSING_NAME', message: 'Student name is required.' });
    const yearLevel = normalizeYearLevel(rawYearLevel);
    if (!yearLevel)
      errors.push({
        field: 'year_level',
        code: 'INVALID_YEAR_LEVEL',
        message: 'Year level must be K or a value from 1 to 12.',
      });
    return {
      rowNumber,
      studentId,
      name,
      yearLevel: yearLevel ?? rawYearLevel,
      course: cellToString(row.course),
      section: cellToString(row.section),
      errors,
    };
  }

  private issueQrCredential(studentId: string): QrCredential {
    return {
      id: randomUUID(),
      studentId,
      token: randomBytes(32).toString('base64url'),
      status: 'ACTIVE',
      createdAt: now(),
      revokedAt: null,
      replacedByCredentialId: null,
    };
  }

  private activeCredential(studentId: string): QrCredential | undefined {
    return [...this.credentials.values()].find(
      (credential) => credential.studentId === studentId && credential.status === 'ACTIVE',
    );
  }

  private activeOrLatestCredential(studentId: string): QrCredential | undefined {
    return [...this.credentials.values()]
      .filter((credential) => credential.studentId === studentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }
}

export function createStudentService(managerCheck: (user: User) => void): StudentService {
  return new StudentService(managerCheck);
}

export function isManager(user: User): boolean {
  return user.role === roles.admin || user.role === roles.coordinator;
}

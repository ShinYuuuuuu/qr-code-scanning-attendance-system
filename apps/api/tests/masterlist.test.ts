import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { AttendanceDomain, roles } from '../src/domain.js';

function coordinatorDomain() {
  const domain = new AttendanceDomain();
  const coordinator = domain.addUser({
    email: 'coordinator@test.local',
    displayName: 'Coordinator',
    password: 'correct-password',
    role: roles.coordinator,
  });
  return { domain, coordinator };
}

describe('masterlist import and QR credentials', () => {
  it('previews and imports valid CSV and XLSX records', () => {
    const { domain, coordinator } = coordinatorDomain();
    const csv = Buffer.from(
      'student_id,name,year_level\nSTU-001,Ada Example,7\nSTU-002,Ben Example,Grade 8\n',
    );
    const preview = domain.studentService.previewMasterlist(coordinator, 'students.csv', csv);
    expect(preview.canImport).toBe(true);
    expect(preview.rows).toHaveLength(2);
    expect(domain.studentService.importPreview(coordinator, preview.id)).toHaveLength(2);

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Student ID', 'Name', 'Year Level'],
      ['STU-003', 'Cara Example', '9'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Students');
    const xlsx = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const xlsxPreview = domain.studentService.previewMasterlist(coordinator, 'students.xlsx', xlsx);
    expect(xlsxPreview.canImport).toBe(true);
    expect(domain.studentService.importPreview(coordinator, xlsxPreview.id)).toHaveLength(1);
  });

  it('returns clear row-level errors for missing fields and invalid year levels', () => {
    const { domain, coordinator } = coordinatorDomain();
    const preview = domain.studentService.previewMasterlist(
      coordinator,
      'invalid.csv',
      Buffer.from('student_id,name,year_level\n,No ID,7\nSTU-002,,Year 99\n'),
    );

    expect(preview.canImport).toBe(false);
    expect(preview.rows[0]?.errors.map((error) => error.code)).toContain('MISSING_STUDENT_ID');
    expect(preview.rows[1]?.errors.map((error) => error.code)).toContain('MISSING_NAME');
    expect(preview.rows[1]?.errors.map((error) => error.code)).toContain('INVALID_YEAR_LEVEL');
  });

  it('rejects duplicate student IDs in one file and blocks import', () => {
    const { domain, coordinator } = coordinatorDomain();
    const preview = domain.studentService.previewMasterlist(
      coordinator,
      'duplicates.csv',
      Buffer.from(
        'student_id,name,year_level\nSTU-010,First Example,5\nSTU-010,Second Example,5\n',
      ),
    );

    expect(preview.canImport).toBe(false);
    expect(preview.rows[1]?.errors.map((error) => error.code)).toContain('DUPLICATE_STUDENT_ID');
    expect(() => domain.studentService.importPreview(coordinator, preview.id)).toThrow(
      'Fix all preview errors',
    );
  });

  it('invalidates revoked QR credentials and issues a different replacement', () => {
    const { domain, coordinator } = coordinatorDomain();
    const preview = domain.studentService.previewMasterlist(
      coordinator,
      'one.csv',
      Buffer.from('student_id,name,year_level\nSTU-020,Drew Example,6\n'),
    );
    domain.studentService.importPreview(coordinator, preview.id);
    const first = domain.studentService.generateQr(coordinator, 'STU-020');
    expect(domain.studentService.isQrTokenActive(first.token)).toBe(true);

    domain.studentService.revokeQr(coordinator, 'STU-020');
    expect(domain.studentService.isQrTokenActive(first.token)).toBe(false);

    const replacement = domain.studentService.generateQr(coordinator, 'STU-020', true);
    expect(replacement.token).not.toBe(first.token);
    expect(domain.studentService.isQrTokenActive(replacement.token)).toBe(true);
  });
});

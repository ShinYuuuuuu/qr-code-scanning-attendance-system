import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createStudentService, type StudentService } from './students.js';

export const roles = {
  admin: 'SYSTEM_ADMINISTRATOR',
  coordinator: 'EVENT_COORDINATOR',
  scanner: 'SCANNER_OFFICER',
} as const;

export type Role = (typeof roles)[keyof typeof roles];
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' | 'CANCELLED';
export type SessionType = 'TIME_IN' | 'TIME_OUT' | 'CUSTOM';

export interface User {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: Role;
  disabled: boolean;
}

export interface Event {
  id: string;
  name: string;
  description: string | null;
  status: EventStatus;
  timezone: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  days: EventDay[];
}

export interface EventDay {
  id: string;
  eventId: string;
  localDate: string;
  sequence: number;
  sessions: AttendanceSession[];
}

export interface AttendanceSession {
  id: string;
  eventDayId: string;
  name: string;
  sessionType: SessionType;
  startsAt: string;
  endsAt: string;
  lateAfterMinutes: number | null;
}

export interface ScannerAssignment {
  id: string;
  eventId: string;
  userId: string;
  permittedSessionIds: Set<string>;
  assignedAt: string;
  revokedAt: string | null;
}

export interface ScannerEventPack {
  packId: string;
  eventId: string;
  eventName: string;
  packVersion: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  deviceId: string;
  eligibleStudentIds: string[];
  integrityHash: string;
  sessions: AttendanceSession[];
  qrTokens: string[];
}

export type SyncRejectionReason =
  | 'duplicate'
  | 'expired_session'
  | 'revoked_qr'
  | 'no_permission'
  | 'stale_event_pack'
  | 'invalid_qr'
  | 'invalid_device'
  | 'session_not_open'
  | 'student_not_eligible';

export type SyncResult = {
  idempotencyKey: string;
  status: 'accepted' | 'rejected';
  reason?: SyncRejectionReason;
  message: string;
  attendanceId?: string;
  receivedAtServer: string;
};

export type ScanSyncInput = {
  idempotencyKey: string;
  deviceId: string;
  eventId: string;
  sessionId: string;
  qrToken: string;
  packId: string;
  packVersion: string;
  scannedAtDevice: string;
};

export type AttendanceReportFilters = {
  eventId?: string;
  dayId?: string;
  sessionId?: string;
  query?: string;
  course?: string;
  yearLevel?: string;
  section?: string;
};

export type AttendanceReportRow = {
  attendanceId: string;
  eventId: string;
  eventName: string;
  dayId: string;
  localDate: string;
  sessionId: string;
  sessionName: string;
  sessionType: SessionType;
  studentId: string;
  studentNumber: string;
  studentName: string;
  yearLevel: string;
  course: string | null;
  section: string | null;
  scannedAtDevice: string;
  receivedAtServer: string;
  clockSkewSeconds: number;
  scannerUserId: string;
  deviceId: string;
  late: boolean;
};

export type AuditEntry = {
  id: string;
  action: string;
  actorUserId: string | null;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
};

type IssuedPack = ScannerEventPack & { userId: string };
type ScannerDevice = { id: string; userId: string; registeredAt: string; revokedAt: string | null };

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

function now(): string {
  return new Date().toISOString();
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [salt, expectedHex] = encoded.split(':');
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class AttendanceDomain {
  readonly users = new Map<string, User>();
  readonly events = new Map<string, Event>();
  readonly assignments = new Map<string, ScannerAssignment>();
  readonly sessions = new Map<string, { userId: string; expiresAt: number }>();
  readonly devices = new Map<string, ScannerDevice>();
  readonly issuedPacks = new Map<string, IssuedPack>();
  readonly syncResults = new Map<string, SyncResult>();
  readonly syncOwners = new Map<string, { deviceId: string; userId: string }>();
  readonly attendance = new Map<
    string,
    {
      id: string;
      idempotencyKey: string;
      eventId: string;
      sessionId: string;
      studentId: string;
      deviceId: string;
      userId: string;
      scannedAtDevice: string;
      receivedAtServer: string;
      clockSkewSeconds: number;
    }
  >();
  readonly eventRosters = new Map<string, Set<string>>();
  readonly auditLog: AuditEntry[] = [];
  readonly studentService: StudentService;

  constructor() {
    this.studentService = createStudentService((user) => {
      this.requireRole(user, [roles.admin, roles.coordinator], 'STUDENT_MANAGEMENT_FORBIDDEN');
    });
  }

  addUser(input: {
    email: string;
    displayName: string;
    password: string;
    role: Role;
    id?: string;
  }): User {
    const user: User = {
      id: input.id ?? randomUUID(),
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      passwordHash: hashPassword(input.password),
      role: input.role,
      disabled: false,
    };
    this.users.set(user.id, user);
    return user;
  }

  login(email: string, password: string): string {
    const user = [...this.users.values()].find(
      (candidate) => candidate.email === email.toLowerCase(),
    );
    if (!user || user.disabled || !verifyPassword(password, user.passwordHash)) {
      throw new DomainError('INVALID_CREDENTIALS', 401, 'Email or password is incorrect.');
    }
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { userId: user.id, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
    this.recordAudit(user, 'auth.login', 'user', user.id, {});
    return token;
  }

  userFromSession(token: string | undefined): User {
    if (!token) throw new DomainError('UNAUTHENTICATED', 401, 'Authentication is required.');
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      throw new DomainError('UNAUTHENTICATED', 401, 'Authentication is required.');
    }
    const user = this.users.get(session.userId);
    if (!user || user.disabled)
      throw new DomainError('UNAUTHENTICATED', 401, 'Authentication is required.');
    return user;
  }

  logout(token: string | undefined): void {
    if (token) {
      const session = this.sessions.get(token);
      const user = session ? this.users.get(session.userId) : undefined;
      if (user) this.recordAudit(user, 'auth.logout', 'user', user.id, {});
      this.sessions.delete(token);
    }
  }

  listEvents(user: User): Event[] {
    return [...this.events.values()].filter((event) => this.canViewEvent(user, event));
  }

  createEvent(user: User, input: { name: string; description?: string; timezone?: string }): Event {
    this.requireRole(user, [roles.admin, roles.coordinator], 'EVENT_CREATE_FORBIDDEN');
    const timestamp = now();
    const event: Event = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: 'DRAFT',
      timezone: input.timezone?.trim() || null,
      createdById: user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      days: [],
    };
    if (!event.name) throw new DomainError('INVALID_EVENT', 400, 'Event name is required.');
    this.events.set(event.id, event);
    this.recordAudit(user, 'event.created', 'event', event.id, { name: event.name });
    return event;
  }

  updateEvent(
    user: User,
    eventId: string,
    input: { name?: string; description?: string; status?: EventStatus; timezone?: string },
  ): Event {
    const event = this.requireEvent(eventId);
    this.requireManageEvent(user, event);
    if (input.name !== undefined && !input.name.trim()) {
      throw new DomainError('INVALID_EVENT', 400, 'Event name cannot be empty.');
    }
    event.name = input.name?.trim() ?? event.name;
    event.description =
      input.description === undefined ? event.description : input.description.trim() || null;
    event.status = input.status ?? event.status;
    event.timezone = input.timezone === undefined ? event.timezone : input.timezone.trim() || null;
    event.updatedAt = now();
    this.recordAudit(user, 'event.updated', 'event', event.id, { status: event.status });
    return event;
  }

  addEventDay(
    user: User,
    eventId: string,
    input: { localDate: string; sequence?: number },
  ): EventDay {
    const event = this.requireEvent(eventId);
    this.requireManageEvent(user, event);
    const sequence =
      input.sequence ??
      (event.days.length ? Math.max(...event.days.map((day) => day.sequence)) + 1 : 1);
    if (event.days.some((day) => day.localDate === input.localDate || day.sequence === sequence)) {
      throw new DomainError(
        'DUPLICATE_EVENT_DAY',
        409,
        'Each event day date and sequence must be unique.',
      );
    }
    const day: EventDay = {
      id: randomUUID(),
      eventId,
      localDate: input.localDate,
      sequence,
      sessions: [],
    };
    event.days.push(day);
    event.updatedAt = now();
    this.recordAudit(user, 'event.day_added', 'event_day', day.id, { eventId });
    return day;
  }

  addSession(
    user: User,
    eventId: string,
    dayId: string,
    input: {
      name: string;
      sessionType: SessionType;
      startsAt: string;
      endsAt: string;
      lateAfterMinutes?: number;
    },
  ): AttendanceSession {
    const event = this.requireEvent(eventId);
    this.requireManageEvent(user, event);
    const day = event.days.find((candidate) => candidate.id === dayId);
    if (!day) throw new DomainError('EVENT_DAY_NOT_FOUND', 404, 'Event day was not found.');
    const starts = new Date(input.startsAt);
    const ends = new Date(input.endsAt);
    if (
      !input.name.trim() ||
      Number.isNaN(starts.valueOf()) ||
      Number.isNaN(ends.valueOf()) ||
      starts >= ends
    ) {
      throw new DomainError(
        'INVALID_SESSION',
        400,
        'Session name and a valid start/end window are required.',
      );
    }
    if (
      day.sessions.some((session) => session.name.toLowerCase() === input.name.trim().toLowerCase())
    ) {
      throw new DomainError(
        'DUPLICATE_SESSION',
        409,
        'Session names must be unique within an event day.',
      );
    }
    const session: AttendanceSession = {
      id: randomUUID(),
      eventDayId: dayId,
      name: input.name.trim(),
      sessionType: input.sessionType,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      lateAfterMinutes: input.lateAfterMinutes ?? null,
    };
    day.sessions.push(session);
    event.updatedAt = now();
    this.recordAudit(user, 'event.session_added', 'attendance_session', session.id, { eventId });
    return session;
  }

  assignScanner(
    user: User,
    eventId: string,
    scannerUserId: string,
    permittedSessionIds?: string[],
  ): ScannerAssignment {
    const event = this.requireEvent(eventId);
    this.requireManageEvent(user, event);
    const scanner = this.users.get(scannerUserId);
    if (!scanner || scanner.role !== roles.scanner)
      throw new DomainError('INVALID_SCANNER', 400, 'User must be a Scanner Officer.');
    const sessionIds = new Set(
      event.days.flatMap((day) => day.sessions.map((session) => session.id)),
    );
    const permitted = new Set(permittedSessionIds ?? [...sessionIds]);
    if ([...permitted].some((sessionId) => !sessionIds.has(sessionId))) {
      throw new DomainError(
        'INVALID_SESSION_ASSIGNMENT',
        400,
        'Scanner assignment contains a session from another event.',
      );
    }
    const existing = [...this.assignments.values()].find(
      (assignment) => assignment.eventId === eventId && assignment.userId === scannerUserId,
    );
    if (existing) {
      existing.revokedAt = null;
      existing.permittedSessionIds = permitted;
      return existing;
    }
    const assignment: ScannerAssignment = {
      id: randomUUID(),
      eventId,
      userId: scannerUserId,
      permittedSessionIds: permitted,
      assignedAt: now(),
      revokedAt: null,
    };
    this.assignments.set(assignment.id, assignment);
    this.recordAudit(user, 'scanner.assigned', 'scanner_assignment', assignment.id, {
      eventId,
      scannerUserId,
    });
    return assignment;
  }

  createScannerEventPack(
    user: User,
    eventId: string,
    deviceId = `device-${user.id}`,
  ): ScannerEventPack {
    if (user.role !== roles.scanner) {
      throw new DomainError(
        'SCANNER_PACK_FORBIDDEN',
        403,
        'Only an assigned Scanner Officer can download an event pack.',
      );
    }
    const event = this.requireEvent(eventId);
    const assignment = [...this.assignments.values()].find(
      (candidate) =>
        candidate.eventId === eventId && candidate.userId === user.id && !candidate.revokedAt,
    );
    if (!assignment)
      throw new DomainError('SCANNER_PACK_FORBIDDEN', 403, 'You are not assigned to this event.');
    const sessions = event.days
      .flatMap((day) => day.sessions)
      .filter((session) => assignment.permittedSessionIds.has(session.id));
    if (!sessions.length)
      throw new DomainError(
        'NO_PERMITTED_SESSIONS',
        403,
        'No attendance sessions are permitted for this assignment.',
      );
    this.registerScannerDevice(user, deviceId);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000);
    const eligibleStudentIds = [
      ...(this.eventRosters.get(eventId) ??
        new Set([...this.studentService.students.values()].map((student) => student.id))),
    ];
    const pack: ScannerEventPack = {
      packId: randomUUID(),
      eventId: event.id,
      eventName: event.name,
      packVersion: `catalog-${this.studentService.currentCatalogVersion()}-${event.updatedAt}`,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      deviceId,
      eligibleStudentIds,
      integrityHash: '',
      sessions,
      qrTokens: this.studentService.activeQrTokens(),
    };
    const packPayload = { ...pack, integrityHash: undefined };
    pack.integrityHash = createHash('sha256').update(JSON.stringify(packPayload)).digest('hex');
    this.issuedPacks.set(pack.packId, { ...pack, userId: user.id });
    this.recordAudit(user, 'offline_pack.issued', 'offline_event_pack', pack.packId, {
      eventId,
      deviceId,
      packVersion: pack.packVersion,
    });
    return pack;
  }

  registerScannerDevice(user: User, deviceId: string): ScannerDevice {
    if (user.role !== roles.scanner || !deviceId.trim())
      throw new DomainError('INVALID_DEVICE', 403, 'A valid Scanner Officer device is required.');
    const existing = this.devices.get(deviceId);
    if (existing && existing.userId !== user.id)
      throw new DomainError(
        'INVALID_DEVICE',
        403,
        'This device is registered to another Scanner Officer.',
      );
    const device = existing ?? {
      id: deviceId,
      userId: user.id,
      registeredAt: now(),
      revokedAt: null,
    };
    device.revokedAt = null;
    this.devices.set(deviceId, device);
    return device;
  }

  setEventRoster(user: User, eventId: string, studentIds: string[]): void {
    const event = this.requireEvent(eventId);
    this.requireManageEvent(user, event);
    this.eventRosters.set(eventId, new Set(studentIds));
    event.updatedAt = now();
  }

  syncScans(user: User, scans: ScanSyncInput[], serverNow = new Date()): SyncResult[] {
    if (user.role !== roles.scanner)
      return scans.map((scan) =>
        this.reject(
          scan,
          'no_permission',
          'Only Scanner Officers can synchronize scans.',
          serverNow,
        ),
      );
    const results = scans.map((scan) => this.syncOne(user, scan, serverNow));
    this.recordAudit(user, 'attendance.sync', 'attendance_batch', null, {
      submitted: scans.length,
      accepted: results.filter((result) => result.status === 'accepted').length,
      rejected: results.filter((result) => result.status === 'rejected').length,
    });
    return results;
  }

  private syncOne(user: User, scan: ScanSyncInput, serverNow: Date): SyncResult {
    const prior = this.syncResults.get(scan.idempotencyKey);
    const owner = this.syncOwners.get(scan.idempotencyKey);
    if (prior) {
      if (owner && (owner.deviceId !== scan.deviceId || owner.userId !== user.id))
        return {
          idempotencyKey: scan.idempotencyKey,
          status: 'rejected',
          reason: 'no_permission',
          message: 'The idempotency key belongs to another scanner device.',
          receivedAtServer: serverNow.toISOString(),
        };
      return prior;
    }
    this.syncOwners.set(scan.idempotencyKey, { deviceId: scan.deviceId, userId: user.id });
    const receivedAtServer = serverNow.toISOString();
    const device = this.devices.get(scan.deviceId);
    if (!device || device.userId !== user.id || device.revokedAt)
      return this.reject(
        scan,
        'no_permission',
        'The scanner device is not authorized for this officer.',
        serverNow,
      );
    const pack = this.issuedPacks.get(scan.packId);
    if (
      !pack ||
      pack.userId !== user.id ||
      pack.deviceId !== scan.deviceId ||
      pack.eventId !== scan.eventId
    )
      return this.reject(
        scan,
        'no_permission',
        'The event pack is not authorized for this officer or device.',
        serverNow,
      );
    const assignment = [...this.assignments.values()].find(
      (candidate) => candidate.eventId === scan.eventId && candidate.userId === user.id,
    );
    if (!assignment || assignment.revokedAt || !assignment.permittedSessionIds.has(scan.sessionId))
      return this.reject(
        scan,
        'no_permission',
        'The Scanner Officer assignment is revoked or does not permit this session.',
        serverNow,
      );
    if (pack.revokedAt || new Date(pack.expiresAt).getTime() <= serverNow.getTime())
      return this.reject(
        scan,
        'stale_event_pack',
        'The event data pack is expired or revoked.',
        serverNow,
      );
    const resolved = this.studentService.resolveQrToken(scan.qrToken);
    if (!resolved)
      return this.reject(scan, 'invalid_qr', 'The QR token is not recognized.', serverNow);
    if (resolved.credential.status !== 'ACTIVE')
      return this.reject(scan, 'revoked_qr', 'The QR credential has been revoked.', serverNow);
    const event = this.events.get(scan.eventId);
    const currentVersion = event
      ? `catalog-${this.studentService.currentCatalogVersion()}-${event.updatedAt}`
      : '';
    if (!event || scan.packVersion !== pack.packVersion || scan.packVersion !== currentVersion)
      return this.reject(
        scan,
        'stale_event_pack',
        'The event data pack is stale. Download a fresh pack.',
        serverNow,
      );
    const session = event.days
      .flatMap((day) => day.sessions)
      .find((candidate) => candidate.id === scan.sessionId);
    if (!session)
      return this.reject(
        scan,
        'no_permission',
        'The attendance session is not part of this event.',
        serverNow,
      );
    if (serverNow.getTime() > new Date(session.endsAt).getTime())
      return this.reject(scan, 'expired_session', 'The attendance session has expired.', serverNow);
    if (serverNow.getTime() < new Date(session.startsAt).getTime())
      return this.reject(
        scan,
        'session_not_open',
        'The attendance session has not opened yet.',
        serverNow,
      );
    if (!pack.qrTokens.includes(scan.qrToken))
      return this.reject(
        scan,
        'stale_event_pack',
        'The QR token is not included in this event pack.',
        serverNow,
      );
    if (!pack.eligibleStudentIds.includes(resolved.student.id))
      return this.reject(
        scan,
        'student_not_eligible',
        'The student is not eligible for this event.',
        serverNow,
      );
    const attendanceKey = `${scan.sessionId}:${resolved.student.id}`;
    const existing = this.attendance.get(attendanceKey);
    if (existing) {
      const result = {
        idempotencyKey: scan.idempotencyKey,
        status: 'rejected' as const,
        reason: 'duplicate' as const,
        message: 'Attendance was already accepted for this student and session.',
        receivedAtServer,
      };
      this.syncResults.set(scan.idempotencyKey, result);
      return result;
    }
    const attendanceId = randomUUID();
    this.attendance.set(attendanceKey, {
      id: attendanceId,
      idempotencyKey: scan.idempotencyKey,
      eventId: scan.eventId,
      sessionId: scan.sessionId,
      studentId: resolved.student.id,
      deviceId: scan.deviceId,
      userId: user.id,
      scannedAtDevice: scan.scannedAtDevice,
      receivedAtServer,
      clockSkewSeconds: Math.round(
        (serverNow.getTime() - new Date(scan.scannedAtDevice).getTime()) / 1000,
      ),
    });
    const result: SyncResult = {
      idempotencyKey: scan.idempotencyKey,
      status: 'accepted',
      message: 'Attendance accepted.',
      attendanceId,
      receivedAtServer,
    };
    this.syncResults.set(scan.idempotencyKey, result);
    return result;
  }

  private reject(
    scan: ScanSyncInput,
    reason: SyncRejectionReason,
    message: string,
    serverNow: Date,
  ): SyncResult {
    const result: SyncResult = {
      idempotencyKey: scan.idempotencyKey,
      status: 'rejected',
      reason,
      message,
      receivedAtServer: serverNow.toISOString(),
    };
    this.syncResults.set(scan.idempotencyKey, result);
    return result;
  }

  getAttendanceReport(
    user: User,
    filters: AttendanceReportFilters = {},
  ): {
    rows: AttendanceReportRow[];
    summary: {
      attendanceCount: number;
      studentCount: number;
      eventCount: number;
      sessionCount: number;
      byYearLevel: Record<string, number>;
      byCourse: Record<string, number>;
      bySection: Record<string, number>;
    };
  } {
    this.requireRole(user, [roles.admin, roles.coordinator], 'REPORTS_FORBIDDEN');
    const query = filters.query?.trim().toLowerCase() ?? '';
    const events = [...this.events.values()].filter((event) => {
      if (!this.canViewEvent(user, event)) return false;
      if (filters.eventId && event.id !== filters.eventId) return false;
      return true;
    });
    if (filters.eventId && !events.length)
      throw new DomainError('REPORT_EVENT_FORBIDDEN', 403, 'You cannot report on this event.');
    const eventIds = new Set(events.map((event) => event.id));
    const rows: AttendanceReportRow[] = [];
    for (const record of this.attendance.values()) {
      if (!eventIds.has(record.eventId)) continue;
      const event = this.events.get(record.eventId);
      if (!event) continue;
      const day = event.days.find((candidate) =>
        candidate.sessions.some((session) => session.id === record.sessionId),
      );
      const session = day?.sessions.find((candidate) => candidate.id === record.sessionId);
      const student = [...this.studentService.students.values()].find(
        (candidate) => candidate.id === record.studentId,
      );
      if (!day || !session || !student) continue;
      if (filters.dayId && day.id !== filters.dayId) continue;
      if (filters.sessionId && session.id !== filters.sessionId) continue;
      if (filters.yearLevel && student.yearLevel !== filters.yearLevel) continue;
      if (
        filters.course &&
        !(student.course ?? '').toLowerCase().includes(filters.course.toLowerCase())
      )
        continue;
      if (
        filters.section &&
        !(student.section ?? '').toLowerCase().includes(filters.section.toLowerCase())
      )
        continue;
      if (
        query &&
        ![student.studentId, student.name, student.course ?? '', student.section ?? ''].some(
          (value) => value.toLowerCase().includes(query),
        )
      )
        continue;
      const received = new Date(record.receivedAtServer).getTime();
      const lateAfter = session.lateAfterMinutes ?? 0;
      rows.push({
        attendanceId: record.id,
        eventId: event.id,
        eventName: event.name,
        dayId: day.id,
        localDate: day.localDate,
        sessionId: session.id,
        sessionName: session.name,
        sessionType: session.sessionType,
        studentId: student.id,
        studentNumber: student.studentId,
        studentName: student.name,
        yearLevel: student.yearLevel,
        course: student.course,
        section: student.section,
        scannedAtDevice: record.scannedAtDevice,
        receivedAtServer: record.receivedAtServer,
        clockSkewSeconds: record.clockSkewSeconds,
        scannerUserId: record.userId,
        deviceId: record.deviceId,
        late: received > new Date(session.startsAt).getTime() + lateAfter * 60_000,
      });
    }
    rows.sort((left, right) => right.receivedAtServer.localeCompare(left.receivedAtServer));
    const summary = {
      attendanceCount: rows.length,
      studentCount: new Set(rows.map((row) => row.studentId)).size,
      eventCount: new Set(rows.map((row) => row.eventId)).size,
      sessionCount: new Set(rows.map((row) => row.sessionId)).size,
      byYearLevel: {} as Record<string, number>,
      byCourse: {} as Record<string, number>,
      bySection: {} as Record<string, number>,
    };
    for (const row of rows) {
      summary.byYearLevel[row.yearLevel] = (summary.byYearLevel[row.yearLevel] ?? 0) + 1;
      const course = row.course || 'Unspecified';
      const section = row.section || 'Unspecified';
      summary.byCourse[course] = (summary.byCourse[course] ?? 0) + 1;
      summary.bySection[section] = (summary.bySection[section] ?? 0) + 1;
    }
    return { rows, summary };
  }

  getCoordinatorDashboard(user: User, eventId?: string) {
    const report = this.getAttendanceReport(user, { eventId });
    const scopedEvents = [...this.events.values()].filter(
      (event) => this.canViewEvent(user, event) && (!eventId || event.id === eventId),
    );
    const sessions = scopedEvents.flatMap((event) => event.days.flatMap((day) => day.sessions));
    return {
      metrics: {
        events: scopedEvents.length,
        activeEvents: scopedEvents.filter((event) => event.status === 'ACTIVE').length,
        sessions: sessions.length,
        attendance: report.summary.attendanceCount,
      },
      events: scopedEvents.map((event) => ({
        id: event.id,
        name: event.name,
        status: event.status,
        days: event.days.length,
        sessions: event.days.reduce((count, day) => count + day.sessions.length, 0),
        attendance: report.rows.filter((row) => row.eventId === event.id).length,
      })),
      recent: report.rows.slice(0, 8),
    };
  }

  recordAudit(
    user: User | null,
    action: string,
    targetType: string,
    targetId: string | null,
    metadata: Record<string, string | number | boolean | null>,
  ): void {
    this.auditLog.unshift({
      id: randomUUID(),
      action,
      actorUserId: user?.id ?? null,
      targetType,
      targetId,
      metadata,
      createdAt: now(),
    });
    if (this.auditLog.length > 1000) this.auditLog.length = 1000;
  }

  canViewEvent(user: User, event: Event): boolean {
    if (user.role === roles.admin) return true;
    if (user.role === roles.coordinator) return event.createdById === user.id;
    return [...this.assignments.values()].some(
      (assignment) =>
        assignment.eventId === event.id && assignment.userId === user.id && !assignment.revokedAt,
    );
  }

  canViewSession(user: User, event: Event, sessionId: string): boolean {
    if (!this.canViewEvent(user, event)) return false;
    if (user.role !== roles.scanner) return true;
    return [...this.assignments.values()].some(
      (assignment) =>
        assignment.eventId === event.id &&
        assignment.userId === user.id &&
        !assignment.revokedAt &&
        assignment.permittedSessionIds.has(sessionId),
    );
  }

  private requireEvent(eventId: string): Event {
    const event = this.events.get(eventId);
    if (!event) throw new DomainError('EVENT_NOT_FOUND', 404, 'Event was not found.');
    return event;
  }

  private requireManageEvent(user: User, event: Event): void {
    if (user.role === roles.admin) return;
    if (user.role === roles.coordinator && event.createdById === user.id) return;
    throw new DomainError('FORBIDDEN', 403, 'You do not have permission to manage this event.');
  }

  private requireRole(user: User, allowed: Role[], code: string): void {
    if (!allowed.includes(user.role))
      throw new DomainError(code, 403, 'Your role cannot perform this action.');
  }
}

export function createDemoDomain(): AttendanceDomain {
  const domain = new AttendanceDomain();
  const configuredUsers: Array<{
    envEmail: string;
    envPassword: string;
    displayName: string;
    role: Role;
  }> = [
    {
      envEmail: 'SEED_ADMIN_EMAIL',
      envPassword: 'SEED_ADMIN_PASSWORD',
      displayName: 'System Administrator',
      role: roles.admin,
    },
    {
      envEmail: 'SEED_COORDINATOR_EMAIL',
      envPassword: 'SEED_COORDINATOR_PASSWORD',
      displayName: 'Event Coordinator',
      role: roles.coordinator,
    },
    {
      envEmail: 'SEED_SCANNER_EMAIL',
      envPassword: 'SEED_SCANNER_PASSWORD',
      displayName: 'Scanner Officer',
      role: roles.scanner,
    },
  ];
  for (const configured of configuredUsers) {
    const email = process.env[configured.envEmail];
    const password = process.env[configured.envPassword];
    if (email && password)
      domain.addUser({
        email,
        password,
        displayName: configured.displayName,
        role: configured.role,
      });
  }
  return domain;
}

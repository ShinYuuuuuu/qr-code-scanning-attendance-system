import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import {
  AttendanceDomain,
  DomainError,
  type EventStatus,
  type SessionType,
  type AttendanceReportFilters,
  createDemoDomain,
  type ScanSyncInput,
} from './domain.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const eventCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  timezone: z.string().optional(),
});
const eventUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED', 'ARCHIVED', 'CANCELLED']).optional(),
  timezone: z.string().optional(),
});
const daySchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sequence: z.number().int().positive().optional(),
});
const sessionSchema = z.object({
  name: z.string().min(1),
  sessionType: z.enum(['TIME_IN', 'TIME_OUT', 'CUSTOM']),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  lateAfterMinutes: z.number().int().min(0).optional(),
});
const assignmentSchema = z.object({
  scannerUserId: z.string().min(1),
  permittedSessionIds: z.array(z.string()).optional(),
});
const importSchema = z.object({ previewId: z.string().uuid() });
const base64UploadSchema = z.object({
  filename: z.string().min(1),
  contentBase64: z.string().min(1),
});
const scanSyncSchema = z.object({
  idempotencyKey: z.string().min(1),
  deviceId: z.string().min(1),
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  qrToken: z.string().min(1),
  packId: z.string().min(1),
  packVersion: z.string().min(1),
  scannedAtDevice: z.string().datetime({ offset: true }),
});
const syncScansSchema = z.object({ scans: z.array(scanSyncSchema).min(1).max(500) });
const rosterSchema = z.object({ studentIds: z.array(z.string().min(1)) });
const reportQuerySchema = z.object({
  eventId: z.string().optional(),
  dayId: z.string().optional(),
  sessionId: z.string().optional(),
  query: z.string().optional(),
  course: z.string().optional(),
  yearLevel: z.string().optional(),
  section: z.string().optional(),
});
const exportQuerySchema = reportQuerySchema.extend({
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

function sessionCookie(request: FastifyRequest): string | undefined {
  return request.cookies.session;
}

function sendDomainError(reply: FastifyReply, error: unknown): void {
  if (error instanceof DomainError) {
    void reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    return;
  }
  void reply
    .code(500)
    .send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
}

async function readMasterlistUpload(
  request: FastifyRequest,
): Promise<{ filename: string; buffer: Buffer }> {
  if (request.isMultipart()) {
    const upload = await request.file();
    if (!upload)
      throw new DomainError('FILE_REQUIRED', 400, 'Choose a CSV or XLSX file to upload.');
    return { filename: upload.filename, buffer: await upload.toBuffer() };
  }
  const body = base64UploadSchema.parse(request.body);
  return { filename: body.filename, buffer: Buffer.from(body.contentBase64, 'base64') };
}

function publicEvent(
  event: ReturnType<AttendanceDomain['listEvents']>[number],
  user: ReturnType<AttendanceDomain['userFromSession']>,
  domain: AttendanceDomain,
) {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    status: event.status,
    timezone: event.timezone,
    createdById: event.createdById,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    days: event.days.map((day) => ({
      ...day,
      sessions: day.sessions.filter((session) => domain.canViewSession(user, event, session.id)),
    })),
  };
}

function reportFilters(query: unknown): AttendanceReportFilters {
  return reportQuerySchema.parse(query ?? {}) as AttendanceReportFilters;
}

function reportCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return 'No attendance records\n';
  const headers = Object.keys(rows[0]!);
  const escape = (value: unknown) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return (
    [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
    ].join('\n') + '\n'
  );
}

export function buildApp(domain: AttendanceDomain = createDemoDomain()) {
  if (process.env.NODE_ENV === 'production' && !process.env.COOKIE_SECRET)
    throw new Error('COOKIE_SECRET must be configured in production.');
  if (process.env.NODE_ENV === 'production' && !process.env.WEB_ORIGIN)
    throw new Error('WEB_ORIGIN must be configured in production.');
  const app = Fastify({ logger: false });

  app.register(cookie, { secret: process.env.COOKIE_SECRET ?? 'development-cookie-secret' });
  app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });
  app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      void reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.issues.map((issue) => issue.message).join('; '),
        },
      });
      return;
    }
    sendDomainError(reply, error);
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.post('/api/auth/login', async (request, reply) => {
    try {
      const input = loginSchema.parse(request.body);
      const token = domain.login(input.email, input.password);
      reply.setCookie('session', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 8 * 60 * 60,
      });
      const user = domain.userFromSession(token);
      return reply.send({
        user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    domain.logout(sessionCookie(request));
    reply.clearCookie('session', { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      return reply.send({
        user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.post('/api/masterlists/preview', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      const upload = await readMasterlistUpload(request);
      const preview = domain.studentService.previewMasterlist(user, upload.filename, upload.buffer);
      return reply.send({ preview });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.post('/api/masterlists/import', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      const { previewId } = importSchema.parse(request.body);
      const students = domain.studentService.importPreview(user, previewId);
      domain.recordAudit(user, 'masterlist.imported', 'masterlist_import', previewId, {
        importedCount: students.length,
      });
      return reply.code(201).send({
        importedCount: students.length,
        students: students.map((student) => domain.studentService.get(user, student.studentId)),
      });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.get('/api/students', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      const query =
        typeof request.query === 'object' && request.query !== null && 'query' in request.query
          ? String((request.query as { query?: unknown }).query ?? '')
          : '';
      const raw = (request.query ?? {}) as Record<string, unknown>;
      return reply.send({
        students: domain.studentService.search(user, query, {
          yearLevel: typeof raw.yearLevel === 'string' ? raw.yearLevel : undefined,
          course: typeof raw.course === 'string' ? raw.course : undefined,
          section: typeof raw.section === 'string' ? raw.section : undefined,
        }),
      });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.get<{ Params: { studentId: string } }>('/api/students/:studentId', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      return reply.send({ student: domain.studentService.get(user, request.params.studentId) });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.post<{ Params: { studentId: string } }>(
    '/api/students/:studentId/qr',
    async (request, reply) => {
      try {
        const user = domain.userFromSession(sessionCookie(request));
        const result = domain.studentService.generateQr(user, request.params.studentId);
        domain.recordAudit(user, 'qr.issued', 'student', request.params.studentId, {});
        return reply.code(201).send(result);
      } catch (error) {
        sendDomainError(reply, error);
      }
    },
  );

  app.post<{ Params: { studentId: string } }>(
    '/api/students/:studentId/qr/regenerate',
    async (request, reply) => {
      try {
        const user = domain.userFromSession(sessionCookie(request));
        const result = domain.studentService.generateQr(user, request.params.studentId, true);
        domain.recordAudit(user, 'qr.regenerated', 'student', request.params.studentId, {});
        return reply.code(201).send(result);
      } catch (error) {
        sendDomainError(reply, error);
      }
    },
  );

  app.post<{ Params: { studentId: string } }>(
    '/api/students/:studentId/qr/revoke',
    async (request, reply) => {
      try {
        const user = domain.userFromSession(sessionCookie(request));
        const student = domain.studentService.revokeQr(user, request.params.studentId);
        domain.recordAudit(user, 'qr.revoked', 'student', request.params.studentId, {});
        return reply.send({ student });
      } catch (error) {
        sendDomainError(reply, error);
      }
    },
  );

  app.get('/api/events', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      return reply.send({
        events: domain.listEvents(user).map((event) => publicEvent(event, user, domain)),
      });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.get('/api/scanner/events', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      if (user.role !== 'SCANNER_OFFICER') {
        throw new DomainError(
          'SCANNER_EVENTS_FORBIDDEN',
          403,
          'Only Scanner Officers can use this view.',
        );
      }
      return reply.send({
        events: domain.listEvents(user).map((event) => publicEvent(event, user, domain)),
      });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.get<{ Params: { eventId: string } }>(
    '/api/scanner/events/:eventId/pack',
    async (request, reply) => {
      try {
        const user = domain.userFromSession(sessionCookie(request));
        const deviceId = request.headers['x-device-id'];
        if (typeof deviceId !== 'string' || !deviceId)
          throw new DomainError(
            'INVALID_DEVICE',
            400,
            'x-device-id is required to download an event pack.',
          );
        return reply.send({
          pack: domain.createScannerEventPack(user, request.params.eventId, deviceId),
        });
      } catch (error) {
        sendDomainError(reply, error);
      }
    },
  );

  app.post<{ Params: { eventId: string } }>(
    '/api/scanner/events/:eventId/roster',
    async (request, reply) => {
      try {
        const user = domain.userFromSession(sessionCookie(request));
        domain.setEventRoster(
          user,
          request.params.eventId,
          rosterSchema.parse(request.body).studentIds,
        );
        return reply.code(204).send();
      } catch (error) {
        sendDomainError(reply, error);
      }
    },
  );

  app.post('/api/sync/scans', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      const input = syncScansSchema.parse(request.body);
      return reply.send({ results: domain.syncScans(user, input.scans as ScanSyncInput[]) });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.get('/api/coordinator/dashboard', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      const eventId =
        typeof request.query === 'object' && request.query !== null && 'eventId' in request.query
          ? String((request.query as { eventId?: unknown }).eventId ?? '') || undefined
          : undefined;
      return reply.send(domain.getCoordinatorDashboard(user, eventId));
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.get('/api/audit', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      if (user.role !== 'SYSTEM_ADMINISTRATOR')
        throw new DomainError(
          'AUDIT_FORBIDDEN',
          403,
          'Only System Administrators can view audit entries.',
        );
      const rawLimit =
        typeof request.query === 'object' && request.query !== null && 'limit' in request.query
          ? Number((request.query as { limit?: unknown }).limit)
          : 100;
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200)
        : 100;
      return reply.send({ entries: domain.auditLog.slice(0, limit) });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.get('/api/reports/attendance', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      return reply.send(domain.getAttendanceReport(user, reportFilters(request.query)));
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.get('/api/reports/attendance/export', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      const input = exportQuerySchema.parse(request.query ?? {});
      const report = domain.getAttendanceReport(user, input);
      domain.recordAudit(user, 'report.exported', 'attendance_report', input.eventId ?? null, {
        format: input.format,
        rowCount: report.rows.length,
      });
      const rows = report.rows.map((row) => ({
        Event: row.eventName,
        Date: row.localDate,
        Session: row.sessionName,
        'Session Type': row.sessionType,
        'Student ID': row.studentNumber,
        'Student Name': row.studentName,
        'Year Level': row.yearLevel,
        Course: row.course ?? '',
        Section: row.section ?? '',
        Late: row.late ? 'Yes' : 'No',
        'Device Scan Time': row.scannedAtDevice,
        'Server Receipt Time': row.receivedAtServer,
        'Clock Skew Seconds': row.clockSkewSeconds,
        Device: row.deviceId,
      }));
      if (input.format === 'xlsx') {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Attendance');
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
        return reply
          .header(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          )
          .header('Content-Disposition', 'attachment; filename="attendance-report.xlsx"')
          .send(buffer);
      }
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="attendance-report.csv"')
        .send(reportCsv(rows));
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.post('/api/events', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      const event = domain.createEvent(user, eventCreateSchema.parse(request.body));
      return reply.code(201).send({ event: publicEvent(event, user, domain) });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.get<{ Params: { eventId: string } }>('/api/events/:eventId', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      const event = domain.events.get(request.params.eventId);
      if (!event || !domain.canViewEvent(user, event))
        throw new DomainError('FORBIDDEN', 403, 'You cannot access this event.');
      return reply.send({ event: publicEvent(event, user, domain) });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.patch<{ Params: { eventId: string } }>('/api/events/:eventId', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      const event = domain.updateEvent(
        user,
        request.params.eventId,
        eventUpdateSchema.parse(request.body) as {
          name?: string;
          description?: string;
          status?: EventStatus;
          timezone?: string;
        },
      );
      return reply.send({ event: publicEvent(event, user, domain) });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.post<{ Params: { eventId: string } }>('/api/events/:eventId/days', async (request, reply) => {
    try {
      const user = domain.userFromSession(sessionCookie(request));
      const day = domain.addEventDay(user, request.params.eventId, daySchema.parse(request.body));
      return reply.code(201).send({ day });
    } catch (error) {
      sendDomainError(reply, error);
    }
  });

  app.post<{ Params: { eventId: string; dayId: string } }>(
    '/api/events/:eventId/days/:dayId/sessions',
    async (request, reply) => {
      try {
        const user = domain.userFromSession(sessionCookie(request));
        const session = sessionSchema.parse(request.body);
        const created = domain.addSession(
          user,
          request.params.eventId,
          request.params.dayId,
          session as {
            name: string;
            sessionType: SessionType;
            startsAt: string;
            endsAt: string;
            lateAfterMinutes?: number;
          },
        );
        return reply.code(201).send({ session: created });
      } catch (error) {
        sendDomainError(reply, error);
      }
    },
  );

  app.post<{ Params: { eventId: string } }>(
    '/api/events/:eventId/scanner-assignments',
    async (request, reply) => {
      try {
        const user = domain.userFromSession(sessionCookie(request));
        const input = assignmentSchema.parse(request.body);
        const assignment = domain.assignScanner(
          user,
          request.params.eventId,
          input.scannerUserId,
          input.permittedSessionIds,
        );
        return reply.code(201).send({
          assignment: { ...assignment, permittedSessionIds: [...assignment.permittedSessionIds] },
        });
      } catch (error) {
        sendDomainError(reply, error);
      }
    },
  );

  app.get<{ Params: { eventId: string; sessionId: string } }>(
    '/api/events/:eventId/sessions/:sessionId',
    async (request, reply) => {
      try {
        const user = domain.userFromSession(sessionCookie(request));
        const event = domain.events.get(request.params.eventId);
        const session = event?.days
          .flatMap((day) => day.sessions)
          .find((candidate) => candidate.id === request.params.sessionId);
        if (!event || !session || !domain.canViewSession(user, event, session.id))
          throw new DomainError('FORBIDDEN', 403, 'You cannot access this attendance session.');
        return reply.send({ session });
      } catch (error) {
        sendDomainError(reply, error);
      }
    },
  );

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.API_PORT ?? 3001);
  const app = buildApp();
  app.listen({ port, host: '0.0.0.0' }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}

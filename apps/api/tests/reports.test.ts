import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';
import { AttendanceDomain, roles } from '../src/domain.js';

function reportFixture() {
  const domain = new AttendanceDomain();
  const administrator = domain.addUser({
    email: 'admin@reports.test',
    displayName: 'Administrator',
    password: 'password',
    role: roles.admin,
  });
  const coordinator = domain.addUser({
    email: 'coordinator@reports.test',
    displayName: 'Coordinator',
    password: 'password',
    role: roles.coordinator,
  });
  const scanner = domain.addUser({
    email: 'scanner@reports.test',
    displayName: 'Scanner',
    password: 'password',
    role: roles.scanner,
  });
  const event = domain.createEvent(coordinator, { name: 'Fictional Report Event' });
  const day = domain.addEventDay(coordinator, event.id, { localDate: '2026-10-04' });
  const session = domain.addSession(coordinator, event.id, day.id, {
    name: 'Morning Time-In',
    sessionType: 'TIME_IN',
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    lateAfterMinutes: 0,
  });
  domain.assignScanner(coordinator, event.id, scanner.id, [session.id]);
  const preview = domain.studentService.previewMasterlist(
    coordinator,
    'fictional-report.csv',
    Buffer.from(
      'student_id,name,year_level,course,section\nSTU-REPORT-001,Fictional Learner,8,Science,8-A\n',
    ),
  );
  domain.studentService.importPreview(coordinator, preview.id);
  const token = domain.studentService.generateQr(coordinator, 'STU-REPORT-001').token;
  const pack = domain.createScannerEventPack(scanner, event.id, 'report-device');
  domain.syncScans(scanner, [
    {
      idempotencyKey: 'report-scan-1',
      deviceId: 'report-device',
      eventId: event.id,
      sessionId: session.id,
      qrToken: token,
      packId: pack.packId,
      packVersion: pack.packVersion,
      scannedAtDevice: new Date().toISOString(),
    },
  ]);
  return { domain, administrator, coordinator, event, day, session };
}

describe('coordinator attendance reports', () => {
  it('filters accepted attendance by event, course, year level, and section', () => {
    const { domain, coordinator, event, day, session } = reportFixture();
    const report = domain.getAttendanceReport(coordinator, {
      eventId: event.id,
      dayId: day.id,
      sessionId: session.id,
      course: 'Science',
      yearLevel: '8',
      section: '8-A',
      query: 'Fictional',
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      eventName: 'Fictional Report Event',
      course: 'Science',
      section: '8-A',
      yearLevel: '8',
    });
    expect(report.summary.byCourse.Science).toBe(1);
  });

  it('does not expose reports to scanner officers', () => {
    const { domain } = reportFixture();
    const scanner = [...domain.users.values()].find((user) => user.role === roles.scanner)!;
    expect(() => domain.getAttendanceReport(scanner)).toThrow('role cannot perform');
  });

  it('serves authorized CSV and XLSX exports and blocks scanner access', async () => {
    const { domain, coordinator } = reportFixture();
    const app = buildApp(domain);
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: coordinator.email, password: 'password' },
    });
    const loginCookie = loginResponse.cookies.find((candidate) => candidate.name === 'session');
    const cookie = `${loginCookie?.name}=${loginCookie?.value}`;
    const csv = await app.inject({
      method: 'GET',
      url: '/api/reports/attendance/export?format=csv',
      headers: { cookie },
    });
    const xlsx = await app.inject({
      method: 'GET',
      url: '/api/reports/attendance/export?format=xlsx',
      headers: { cookie },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Fictional Learner');
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');

    const scanner = [...domain.users.values()].find((user) => user.role === roles.scanner)!;
    const scannerLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: scanner.email, password: 'password' },
    });
    const scannerCookieValue = scannerLogin.cookies.find(
      (candidate) => candidate.name === 'session',
    );
    const scannerCookie = `${scannerCookieValue?.name}=${scannerCookieValue?.value}`;
    const denied = await app.inject({
      method: 'GET',
      url: '/api/reports/attendance',
      headers: { cookie: scannerCookie },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('allows only administrators to review the audit stream', async () => {
    const { domain, administrator } = reportFixture();
    const app = buildApp(domain);
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: administrator.email, password: 'password' },
    });
    const session = loginResponse.cookies.find((cookie) => cookie.name === 'session');
    const audit = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { cookie: `${session?.name}=${session?.value}` },
    });
    expect(audit.statusCode).toBe(200);
    expect(
      audit.json().entries.some((entry: { action: string }) => entry.action === 'event.created'),
    ).toBe(true);
  });
});

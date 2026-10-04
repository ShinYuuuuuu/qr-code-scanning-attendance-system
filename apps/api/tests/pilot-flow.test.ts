import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';
import { AttendanceDomain, roles } from '../src/domain.js';

async function login(app: ReturnType<typeof buildApp>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'pilot-password' },
  });
  expect(response.statusCode).toBe(200);
  const session = response.cookies.find((cookie) => cookie.name === 'session');
  return `${session?.name}=${session?.value}`;
}

describe('release pilot flow', () => {
  it('creates, prepares, scans, synchronizes, deduplicates, and exports an event', async () => {
    const domain = new AttendanceDomain();
    const coordinator = domain.addUser({
      email: 'pilot-coordinator@test.local',
      displayName: 'Pilot Coordinator',
      password: 'pilot-password',
      role: roles.coordinator,
    });
    const scannerA = domain.addUser({
      email: 'pilot-scanner-a@test.local',
      displayName: 'Pilot Scanner A',
      password: 'pilot-password',
      role: roles.scanner,
    });
    const scannerB = domain.addUser({
      email: 'pilot-scanner-b@test.local',
      displayName: 'Pilot Scanner B',
      password: 'pilot-password',
      role: roles.scanner,
    });
    const app = buildApp(domain);
    const coordinatorCookie = await login(app, coordinator.email);
    const scannerACookie = await login(app, scannerA.email);
    const scannerBCookie = await login(app, scannerB.email);

    const eventResponse = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { cookie: coordinatorCookie },
      payload: { name: 'Fictional Pilot Event' },
    });
    expect(eventResponse.statusCode).toBe(201);
    const event = eventResponse.json().event;
    const now = Date.now();
    const dayResponse = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/days`,
      headers: { cookie: coordinatorCookie },
      payload: { localDate: '2026-10-04' },
    });
    const day = dayResponse.json().day;
    const sessionResponse = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/days/${day.id}/sessions`,
      headers: { cookie: coordinatorCookie },
      payload: {
        name: 'Time-In',
        sessionType: 'TIME_IN',
        startsAt: new Date(now - 60_000).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
      },
    });
    const session = sessionResponse.json().session;

    const csv = Buffer.from(
      'student_id,name,year_level,course,section\nSTU-PILOT-001,Fictional Pilot Student,7,Science,7-A\n',
    ).toString('base64');
    const previewResponse = await app.inject({
      method: 'POST',
      url: '/api/masterlists/preview',
      headers: { cookie: coordinatorCookie },
      payload: { filename: 'pilot.csv', contentBase64: csv },
    });
    expect(previewResponse.json().preview.canImport).toBe(true);
    const importResponse = await app.inject({
      method: 'POST',
      url: '/api/masterlists/import',
      headers: { cookie: coordinatorCookie },
      payload: { previewId: previewResponse.json().preview.id },
    });
    expect(importResponse.statusCode).toBe(201);
    const qrResponse = await app.inject({
      method: 'POST',
      url: '/api/students/STU-PILOT-001/qr',
      headers: { cookie: coordinatorCookie },
    });
    const qrToken = qrResponse.json().token;

    for (const scanner of [scannerA, scannerB]) {
      const assignmentResponse = await app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/scanner-assignments`,
        headers: { cookie: coordinatorCookie },
        payload: { scannerUserId: scanner.id, permittedSessionIds: [session.id] },
      });
      expect(assignmentResponse.statusCode).toBe(201);
    }

    const packAResponse = await app.inject({
      method: 'GET',
      url: `/api/scanner/events/${event.id}/pack`,
      headers: { cookie: scannerACookie, 'x-device-id': 'pilot-device-a' },
    });
    const packA = packAResponse.json().pack;
    expect(packA.integrityHash).toMatch(/^[a-f0-9]{64}$/);

    const packBResponse = await app.inject({
      method: 'GET',
      url: `/api/scanner/events/${event.id}/pack`,
      headers: { cookie: scannerBCookie, 'x-device-id': 'pilot-device-b' },
    });
    const packB = packBResponse.json().pack;
    const offlineScan = {
      idempotencyKey: 'pilot-offline-scan-a',
      deviceId: 'pilot-device-a',
      eventId: event.id,
      sessionId: session.id,
      qrToken,
      packId: packA.packId,
      packVersion: packA.packVersion,
      scannedAtDevice: new Date().toISOString(),
    };
    expect(domain.attendance).toHaveLength(0);

    const syncA = await app.inject({
      method: 'POST',
      url: '/api/sync/scans',
      headers: { cookie: scannerACookie },
      payload: { scans: [offlineScan] },
    });
    expect(syncA.json().results[0]).toMatchObject({ status: 'accepted' });

    const syncB = await app.inject({
      method: 'POST',
      url: '/api/sync/scans',
      headers: { cookie: scannerBCookie },
      payload: {
        scans: [
          {
            ...offlineScan,
            idempotencyKey: 'pilot-offline-scan-b',
            deviceId: 'pilot-device-b',
            packId: packB.packId,
            packVersion: packB.packVersion,
          },
        ],
      },
    });
    expect(syncB.json().results[0]).toMatchObject({ status: 'rejected', reason: 'duplicate' });

    const exportResponse = await app.inject({
      method: 'GET',
      url: `/api/reports/attendance/export?eventId=${event.id}&format=csv`,
      headers: { cookie: coordinatorCookie },
    });
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.body).toContain('Fictional Pilot Student');
    expect(domain.auditLog.some((entry) => entry.action === 'report.exported')).toBe(true);
  });
});

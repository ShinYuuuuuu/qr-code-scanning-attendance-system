import { describe, expect, it } from 'vitest';
import {
  AttendanceDomain,
  roles,
  type ScannerEventPack,
  type ScanSyncInput,
} from '../src/domain.js';

function setup() {
  const domain = new AttendanceDomain();
  const coordinator = domain.addUser({
    email: 'coordinator@sync.test',
    displayName: 'Coordinator',
    password: 'password',
    role: roles.coordinator,
  });
  const scannerA = domain.addUser({
    email: 'scanner-a@sync.test',
    displayName: 'Scanner A',
    password: 'password',
    role: roles.scanner,
  });
  const scannerB = domain.addUser({
    email: 'scanner-b@sync.test',
    displayName: 'Scanner B',
    password: 'password',
    role: roles.scanner,
  });
  const event = domain.createEvent(coordinator, { name: 'Fictional Sync Event' });
  const day = domain.addEventDay(coordinator, event.id, { localDate: '2026-10-04' });
  const now = new Date();
  const session = domain.addSession(coordinator, event.id, day.id, {
    name: 'Time-In',
    sessionType: 'TIME_IN',
    startsAt: new Date(now.getTime() - 60_000).toISOString(),
    endsAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
  });
  domain.assignScanner(coordinator, event.id, scannerA.id, [session.id]);
  domain.assignScanner(coordinator, event.id, scannerB.id, [session.id]);
  const preview = domain.studentService.previewMasterlist(
    coordinator,
    'fictional.csv',
    Buffer.from('student_id,name,year_level\nSTU-SYNC-001,Fictional Student,7\n'),
  );
  domain.studentService.importPreview(coordinator, preview.id);
  const token = domain.studentService.generateQr(coordinator, 'STU-SYNC-001').token;
  const packA = domain.createScannerEventPack(scannerA, event.id, 'device-a');
  const packB = domain.createScannerEventPack(scannerB, event.id, 'device-b');
  const scan = (
    pack: ScannerEventPack,
    deviceId: string,
    idempotencyKey: string,
  ): ScanSyncInput => ({
    idempotencyKey,
    deviceId,
    eventId: event.id,
    sessionId: session.id,
    qrToken: token,
    packId: pack.packId,
    packVersion: pack.packVersion,
    scannedAtDevice: new Date().toISOString(),
  });
  return { domain, coordinator, scannerA, scannerB, event, session, packA, packB, token, scan };
}

describe('authoritative scan synchronization', () => {
  it('returns the original result for a repeated idempotency key', () => {
    const context = setup();
    const input = context.scan(context.packA, 'device-a', 'offline-scan-1');
    const first = context.domain.syncScans(context.scannerA, [input])[0]!;
    const retry = context.domain.syncScans(context.scannerA, [input])[0]!;
    expect(first.status).toBe('accepted');
    expect(retry).toEqual(first);
    expect(context.domain.attendance).toHaveLength(1);
  });

  it('accepts one device and rejects the other device as duplicate', () => {
    const context = setup();
    const first = context.domain.syncScans(context.scannerA, [
      context.scan(context.packA, 'device-a', 'device-a-scan'),
    ])[0]!;
    const second = context.domain.syncScans(context.scannerB, [
      context.scan(context.packB, 'device-b', 'device-b-scan'),
    ])[0]!;
    expect(first.status).toBe('accepted');
    expect(second).toMatchObject({ status: 'rejected', reason: 'duplicate' });
    expect(context.domain.attendance).toHaveLength(1);
  });

  it('syncs a scan queued while offline when connectivity returns', () => {
    const context = setup();
    const queued = context.scan(context.packA, 'device-a', 'offline-then-online');
    expect(context.domain.attendance).toHaveLength(0);
    const result = context.domain.syncScans(context.scannerA, [queued])[0]!;
    expect(result.status).toBe('accepted');
  });

  it('rejects expired sessions, revoked assignments, and stale packs', () => {
    const expired = setup();
    expired.session.endsAt = new Date(Date.now() - 1_000).toISOString();
    expect(
      expired.domain.syncScans(expired.scannerA, [
        expired.scan(expired.packA, 'device-a', 'expired'),
      ])[0],
    ).toMatchObject({ reason: 'expired_session' });

    const revoked = setup();
    const assignment = [...revoked.domain.assignments.values()].find(
      (candidate) => candidate.userId === revoked.scannerA.id,
    )!;
    assignment.revokedAt = new Date().toISOString();
    expect(
      revoked.domain.syncScans(revoked.scannerA, [
        revoked.scan(revoked.packA, 'device-a', 'revoked-assignment'),
      ])[0],
    ).toMatchObject({ reason: 'no_permission' });

    const stale = setup();
    stale.event.updatedAt = new Date(Date.now() + 2_000).toISOString();
    expect(
      stale.domain.syncScans(stale.scannerA, [
        stale.scan(stale.packA, 'device-a', 'stale-pack'),
      ])[0],
    ).toMatchObject({ reason: 'stale_event_pack' });
  });

  it('rejects a revoked QR credential with a useful reason', () => {
    const context = setup();
    context.domain.studentService.revokeQr(context.coordinator, 'STU-SYNC-001');
    expect(
      context.domain.syncScans(context.scannerA, [
        context.scan(context.packA, 'device-a', 'revoked-qr'),
      ])[0],
    ).toMatchObject({ reason: 'revoked_qr' });
  });
});

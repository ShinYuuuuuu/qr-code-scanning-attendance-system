import { describe, expect, it } from 'vitest';
import { AttendanceDomain, roles } from '../src/domain.js';

describe('authorized scanner event packs', () => {
  it('includes only permitted sessions and opaque active QR tokens', () => {
    const domain = new AttendanceDomain();
    const coordinator = domain.addUser({
      email: 'coordinator@pack.test',
      displayName: 'Coordinator',
      password: 'password',
      role: roles.coordinator,
    });
    const scanner = domain.addUser({
      email: 'scanner@pack.test',
      displayName: 'Scanner',
      password: 'password',
      role: roles.scanner,
    });
    const event = domain.createEvent(coordinator, { name: 'Fictional Sports Day' });
    const day = domain.addEventDay(coordinator, event.id, { localDate: '2026-10-04' });
    const timeIn = domain.addSession(coordinator, event.id, day.id, {
      name: 'Time-In',
      sessionType: 'TIME_IN',
      startsAt: '2026-10-04T08:00:00+08:00',
      endsAt: '2026-10-04T09:00:00+08:00',
    });
    domain.addSession(coordinator, event.id, day.id, {
      name: 'Time-Out',
      sessionType: 'TIME_OUT',
      startsAt: '2026-10-04T15:00:00+08:00',
      endsAt: '2026-10-04T16:00:00+08:00',
    });
    domain.assignScanner(coordinator, event.id, scanner.id, [timeIn.id]);
    const preview = domain.studentService.previewMasterlist(
      coordinator,
      'fictional.csv',
      Buffer.from('student_id,name,year_level\nSTU-PACK-001,Fictional Student,7\n'),
    );
    domain.studentService.importPreview(coordinator, preview.id);

    const pack = domain.createScannerEventPack(scanner, event.id);

    expect(pack.sessions.map((session) => session.id)).toEqual([timeIn.id]);
    expect(pack.qrTokens).toHaveLength(1);
    expect(pack.qrTokens[0]).not.toContain('Fictional');
    expect(pack.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(pack.expiresAt).getTime()).toBeGreaterThan(new Date(pack.issuedAt).getTime());
  });

  it('rejects event-pack download for an unassigned Scanner Officer', () => {
    const domain = new AttendanceDomain();
    const coordinator = domain.addUser({
      email: 'coordinator@pack.test',
      displayName: 'Coordinator',
      password: 'password',
      role: roles.coordinator,
    });
    const scanner = domain.addUser({
      email: 'scanner@pack.test',
      displayName: 'Scanner',
      password: 'password',
      role: roles.scanner,
    });
    const event = domain.createEvent(coordinator, { name: 'Private Fictional Event' });

    expect(() => domain.createScannerEventPack(scanner, event.id)).toThrow('not assigned');
  });
});

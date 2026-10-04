import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';
import { AttendanceDomain, roles } from '../src/domain.js';

async function login(
  app: ReturnType<typeof buildApp>,
  email: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.cookies.find((candidate) => candidate.name === 'session');
  expect(cookie?.value).toBeTruthy();
  return `${cookie?.name}=${cookie?.value}`;
}

describe('server-side event authorization', () => {
  it('requires explicit production cookie and origin configuration', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousCookieSecret = process.env.COOKIE_SECRET;
    const previousWebOrigin = process.env.WEB_ORIGIN;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.COOKIE_SECRET;
      delete process.env.WEB_ORIGIN;
      expect(() => buildApp(new AttendanceDomain())).toThrow('COOKIE_SECRET');
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousCookieSecret === undefined) delete process.env.COOKIE_SECRET;
      else process.env.COOKIE_SECRET = previousCookieSecret;
      if (previousWebOrigin === undefined) delete process.env.WEB_ORIGIN;
      else process.env.WEB_ORIGIN = previousWebOrigin;
    }
  });

  it('prevents a scanner officer from reading another event', async () => {
    const domain = new AttendanceDomain();
    const coordinator = domain.addUser({
      email: 'coordinator@test.local',
      displayName: 'Coordinator',
      password: 'correct-password',
      role: roles.coordinator,
    });
    const scanner = domain.addUser({
      email: 'scanner@test.local',
      displayName: 'Scanner',
      password: 'correct-password',
      role: roles.scanner,
    });
    const otherCoordinator = domain.addUser({
      email: 'other@test.local',
      displayName: 'Other Coordinator',
      password: 'correct-password',
      role: roles.coordinator,
    });
    const ownEvent = domain.createEvent(coordinator, { name: 'Assigned event' });
    const otherEvent = domain.createEvent(otherCoordinator, { name: 'Private event' });
    domain.assignScanner(coordinator, ownEvent.id, scanner.id);
    const app = buildApp(domain);
    const cookie = await login(app, scanner.email, 'correct-password');

    const ownResponse = await app.inject({
      method: 'GET',
      url: `/api/events/${ownEvent.id}`,
      headers: { cookie },
    });
    const otherResponse = await app.inject({
      method: 'GET',
      url: `/api/events/${otherEvent.id}`,
      headers: { cookie },
    });

    expect(ownResponse.statusCode).toBe(200);
    expect(otherResponse.statusCode).toBe(403);
  });

  it('prevents a scanner officer from using coordinator event-management functions', async () => {
    const domain = new AttendanceDomain();
    const scanner = domain.addUser({
      email: 'scanner@test.local',
      displayName: 'Scanner',
      password: 'correct-password',
      role: roles.scanner,
    });
    const app = buildApp(domain);
    const cookie = await login(app, scanner.email, 'correct-password');

    const response = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { cookie },
      payload: { name: 'Not allowed' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('EVENT_CREATE_FORBIDDEN');
  });

  it('limits a scanner officer to permitted sessions within an assigned event', async () => {
    const domain = new AttendanceDomain();
    const coordinator = domain.addUser({
      email: 'coordinator@test.local',
      displayName: 'Coordinator',
      password: 'correct-password',
      role: roles.coordinator,
    });
    const scanner = domain.addUser({
      email: 'scanner@test.local',
      displayName: 'Scanner',
      password: 'correct-password',
      role: roles.scanner,
    });
    const event = domain.createEvent(coordinator, { name: 'Two-session event' });
    const day = domain.addEventDay(coordinator, event.id, { localDate: '2026-10-04' });
    const timeIn = domain.addSession(coordinator, event.id, day.id, {
      name: 'Time-In',
      sessionType: 'TIME_IN',
      startsAt: '2026-10-04T08:00:00+08:00',
      endsAt: '2026-10-04T09:00:00+08:00',
    });
    const timeOut = domain.addSession(coordinator, event.id, day.id, {
      name: 'Time-Out',
      sessionType: 'TIME_OUT',
      startsAt: '2026-10-04T15:00:00+08:00',
      endsAt: '2026-10-04T16:00:00+08:00',
    });
    domain.assignScanner(coordinator, event.id, scanner.id, [timeIn.id]);
    const app = buildApp(domain);
    const cookie = await login(app, scanner.email, 'correct-password');

    const allowed = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/sessions/${timeIn.id}`,
      headers: { cookie },
    });
    const denied = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/sessions/${timeOut.id}`,
      headers: { cookie },
    });
    const eventView = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}`,
      headers: { cookie },
    });
    const visibleSessionIds = eventView
      .json()
      .event.days[0].sessions.map((session: { id: string }) => session.id);

    expect(allowed.statusCode).toBe(200);
    expect(denied.statusCode).toBe(403);
    expect(visibleSessionIds).toEqual([timeIn.id]);
  });
});

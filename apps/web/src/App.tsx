import { FormEvent, lazy, Suspense, useEffect, useState } from 'react';
import StudentManagement from './StudentManagement.js';
import CoordinatorDashboard from './CoordinatorDashboard.js';

const ScannerExperience = lazy(() => import('./ScannerExperience.js'));

type User = { id: string; email: string; displayName: string; role: string };
type Session = { id: string; name: string; sessionType: string; startsAt: string; endsAt: string };
type Day = { id: string; localDate: string; sequence: number; sessions: Session[] };
type Event = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  timezone: string | null;
  days: Day[];
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!response.ok) throw new Error(body.error?.message ?? 'Request failed.');
  return body;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request<{ user: User }>('/api/auth/me')
      .then((body) => setUser(body.user))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    request<{ events: Event[] }>('/api/events')
      .then((body) => setEvents(body.events))
      .catch((cause: Error) => setError(cause.message));
  }, [user]);

  if (loading)
    return <main className="grid min-h-screen place-items-center text-slate-600">Loading…</main>;
  if (!user) return <Login onLogin={setUser} onError={setError} error={error} />;
  if (user.role === 'SCANNER_OFFICER')
    return (
      <Suspense
        fallback={
          <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-200">
            Loading scanner…
          </main>
        }
      >
        <ScannerExperience />
      </Suspense>
    );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">
              Attendance control
            </p>
            <h1 className="mt-1 text-2xl font-bold">Events</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">
              {user.displayName} · {user.role.replaceAll('_', ' ')}
            </span>
            <button
              className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50"
              onClick={() =>
                request('/api/auth/logout', { method: 'POST' }).then(() => setUser(null))
              }
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <CoordinatorDashboard events={events} />
      <div className="print:hidden">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section
            aria-labelledby="event-list-heading"
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 id="event-list-heading" className="text-lg font-semibold">
                  Your events
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Access is enforced by the server for every request.
                </p>
              </div>
              {user.role !== 'SCANNER_OFFICER' && (
                <CreateEvent
                  onCreated={(event) => setEvents((current) => [...current, event])}
                  onError={setError}
                />
              )}
            </div>
            {error && (
              <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
                {error}
              </p>
            )}
            <div className="space-y-3">
              {events.map((event) => (
                <button
                  key={event.id}
                  className="block min-h-11 w-full rounded-xl border border-slate-200 p-4 text-left hover:border-indigo-400 hover:bg-indigo-50/40"
                  onClick={() => setSelectedEvent(event)}
                >
                  <span className="font-semibold">{event.name}</span>
                  <span className="mt-1 block text-sm text-slate-500">
                    {event.status} · {event.days.length} day(s)
                  </span>
                </button>
              ))}
              {events.length === 0 && (
                <p className="rounded-lg bg-slate-50 p-5 text-sm text-slate-600">
                  No events are available for this account.
                </p>
              )}
            </div>
          </section>
          <EventDetails
            event={selectedEvent}
            onSaved={(event) => {
              setSelectedEvent(event);
              setEvents((current) => current.map((item) => (item.id === event.id ? event : item)));
            }}
            onError={setError}
          />
        </div>
        {user.role !== 'SCANNER_OFFICER' && <StudentManagement onError={setError} />}
      </div>
    </main>
  );
}

function Login({
  onLogin,
  onError,
  error,
}: {
  onLogin: (user: User) => void;
  onError: (message: string) => void;
  error: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
      .then((body) => onLogin(body.user))
      .catch((cause: Error) => onError(cause.message))
      .finally(() => setBusy(false));
  };
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">
          Attendance control
        </p>
        <h1 className="mt-3 text-3xl font-bold">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">
          Use your school account to manage assigned events.
        </p>
        {error && (
          <p role="alert" className="mt-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
            {error}
          </p>
        )}
        <label className="mt-6 block text-sm font-semibold" htmlFor="email">
          Email
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3"
          />
        </label>
        <label className="mt-4 block text-sm font-semibold" htmlFor="password">
          Password
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3"
          />
        </label>
        <button
          disabled={busy}
          className="mt-6 min-h-11 w-full rounded-lg bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

function CreateEvent({
  onCreated,
  onError,
}: {
  onCreated: (event: Event) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (!name.trim()) return;
    setBusy(true);
    request<{ event: Event }>('/api/events', { method: 'POST', body: JSON.stringify({ name }) })
      .then((body) => {
        onCreated(body.event);
        setName('');
      })
      .catch((cause: Error) => onError(cause.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex gap-2">
      <label className="sr-only" htmlFor="new-event">
        New event name
      </label>
      <input
        id="new-event"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="New event name"
        className="min-h-11 w-44 rounded-lg border border-slate-300 px-3 text-sm"
      />
      <button
        disabled={busy}
        onClick={submit}
        className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        Create
      </button>
    </div>
  );
}

function EventDetails({
  event,
  onSaved,
  onError,
}: {
  event: Event | null;
  onSaved: (event: Event) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(event?.name ?? '');
  useEffect(() => setName(event?.name ?? ''), [event]);
  if (!event)
    return (
      <aside className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        Select an event to edit its details, days, and attendance sessions.
      </aside>
    );
  const save = () =>
    request<{ event: Event }>(`/api/events/${event.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
      .then((body) => onSaved(body.event))
      .catch((cause: Error) => onError(cause.message));
  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Edit event</h2>
      <label className="mt-5 block text-sm font-semibold" htmlFor="event-name">
        Name
        <input
          id="event-name"
          value={name}
          onChange={(input) => setName(input.target.value)}
          className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3"
        />
      </label>
      <button
        onClick={save}
        className="mt-4 min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700"
      >
        Save changes
      </button>
      <div className="mt-8 border-t border-slate-200 pt-5">
        <h3 className="font-semibold">Event days</h3>
        {event.days.length ? (
          event.days.map((day) => (
            <div key={day.id} className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-medium">
                Day {day.sequence} · {day.localDate}
              </p>
              <p className="mt-1 text-slate-500">{day.sessions.length} session(s)</p>
            </div>
          ))
        ) : (
          <p className="mt-2 text-sm text-slate-500">No days configured yet.</p>
        )}
      </div>
    </aside>
  );
}

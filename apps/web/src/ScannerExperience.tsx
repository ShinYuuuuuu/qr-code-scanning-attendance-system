import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getEventPack,
  getDeviceId,
  hasLocalDuplicate,
  listLocalScans,
  pendingLocalScans,
  queueLocalScan,
  saveEventPack,
  updateLocalScan,
  type LocalEventPack,
  type LocalScan,
  type PackSession,
} from './scannerStore.js';

type AssignedEvent = {
  id: string;
  name: string;
  status: string;
  days: Array<{ id: string; localDate: string; sequence: number; sessions: PackSession[] }>;
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!response.ok) throw new Error(body.error?.message ?? 'Request failed.');
  return body;
}

function packFreshness(
  pack: LocalEventPack | undefined,
): 'fresh' | 'expiring' | 'expired' | 'none' {
  if (!pack) return 'none';
  const remaining = new Date(pack.expiresAt).getTime() - Date.now();
  if (remaining <= 0) return 'expired';
  if (remaining <= 60 * 60 * 1000) return 'expiring';
  return 'fresh';
}

export default function ScannerExperience() {
  const [events, setEvents] = useState<AssignedEvent[]>([]);
  const [pack, setPack] = useState<LocalEventPack>();
  const [selectedSession, setSelectedSession] = useState<PackSession>();
  const [queue, setQueue] = useState<LocalScan[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [, setClock] = useState(Date.now());

  const loadEvents = useCallback(() => {
    api<{ events: AssignedEvent[] }>('/api/scanner/events')
      .then((body) => setEvents(body.events))
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    loadEvents();
    const onlineHandler = () => {
      setOnline(true);
      loadEvents();
    };
    const offlineHandler = () => setOnline(false);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    return () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    };
  }, [loadEvents]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectEvent = async (eventId: string) => {
    setError('');
    const localPack = await getEventPack(eventId);
    if (localPack) {
      setPack(localPack);
      setSelectedSession(localPack.sessions[0]);
      setQueue(await listLocalScans(eventId));
    }
  };

  const downloadPack = async (eventId: string) => {
    setError('');
    try {
      const body = await api<{ pack: LocalEventPack }>(`/api/scanner/events/${eventId}/pack`, {
        headers: { 'x-device-id': getDeviceId() },
      });
      await saveEventPack(body.pack);
      setPack(body.pack);
      setSelectedSession(body.pack.sessions[0]);
      setQueue(await listLocalScans(eventId));
      setMessage(`Authorized event pack ${body.pack.packVersion} saved on this device.`);
    } catch (cause) {
      const localPack = await getEventPack(eventId);
      if (localPack) {
        setPack(localPack);
        setSelectedSession(localPack.sessions[0]);
        setQueue(await listLocalScans(eventId));
        setError(`Download unavailable. Using local pack (${packFreshness(localPack)}).`);
      } else setError((cause as Error).message);
    }
  };

  const syncQueue = useCallback(async () => {
    if (!pack || !online || syncing) return;
    const pending = await pendingLocalScans(pack.eventId);
    if (!pending.length) return;
    setSyncing(true);
    try {
      const body = await api<{
        results: Array<{
          idempotencyKey: string;
          status: 'accepted' | 'rejected';
          reason?: string;
          message: string;
          attendanceId?: string;
          receivedAtServer: string;
        }>;
      }>('/api/sync/scans', {
        method: 'POST',
        body: JSON.stringify({
          scans: pending.map((scan) => ({
            idempotencyKey: scan.idempotencyKey,
            deviceId: scan.deviceId,
            eventId: scan.eventId,
            sessionId: scan.sessionId,
            qrToken: scan.qrToken,
            packId: scan.packId,
            packVersion: scan.packVersion,
            scannedAtDevice: scan.scannedAt,
          })),
        }),
      });
      for (const result of body.results) {
        await updateLocalScan(result.idempotencyKey, {
          status: result.status,
          reason: result.reason,
          message: result.message,
          attendanceId: result.attendanceId,
          receivedAtServer: result.receivedAtServer,
        });
      }
      setQueue(await listLocalScans(pack.eventId));
      setMessage(
        `Sync complete: ${body.results.filter((result) => result.status === 'accepted').length} accepted, ${body.results.filter((result) => result.status === 'rejected').length} rejected.`,
      );
    } catch (cause) {
      setError(`Sync unavailable. Scans remain queued: ${(cause as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }, [online, pack, syncing]);

  useEffect(() => {
    if (online) void syncQueue();
  }, [online, syncQueue]);

  const freshness = packFreshness(pack);
  const persistLocalScan = useCallback(
    async (scan: Omit<LocalScan, 'idempotencyKey' | 'deviceId' | 'scannedAt'>) => {
      if (!pack) return;
      await queueLocalScan(scan);
      setQueue(await listLocalScans(pack.eventId));
    },
    [pack],
  );
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              Scanner mode
            </p>
            <h1 className="mt-1 text-xl font-bold">My assigned events</h1>
          </div>
          <div
            className={`rounded-full px-3 py-2 text-xs font-semibold ${online ? 'bg-emerald-900 text-emerald-200' : 'bg-amber-900 text-amber-200'}`}
            aria-live="polite"
          >
            {online ? 'Online' : 'Offline'}
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-5 p-4 sm:p-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section
          aria-labelledby="assigned-events-heading"
          className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
        >
          <h2
            id="assigned-events-heading"
            className="text-sm font-semibold uppercase tracking-wide text-slate-300"
          >
            Assigned events
          </h2>
          <div className="mt-3 space-y-3">
            {events.map((event) => (
              <article key={event.id} className="rounded-xl border border-slate-700 p-3">
                <button onClick={() => selectEvent(event.id)} className="min-h-11 w-full text-left">
                  <span className="font-semibold">{event.name}</span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {event.status} ·{' '}
                    {event.days.reduce((count, day) => count + day.sessions.length, 0)} session(s)
                  </span>
                </button>
                <button
                  onClick={() => downloadPack(event.id)}
                  disabled={!online}
                  className="mt-3 min-h-11 w-full rounded-lg bg-cyan-500 px-3 text-sm font-bold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {online ? 'Download / refresh pack' : 'Offline: use saved pack'}
                </button>
              </article>
            ))}
            {events.length === 0 && (
              <p className="text-sm text-slate-400">
                No assigned events were returned. Connect once to refresh assignments.
              </p>
            )}
          </div>
        </section>
        <section className="space-y-5">
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-rose-800 bg-rose-950 p-4 text-sm text-rose-200"
            >
              {error}
            </p>
          )}
          {message && (
            <p
              role="status"
              className="rounded-xl border border-emerald-800 bg-emerald-950 p-4 text-sm text-emerald-200"
            >
              {message}
            </p>
          )}
          {!pack ? (
            <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
              Select an assigned event and download its authorized data pack before scanning.
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{pack.eventName}</h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Pack {pack.packVersion} · expires {new Date(pack.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-2 text-xs font-bold ${freshness === 'fresh' ? 'bg-emerald-900 text-emerald-200' : freshness === 'expiring' ? 'bg-amber-900 text-amber-200' : 'bg-rose-900 text-rose-200'}`}
                  >
                    {freshness === 'fresh'
                      ? 'Fresh'
                      : freshness === 'expiring'
                        ? 'Expiring soon'
                        : 'Expired'}
                  </span>
                </div>
                <label className="mt-4 block text-sm font-semibold" htmlFor="attendance-session">
                  Attendance session
                  <select
                    id="attendance-session"
                    value={selectedSession?.id ?? ''}
                    onChange={(event) =>
                      setSelectedSession(
                        pack.sessions.find((session) => session.id === event.target.value),
                      )
                    }
                    className="mt-2 min-h-12 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 text-slate-100"
                  >
                    <option value="" disabled>
                      Select a session
                    </option>
                    {pack.sessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.name} · {session.sessionType} ·{' '}
                        {new Date(session.startsAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <QrCamera
                pack={pack}
                session={selectedSession}
                onScan={persistLocalScan}
                onMessage={setMessage}
                onError={setError}
                disabled={freshness === 'expired' || !pack.integrityHash}
              />
              <QueueSummary
                queue={queue}
                deviceId={getDeviceId()}
                onSync={() => void syncQueue()}
                syncing={syncing}
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function QrCamera({
  pack,
  session,
  onScan,
  onMessage,
  onError,
  disabled,
}: {
  pack: LocalEventPack;
  session?: PackSession;
  onScan: (scan: Omit<LocalScan, 'idempotencyKey' | 'deviceId' | 'scannedAt'>) => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
  disabled: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const processingRef = useRef(false);
  const [cameraError, setCameraError] = useState('');
  useEffect(() => {
    if (disabled || !session || !videoRef.current) return;
    let cancelled = false;
    let controls: IScannerControls | undefined;
    const reader = new BrowserQRCodeReader();
    reader
      .decodeFromVideoDevice(undefined, videoRef.current, async (result) => {
        if (!result || cancelled || processingRef.current) return;
        processingRef.current = true;
        const token = result.getText().trim();
        try {
          if (!pack.qrTokens.includes(token)) {
            onError('Invalid QR: this opaque token is not in the authorized event pack.');
            await new Promise((resolve) => window.setTimeout(resolve, 850));
            return;
          }
          const duplicate = await hasLocalDuplicate(pack.eventId, session.id, token);
          if (duplicate) {
            onMessage(
              'Likely duplicate: this token was already queued for this session on this device.',
            );
            await new Promise((resolve) => window.setTimeout(resolve, 850));
            return;
          }
          await onScan({
            eventId: pack.eventId,
            sessionId: session.id,
            qrToken: token,
            packId: pack.packId,
            packVersion: pack.packVersion,
            status: 'pending',
            message: 'Saved locally; server confirmation is pending synchronization.',
          });
          onMessage('Saved locally. Ready for the next scan.');
          await new Promise((resolve) => window.setTimeout(resolve, 650));
        } catch (cause) {
          onError((cause as Error).message);
        } finally {
          processingRef.current = false;
        }
      })
      .then((nextControls) => {
        if (cancelled) nextControls.stop();
        else controls = nextControls;
      })
      .catch((cause: Error) => {
        if (!cancelled) {
          setCameraError(cause.message);
          onError('Camera could not start. Check camera permission and HTTPS.');
        }
      });
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [disabled, onError, onMessage, onScan, pack, session]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Scan attendance</h2>
        <span className="text-xs text-slate-400">{session?.name ?? 'Choose a session'}</span>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          className="aspect-[4/3] w-full object-cover"
          aria-label="Live QR camera preview"
        />
      </div>
      {disabled && (
        <p className="mt-3 rounded-lg bg-rose-950 p-3 text-sm text-rose-200">
          This event pack is expired. Download a fresh pack before scanning.
        </p>
      )}
      {!pack.integrityHash && (
        <p className="mt-3 rounded-lg bg-rose-950 p-3 text-sm text-rose-200">
          This event pack is incomplete or cannot be verified. Download it again before scanning.
        </p>
      )}
      {cameraError && (
        <p role="alert" className="mt-3 text-sm text-amber-200">
          {cameraError}
        </p>
      )}
      <p className="mt-3 text-xs text-slate-400">
        The camera stays active after each result. Local feedback is provisional; synchronization
        and server authority are not implemented in this phase.
      </p>
    </div>
  );
}

function QueueSummary({
  queue,
  deviceId,
  onSync,
  syncing,
}: {
  queue: LocalScan[];
  deviceId: string;
  onSync: () => void;
  syncing: boolean;
}) {
  const pending = queue.filter(
    (scan) => scan.status === 'accepted_local' || scan.status === 'pending',
  ).length;
  const accepted = queue.filter((scan) => scan.status === 'accepted').length;
  const rejected = queue.filter((scan) => scan.status === 'rejected').length;
  return (
    <section
      aria-labelledby="queue-heading"
      className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="queue-heading" className="text-lg font-bold">
          Local scan queue
        </h2>
        <span className="text-xs text-slate-400">Device {deviceId.slice(-8)}</span>
      </div>
      <button
        onClick={onSync}
        disabled={syncing || !navigator.onLine}
        className="mt-3 min-h-10 rounded-lg bg-cyan-500 px-3 text-sm font-bold text-slate-950 disabled:opacity-50"
      >
        {syncing ? 'Syncing…' : 'Sync queued scans'}
      </button>
      <p className="mt-1 text-sm text-slate-400">
        {pending} pending · {accepted} accepted · {rejected} rejected. Rejected scans remain visible
        for review.
      </p>
      <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
        {queue.slice(0, 10).map((scan) => (
          <div
            key={scan.idempotencyKey}
            className="flex items-center justify-between rounded-lg bg-slate-800 p-3 text-xs"
          >
            <span className="truncate pr-3">{scan.message}</span>
            <span
              className={`shrink-0 font-semibold ${scan.status === 'accepted' ? 'text-emerald-200' : scan.status === 'rejected' ? 'text-rose-200' : 'text-amber-200'}`}
            >
              {scan.status.replace('_', ' ')}
              {scan.reason ? ` · ${scan.reason}` : ''}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

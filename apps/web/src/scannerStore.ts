import Dexie, { type EntityTable } from 'dexie';

export type PackSession = {
  id: string;
  eventDayId: string;
  name: string;
  sessionType: string;
  startsAt: string;
  endsAt: string;
};

export type LocalEventPack = {
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
  sessions: PackSession[];
  qrTokens: string[];
};

export type LocalScan = {
  idempotencyKey: string;
  eventId: string;
  sessionId: string;
  qrToken: string;
  scannedAt: string;
  deviceId: string;
  packId: string;
  packVersion: string;
  status: 'pending' | 'accepted_local' | 'duplicate_local' | 'invalid_qr' | 'accepted' | 'rejected';
  message: string;
  reason?: string;
  attendanceId?: string;
  receivedAtServer?: string;
};

class ScannerDatabase extends Dexie {
  packs!: EntityTable<LocalEventPack, 'eventId'>;
  scans!: EntityTable<LocalScan, 'idempotencyKey'>;

  constructor() {
    super('school-event-attendance-scanner');
    this.version(1).stores({
      packs: 'eventId, packVersion, expiresAt',
      scans: 'id, eventId, sessionId, [eventId+sessionId+qrToken], status, scannedAt',
    });
    this.version(2)
      .stores({
        packs: 'eventId, packVersion, expiresAt',
        scans: 'idempotencyKey, eventId, sessionId, [eventId+sessionId+qrToken], status, scannedAt',
      })
      .upgrade((transaction) =>
        transaction
          .table('scans')
          .toCollection()
          .modify((scan: LocalScan & { id?: string }) => {
            scan.idempotencyKey ??= scan.id ?? newId();
            delete scan.id;
            scan.packId ??= '';
            scan.packVersion ??= '';
          }),
      );
  }
}

export const scannerDatabase = new ScannerDatabase();

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function getDeviceId(): string {
  const key = 'attendance-scanner-device-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = `device-${newId()}`;
  localStorage.setItem(key, id);
  return id;
}

export async function saveEventPack(pack: LocalEventPack): Promise<void> {
  await scannerDatabase.packs.put(pack);
}

export async function getEventPack(eventId: string): Promise<LocalEventPack | undefined> {
  return scannerDatabase.packs.get(eventId);
}

export async function hasLocalDuplicate(
  eventId: string,
  sessionId: string,
  qrToken: string,
): Promise<boolean> {
  return Boolean(
    await scannerDatabase.scans
      .where('[eventId+sessionId+qrToken]')
      .equals([eventId, sessionId, qrToken])
      .first(),
  );
}

export async function queueLocalScan(
  input: Omit<LocalScan, 'idempotencyKey' | 'deviceId' | 'scannedAt'>,
): Promise<LocalScan> {
  const scan: LocalScan = {
    ...input,
    idempotencyKey: newId(),
    deviceId: getDeviceId(),
    scannedAt: new Date().toISOString(),
  };
  await scannerDatabase.scans.add(scan);
  return scan;
}

export async function updateLocalScan(
  idempotencyKey: string,
  update: Partial<
    Pick<LocalScan, 'status' | 'message' | 'reason' | 'attendanceId' | 'receivedAtServer'>
  >,
): Promise<void> {
  await scannerDatabase.scans.update(idempotencyKey, update);
}

export async function pendingLocalScans(eventId?: string): Promise<LocalScan[]> {
  const scans = eventId ? await listLocalScans(eventId) : await scannerDatabase.scans.toArray();
  return scans.filter((scan) => scan.status === 'accepted_local' || scan.status === 'pending');
}

export async function listLocalScans(eventId: string): Promise<LocalScan[]> {
  return scannerDatabase.scans.where('eventId').equals(eventId).reverse().sortBy('scannedAt');
}

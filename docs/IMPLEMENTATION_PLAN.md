# Implementation Plan

## Proposed technical stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, and PWA support via a Vite-compatible service-worker/plugin approach.
- Backend: TypeScript API using Fastify, schema validation with Zod or an equivalent runtime validator, and structured request logging.
- Database: PostgreSQL with Prisma ORM and checked-in Prisma migrations.
- Offline data: IndexedDB through a small repository layer (Dexie is the proposed adapter); service worker caches only approved application assets, not authorization decisions.
- Authentication: adapter-based implementation pending D-001; all authorization checks remain server-side.
- Exports: server-generated CSV and XLSX, streamed or paginated for large events.
- Tooling: ESLint, Prettier, Vitest, API integration tests, and Playwright for critical browser flows.

## Core database entities

1. `User` — authenticated person, status, audit timestamps.
2. `Role` / `Permission` — administrator and coordinator permissions; scanner access is assignment-driven.
3. `Event` — event metadata and lifecycle status.
4. `EventDay` — one or more calendar days belonging to an event.
5. `AttendanceSession` — time-in, time-out, or custom session for an event day.
6. `Student` — official masterlist identity and approved fields.
7. `StudentQrToken` — opaque token, status, replacement history, and revocation metadata.
8. `MasterlistImport` / `MasterlistImportRow` — source file metadata, validation result, and import audit trail.
9. `EventRoster` — event-specific student eligibility snapshot.
10. `ScannerAssignment` — user-to-event assignment and permitted sessions.
11. `ScannerDevice` — registered device identity, status, and last-seen data.
12. `OfflineEventPack` — versioned, signed/hashed event data pack with expiry and revocation state.
13. `AttendanceRecord` — accepted or rejected scan outcome, timestamps, source, device, and idempotency key.
14. `SyncAttempt` — retry history and visible failure reason for offline scans.
15. `AuditLog` — security-sensitive and configuration activity.

Required database protections include a unique constraint on `(session_id, student_id)` for accepted attendance, a unique immutable idempotency key for each local scan, foreign keys for event/day/session relationships, and indexes for coordinator dashboards and synchronization queries.

## API modules

- `auth`: login, logout, session refresh, current user, and authentication-provider adapter.
- `users-and-permissions`: user lifecycle, roles, permissions, and administrator-only changes.
- `students-and-masterlists`: import validation, preview, commit, student lookup, and QR-token management.
- `events`: event CRUD, lifecycle transitions, event-day and session configuration.
- `event-rosters`: roster snapshot creation, import reconciliation, and eligibility queries.
- `scanner-assignments`: event-scoped officer assignment, session permissions, revoke.
- `offline-packs`: issue, download, validate, version, expire, and revoke event packs.
- `attendance`: online scan submission, duplicate handling, domain rejection reasons, and attendance queries.
- `sync`: idempotent batch upload, per-item result, retry guidance, and device status.
- `reports-and-exports`: filtered summaries, CSV, XLSX, and export audit events.
- `health-and-audit`: readiness, database health, audit search, and operational diagnostics.

## Offline-sync design

1. A coordinator authorizes an event pack for a registered scanner device/user and selected sessions.
2. The device verifies pack integrity, expiry, revocation state, and completeness before enabling scanning.
3. Each scan creates an immutable device-generated idempotency key and a durable local queue record before showing success.
4. The scanner may resolve a QR token locally only against the authorized roster/token data in the pack.
5. When connectivity returns, the device uploads batches with the idempotency key, device timestamp, pack version, session, and token.
6. The server rechecks authorization, pack validity, roster eligibility, session timing policy, token status, and uniqueness in a transaction.
7. The server returns an item result such as accepted, duplicate, invalid token, not rostered, stale pack, or unauthorized.
8. Retries return the original result for an already-processed idempotency key; they never create a second attendance record.
9. Failed items remain visible in the queue with their reason and can be retried only when the reason is retryable.
10. Device timestamp and server receipt timestamp are retained; clock skew is displayed and never trusted as the sole authorization input.

## Testing foundation

- Unit tests: token parsing, session timing/late derivation, authorization policies, idempotency, clock-skew classification, and export shaping.
- Database/API integration tests: unique attendance race from two devices, retries, transaction rollback, roster enforcement, pack expiry/revocation, and permission boundaries.
- Frontend tests: scanner state transitions, offline queue persistence, sync-result rendering, keyboard/accessibility behavior, and coordinator form validation.
- End-to-end tests: administrator permission flow, coordinator event setup, pack download, offline scan simulation, reconnection sync, duplicate explanation, and export download.
- Security checks: dependency audit, secret scanning, authorization regression tests, and verification that QR payloads contain no personal information.

## Phased delivery

### Phase 0 — Approved planning

Finalize the decisions in `DECISIONS.md`, confirm deployment constraints, and convert this plan into an acceptance checklist.

### Phase 1 — Project foundation

Create frontend/backend structure, configure React/Vite/Tailwind/PWA and TypeScript API, configure PostgreSQL/Prisma, add environment examples, lint/format/test foundations, create approved core migrations, seed fictional students, and document local setup. Do not build full pages, scanning, offline sync, or reports in this phase.

### Phase 2 — Identity, permissions, and event setup

Implement the approved login method, server authorization, users/permissions, events, event days, sessions, and event-scoped scanner assignments. The current Phase 2 increment intentionally excludes masterlist import, QR token management, and event rosters; those are deferred until the attendance data boundary is approved.

### Phase 3 — Student eligibility boundary

Implement masterlist import, QR token management, and event-roster snapshots after the Phase 2 foundation is reviewed. This remains separate from scanning and offline synchronization.

### Phase 4 — Scanner Officer experience

Implement authorized event-pack issuance and freshness checks, IndexedDB storage, mobile scanner workflow, durable local queue, local duplicate feedback, and visible online/offline state. Do not claim server synchronization is complete.

### Phase 5 — Authoritative synchronization

Implement idempotent server sync, PostgreSQL attendance records, server duplicate prevention, retry-safe rejection reasons, and sync queue state transitions.

### Phase 6 — Monitoring and reports

Implement coordinator dashboards, attendance monitoring, audit views, CSV/XLSX exports, filters, and export authorization.

### Phase 7 — Hardening and release

Complete accessibility, performance, security, backup/restore, device and clock-skew scenarios, observability, user acceptance testing, deployment, and operational runbooks.

## Phase gates

- Do not start a later phase without approval of the previous phase.
- A feature is complete only with a user-visible path, server authorization, automated verification where practical, and documented limitations.
- Offline, sync, QR, and report functionality must not be declared complete without reproducible tests or manual scenarios.

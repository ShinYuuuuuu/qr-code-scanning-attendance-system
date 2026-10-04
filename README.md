# QR-Based School Event Attendance Management System

Phase 7 release-readiness baseline for the school event attendance system. The project includes authentication, event/session setup, masterlist and opaque QR credentials, event-scoped scanner packs, offline queue synchronization, duplicate protection, coordinator monitoring, search, and CSV/XLSX reports.

## Local setup

Prerequisites: Node.js 20+, npm, and PostgreSQL 15+ for migration validation/deployment.

```powershell
npm install
Copy-Item apps/api/.env.example apps/api/.env
```

Set local values in `apps/api/.env`. Never commit `.env`, API keys, passwords, or real student data. For local demo users, set the `SEED_*_EMAIL` and `SEED_*_PASSWORD` variables listed in the example file.

When PostgreSQL is available:

```powershell
npx prisma generate --schema apps/api/prisma/schema.prisma
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Run the API and web app in separate terminals:

```powershell
npm run dev --workspace @attendance/api
npm run dev --workspace @attendance/web
```

Open the Vite URL shown by the web command. Use fictional students for local testing.

## Checks and tests

```powershell
npm test
npm run test --workspace @attendance/api -- tests/pilot-flow.test.ts
npm run lint
npm run format:check
npm run build
$env:DATABASE_URL='postgresql://attendance:local-only@localhost:5432/attendance'
npx prisma validate --schema apps/api/prisma/schema.prisma
```

The automated pilot-flow integration test covers event creation, student import, scanner assignment, authorized pack download, deferred offline scan submission, synchronization, cross-device duplicate rejection, and CSV export. Follow [docs/PILOT_TEST.md](docs/PILOT_TEST.md) for the camera/offline manual pilot. The existing [Phase 4 offline test](docs/MANUAL_TEST_PHASE4_OFFLINE_SCANNING.md) covers the camera flow with internet disabled.

## Current release boundary

The development API currently uses an in-memory domain adapter; Prisma schemas and migrations define the PostgreSQL persistence boundary but are not yet wired into the runtime repository. Browser camera E2E remains a manual pilot step because no browser automation dependency/browser binary is checked into this repository. The Vite build reports a non-blocking scanner chunk-size warning.

Before production deployment, configure the approved authentication, timezone, hosting, retention, and backup decisions; provide a strong `COOKIE_SECRET` and explicit `WEB_ORIGIN` in production; run migrations against managed PostgreSQL; configure HTTPS, encrypted backups, monitoring, restore drills, and a real-device pilot.

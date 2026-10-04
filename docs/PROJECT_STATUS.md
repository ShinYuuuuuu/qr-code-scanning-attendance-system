# Project Status

phase: "phase_7_hardening_and_release_readiness"
status: "implemented_pending_review"
application_code_created: true
dependencies_installed: true
source_instruction_file: "AGENTS.md.txt (AGENTS.md was not present)"
planning_documents_created:

- docs/PROJECT_SPEC.md
- docs/DECISIONS.md
- docs/IMPLEMENTATION_PLAN.md
- docs/PROJECT_STATUS.md
- docs/PILOT_TEST.md
- docs/acceptance-checklist.md

## Current state

Phase 7 release-readiness work is implemented on top of Phase 6. The project now has a complete API pilot-flow integration test, release acceptance checklist, step-by-step pilot procedure, production configuration guards, event-pack integrity hashes, visible clock-skew values, and administrator-only audit access. Scanner Officer routing and sync contracts remain unchanged.

The API currently uses an in-memory domain adapter so synchronization can be tested without a live PostgreSQL instance. Migration `0004_phase5_authoritative_sync` adds `ScannerDevice`, `AttendanceRecord`, and `SyncAttempt`, including unique idempotency and `(sessionId, studentId)` constraints for the PostgreSQL deployment. Wiring the runtime repository to Prisma/PostgreSQL remains required before production use.

Event packs now carry an eligibility snapshot and a coordinator roster endpoint is available. When no explicit roster is configured in this development adapter, the snapshot falls back to imported students; no student names or personal information are placed in QR tokens.

Nullable `course` and `section` attributes were added to student records and the Prisma migration `0005_phase6_report_dimensions` because the approved reporting scope requires those dimensions. They are optional masterlist fields and do not alter QR or sync payloads. The 21st.dev MCP was searched for dashboard, data-table/filter, dialog, and responsive-layout references; the dashboard adapts those layout/accessibility patterns without copying application logic.

Phase 7 adds Prisma migration `0006_phase7_release_hardening` for attendance clock skew and audit-log persistence. The development adapter records login/logout, event changes, assignments, pack issuance, QR lifecycle changes, sync batches, and report exports. A System Administrator can review the development audit stream at `/api/audit`.

`docs/architecture.md` and `docs/decisions.md` referenced by `AGENTS.md.txt` were not present; the implementation follows the supplied `PROJECT_SPEC.md`, `DECISIONS.md`, and `IMPLEMENTATION_PLAN.md`.

## Verification

- `npm test` - 20 tests passed: prior authorization/import/QR/event-pack/sync/report coverage plus production configuration guards, the complete pilot-flow integration, and administrator audit access.
- `npm run test --workspace @attendance/api -- tests/pilot-flow.test.ts` - passed: event creation → import → assignment → pack → deferred offline sync → cross-device duplicate → CSV export.
- `npx vitest run tests/sync.test.ts -t "one device"` - passed: first device accepted, second device rejected as `duplicate`, one attendance entry retained.
- `npm run build` - API TypeScript build and Vite/PWA frontend build passed.
- `npm run lint` - API and web lint passed.
- `npm run format:check` - all files passed Prettier validation.
- `npx prisma validate --schema apps/api/prisma/schema.prisma` - passed with a temporary local `DATABASE_URL`.

## Next step

Supabase project `qr-school-attendance` (`jtdznmjjymodsckhilae`, region `ap-southeast-1`) has been provisioned. Migrations 0001-0007 are applied, and Row Level Security is enabled on all 15 application tables with default-deny behavior. Policies must be added with the Supabase Auth integration.

Next, wire the runtime repository to Prisma/PostgreSQL, resolve D-001–D-008, and run `docs/PILOT_TEST.md` on two real devices before production approval.

# Phase 7 Pilot Test

This pilot uses fictional data and verifies the complete coordinator/scanner/report path. Run the API and web app locally, sign in with configured demo users, and use two separate browser profiles or devices for the two scanner officers.

## Preparation

1. Start PostgreSQL if you are validating migrations, then run `npm install` and the setup commands in the root `README.md`.
2. Start the API and web app in separate terminals.
3. Configure one coordinator account and two Scanner Officer accounts with the `SEED_*` variables. Do not use real student records.
4. Prepare this fictional CSV:

   ```csv
   student_id,name,year_level,course,section
   PILOT-001,Fictional Pilot Student,7,Science,7-A
   PILOT-002,Fictional Second Student,8,Arts,8-B
   ```

## Test procedure

### 1. Create an event

1. Sign in as the Event Coordinator.
2. Create `Fictional Attendance Pilot`.
3. Add one event day and a `Time-In` session whose window includes the current time.

Expected: the event appears in the coordinator dashboard and event setup view.

### 2. Import students

1. Open Student Management.
2. Upload the fictional CSV and review the preview.
3. Confirm the preview has no row errors, then import it.
4. Open the student records view and search for `PILOT-001`.

Expected: both fictional students appear with year level, course, and section. Generate a QR credential for `PILOT-001`; its payload must be an opaque token and must not contain the student name or other personal information.

### 3. Assign scanners

1. Assign Scanner Officer A to the event and permit the `Time-In` session.
2. Assign Scanner Officer B to the same event/session for the duplicate test.
3. Sign out and verify an unassigned Scanner Officer cannot open the event or download its pack.

Expected: authorization is enforced by the API, not just by hidden UI controls.

### 4. Download event packs

1. Sign in as Scanner Officer A on device A.
2. Open the assigned event and download its authorized pack.
3. Repeat on device B for Scanner Officer B.

Expected: each pack shows its event, permitted session, expiry, device binding, and a non-empty integrity hash. A pack without integrity metadata must not enable scanning.

### 5. Scan while offline

1. On device A, select `Time-In` and confirm the online indicator is visible.
2. Disable Wi-Fi/mobile data or use browser DevTools Network → Offline.
3. Scan the QR credential for `PILOT-001`.
4. Confirm immediate local success and that the queue shows a pending scan with a permanent idempotency key.
5. Scan the same QR again on device A and confirm local likely-duplicate feedback.

Expected: camera mode remains available, no network request is required to queue the scan, and the pending item is retained in IndexedDB.

### 6. Reconnect and synchronize

1. Restore internet access on device A.
2. Use `Sync queued scans` or wait for the online transition.
3. Confirm the queue changes from pending to accepted and shows the server receipt result.

Expected: the server accepts one attendance record. Repeating synchronization with the same idempotency key returns the original result and does not create another record.

### 7. Test cross-device duplicate protection

1. On device B, scan the same `PILOT-001` QR during the same `Time-In` session while offline.
2. Reconnect device B and synchronize.

Expected: the server rejects device B's scan as `duplicate`, preserves the original accepted record, and shows the rejection reason in the queue.

### 8. Export a report

1. Return to the coordinator account and open the Attendance report.
2. Filter by event, day, session, course, year level, and section.
3. Verify the accepted student record and server/device timestamps, including clock-skew seconds.
4. Export both CSV and XLSX, then use Print for the print-friendly view.

Expected: exports contain only authorized event data, include the accepted attendance once, and do not expose QR token payloads.

## Evidence to record

- Date/time, browser/device pair, and build commit.
- Screenshot or copy of the pending → accepted queue transition.
- The duplicate rejection reason from device B.
- CSV/XLSX filenames and row counts.
- Any offline, permission, stale-pack, or camera errors.

## Known pilot boundary

The current development API uses an in-memory adapter, so restarting the API clears demo users, events, attendance, and audit entries. Production requires wiring the Prisma models/migrations to PostgreSQL, approved authentication and retention decisions, HTTPS, encrypted backups, monitoring, and a real-device browser pilot.

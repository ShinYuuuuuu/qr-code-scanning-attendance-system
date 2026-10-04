# Phase 4 Manual Test: Scanning With Internet Disabled

This test verifies local event-pack use, camera feedback, IndexedDB durability, and local duplicate detection. It does not test synchronization; server confirmation is intentionally unavailable in Phase 4.

## Setup

1. Configure local development users in `apps/api/.env` using fictional accounts only.
2. Start the API with `npm run dev --workspace @attendance/api`.
3. Start the web app with `npm run dev --workspace @attendance/web`.
4. Log in as a coordinator and create an event with at least one event day and attendance session.
5. Assign a fictional Scanner Officer to that event and session.
6. Import fictional students through the Phase 3 masterlist workflow and generate one opaque QR token for a student. Encode that token as a QR image for the test device; the token must contain no name or personal information.

## Procedure

1. On a phone or browser with camera access, log in as the Scanner Officer.
2. Open the assigned event and choose **Download / refresh pack** while online.
3. Confirm the pack version and expiry are visible, the status is **Fresh**, and the selected attendance session is available.
4. Open browser developer tools and set the network profile to **Offline** (or disable Wi-Fi/mobile data after the pack has finished downloading).
5. Confirm the UI changes to **Offline** and remains on the assigned-event screen.
6. Open the QR scanner and scan the fictional student QR image.
7. Confirm immediate feedback says it was saved locally, the camera remains active, and the local queue shows one pending local scan.
8. Scan the same QR image again for the same session.
9. Confirm immediate feedback identifies a likely duplicate and the queue count does not increase.
10. Scan a QR image containing a random opaque token that is not in the pack.
11. Confirm immediate feedback identifies an invalid QR and the queue does not gain an accepted scan.
12. Refresh the page while still offline. Confirm the saved pack and local queue remain available through IndexedDB.
13. Restore network access. Confirm the indicator returns to **Online**. No synchronization should start; pending local scans must remain visibly pending until a later phase implements server sync.

## Expected result

The Scanner Officer can use an authorized, fresh event pack without internet, receives fast local success/invalid/duplicate feedback, returns to camera mode after each scan, and retains queued scans after refresh. The server remains the final authority; this test must not be reported as proof of synchronized attendance.

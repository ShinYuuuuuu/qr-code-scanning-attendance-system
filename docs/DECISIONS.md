# Decisions Requiring Approval

These decisions are intentionally unresolved. No implementation should encode a final choice until approved. Recommended defaults are provided to make review faster.

| ID    | Decision                   | Recommended default                                                                                                                                          | Alternatives / impact                                                                                                                 | Status            |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| D-001 | Login method               | School-managed email/username plus password, with optional administrator-enforced MFA                                                                        | SSO/OIDC is preferable if the school already has an identity provider; magic links are less practical for offline scanner preparation | Awaiting approval |
| D-002 | System timezone            | One configured school timezone, stored as an IANA timezone (for example `Asia/Singapore`)                                                                    | Per-event timezone supports multi-campus events but increases configuration and reporting complexity                                  | Awaiting approval |
| D-003 | QR replacement rules       | A student has one active opaque QR token; administrators can revoke it and issue a replacement while retaining token history                                 | Allowing multiple active tokens improves transition periods but increases pack size and revocation complexity                         | Awaiting approval |
| D-004 | Late rules                 | Record the scan and calculate a derived `late` flag using a session-configured grace period; never reject a late scan solely because it is late              | Reject late scans, or use a global cutoff, would lose attendance evidence and reduce reporting flexibility                            | Awaiting approval |
| D-005 | Student event-roster scope | Each event receives an explicit imported roster snapshot; only rostered students can be accepted                                                             | Global masterlist eligibility is simpler but risks admitting students who are not registered for the event                            | Awaiting approval |
| D-006 | Privacy retention          | Keep attendance and audit records for a school-approved retention period, then anonymize or delete according to policy; retain aggregate counts where lawful | Indefinite retention improves historical reporting but increases privacy and storage obligations                                      | Awaiting approval |
| D-007 | Hosting                    | Managed application hosting with managed PostgreSQL in a school-approved region                                                                              | Self-hosting gives more control but increases operations, patching, monitoring, and disaster-recovery work                            | Awaiting approval |
| D-008 | Backups                    | Automated encrypted PostgreSQL backups with daily full recovery points, point-in-time recovery where available, and a documented restore test schedule       | Manual backups reduce cost but create unacceptable recovery risk for attendance records                                               | Awaiting approval |

## Provisional implementation choices (not policy approval)

- Phase 2 includes a password-based login adapter with an HTTP-only session cookie because D-001 is still unresolved. The adapter can be replaced with the approved school SSO/OIDC provider without changing event authorization rules.
- Event and session timestamps are stored as ISO timestamps. Event timezone is optional until D-002 is approved; no final school timezone is assumed.
- Session windows and an optional `lateAfterMinutes` field are configurable, but Phase 2 does not record attendance or calculate late status. D-004 remains a policy decision for the attendance phase.
- Phase 6 adds nullable `course` and `section` student fields plus report filters because the approved reporting scope requires those dimensions. They are optional masterlist attributes, do not change QR or sync payloads, and remain blank when the official source does not provide them.
- Phase 7 adds an `integrityHash` to issued offline event packs because the baseline specification requires an integrity signal and incomplete packs must not enable scanning. The scan synchronization payload and idempotency contract are unchanged.

## Approval format

Reply with the IDs and choices to approve, for example:

`D-001: OIDC; D-002: Asia/Singapore; D-003: one active token with revocation; ...`

If a choice needs school policy input, mark it `TBD` and identify the owner. The implementation plan will be updated after approval.

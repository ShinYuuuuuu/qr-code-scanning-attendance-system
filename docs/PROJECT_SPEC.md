# QR-Based School Event Attendance Management System

Machine-readable baseline specification. Values marked `TBD` require approval in `DECISIONS.md`.

```yaml
spec_version: '0.1'
status: planning
product: school_event_attendance_management
source_of_truth: postgresql

actors:
  system_administrator:
    scope: global
    capabilities:
      [manage_users, manage_permissions, manage_system_configuration, audit_system_activity]
  event_coordinator:
    scope: assigned_events_or_coordinator_scope
    capabilities:
      [
        create_and_edit_events,
        import_student_masterlists,
        configure_event_days,
        configure_attendance_sessions,
        assign_scanner_officers_to_events,
        issue_and_revoke_offline_event_packs,
        monitor_attendance,
        export_attendance_reports,
      ]
  scanner_officer:
    scope: specific_event_assignment_only
    capabilities:
      [download_authorized_event_pack, scan_attendance_qr_codes, view_local_scan_and_sync_status]
    constraints: [not_a_permanent_global_role, assigned_event_and_permitted_sessions_only]

authorization:
  server_enforced: true
  browser_only_authorization_forbidden: true
  scanner_assignment_scope: event
  permissions_are_audited: true
  revoked_credentials_must_fail_new_requests: true

identity_and_student_data:
  official_student_source: official_student_masterlist
  student_identity_fields:
    required: [student_id, display_name]
    optional: [grade_level, section, other_approved_masterlist_fields]
  qr_code:
    payload_type: opaque_unique_token
    may_contain: [token_or_identifier]
    must_not_contain: [student_name, personal_information, attendance_status]
  qr_token:
    server_resolves_to: student
    revocation_supported: true

event_model:
  event:
    required_fields: [id, name, status, created_by, created_at]
    statuses: [draft, published, active, completed, archived, cancelled]
  event_day:
    required_fields: [id, event_id, local_date, sequence]
    uniqueness: [event_id, local_date]
  attendance_session:
    required_fields: [id, event_day_id, name, session_type, starts_at, ends_at]
    session_types: [time_in, time_out, custom]
    uniqueness: [event_day_id, name]
  event_roster:
    source: imported_student_masterlist_snapshot
    scope_decision: TBD_DECISION_STUDENT_EVENT_ROSTER_SCOPE
  scanner_assignment:
    fields: [event_id, user_id, permitted_session_ids, assigned_at, revoked_at]
    constraint: user_is_scanner_officer_only_for_this_event_assignment

attendance:
  invariants:
    - at_most_one_accepted_attendance_per_session_and_student
    - server_enforces_unique_session_id_student_id
    - idempotency_key_is_immutable_and_retry_safe
    - original_successful_record_is_preserved
    - duplicate_rejection_explains_existing_record_or_reason
    - device_and_server_timestamps_are_both_retained
  clock_skew:
    device_timestamp_is_untrusted_for_authorization: true
    server_receipt_timestamp_is_authoritative: true
    skew_is_recorded_and_visible: true

offline_operation:
  requirement: scanner_must_work_without_internet_after_authorized_pack_download
  event_pack_must_include:
    [
      pack_id,
      event_id,
      event_version,
      authorized_assignment,
      eligible_event_roster,
      opaque_qr_token_resolution_data,
      permitted_sessions,
      issued_at,
      expires_at,
      revocation_state,
      integrity_signature_or_hash,
    ]
  validity_requirements:
    [
      issued_for_authenticated_device_or_user,
      not_expired,
      not_revoked,
      complete_and_integrity_verified,
    ]
  local_storage: indexeddb
  synchronization:
    [retry_safe, preserves_failed_records, exposes_failure_reason, server_revalidates_every_scan]

reporting:
  exports: [csv, xlsx]
  authorization: coordinator_or_administrator_only

security_and_privacy:
  transport: https_only_in_nonlocal_environments
  secrets_in_git: false
  real_student_data_in_seed_or_git: false
  privacy_retention: TBD_DECISION_PRIVACY_RETENTION
  backups: TBD_DECISION_BACKUPS
  hosting: TBD_DECISION_HOSTING

unresolved_decisions:
  [
    login_method,
    timezone,
    qr_replacement_rules,
    late_rules,
    student_event_roster_scope,
    privacy_retention,
    hosting,
    backups,
  ]
```

-- Enable Row Level Security on every application table exposed through Supabase.
-- Policies are added with the Supabase Auth integration once role claims and
-- event-scoped assignment checks are finalized. Until then, the default-deny
-- behavior prevents anon/authenticated Data API access.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScannerAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScannerAssignmentSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentQrCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MasterlistImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MasterlistImportRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfflineEventPack" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScannerDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

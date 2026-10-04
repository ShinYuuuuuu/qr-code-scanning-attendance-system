CREATE TABLE "ScannerDevice" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3)
);
CREATE INDEX "ScannerDevice_userId_revokedAt_idx" ON "ScannerDevice"("userId", "revokedAt");

CREATE TABLE "AttendanceRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "idempotencyKey" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "qrCredentialId" TEXT NOT NULL,
  "scannedAtDevice" TIMESTAMP(3) NOT NULL,
  "receivedAtServer" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AttendanceRecord_idempotencyKey_key" ON "AttendanceRecord"("idempotencyKey");
CREATE UNIQUE INDEX "AttendanceRecord_sessionId_studentId_key" ON "AttendanceRecord"("sessionId", "studentId");
CREATE INDEX "AttendanceRecord_eventId_sessionId_idx" ON "AttendanceRecord"("eventId", "sessionId");
CREATE INDEX "AttendanceRecord_deviceId_scannedAtDevice_idx" ON "AttendanceRecord"("deviceId", "scannedAtDevice");

CREATE TYPE "SyncAttemptStatus" AS ENUM ('ACCEPTED', 'REJECTED');
CREATE TABLE "SyncAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "idempotencyKey" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "qrTokenHash" TEXT NOT NULL,
  "status" "SyncAttemptStatus" NOT NULL,
  "reason" TEXT,
  "message" TEXT NOT NULL,
  "scannedAtDevice" TIMESTAMP(3) NOT NULL,
  "receivedAtServer" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SyncAttempt_idempotencyKey_key" ON "SyncAttempt"("idempotencyKey");
CREATE INDEX "SyncAttempt_deviceId_receivedAtServer_idx" ON "SyncAttempt"("deviceId", "receivedAtServer");
CREATE INDEX "SyncAttempt_eventId_sessionId_status_idx" ON "SyncAttempt"("eventId", "sessionId", "status");

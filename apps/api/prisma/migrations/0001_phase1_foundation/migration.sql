-- Phase 1 foundation migration is intentionally checked in for review.
-- Run `npx prisma migrate deploy` after PostgreSQL is configured.
CREATE TYPE "UserRole" AS ENUM ('SYSTEM_ADMINISTRATOR', 'EVENT_COORDINATOR', 'SCANNER_OFFICER');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED', 'ARCHIVED', 'CANCELLED');
CREATE TYPE "SessionType" AS ENUM ('TIME_IN', 'TIME_OUT', 'CUSTOM');

CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Event" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
  "timezone" TEXT,
  "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Event_createdById_idx" ON "Event"("createdById");

CREATE TABLE "EventDay" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventId" TEXT NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "localDate" TIMESTAMP(3) NOT NULL,
  "sequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("eventId", "localDate"), UNIQUE ("eventId", "sequence")
);

CREATE TABLE "AttendanceSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventDayId" TEXT NOT NULL REFERENCES "EventDay"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "sessionType" "SessionType" NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "lateAfterMinutes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("eventDayId", "name")
);
CREATE INDEX "AttendanceSession_startsAt_endsAt_idx" ON "AttendanceSession"("startsAt", "endsAt");

CREATE TABLE "ScannerAssignment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventId" TEXT NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  UNIQUE ("eventId", "userId")
);
CREATE INDEX "ScannerAssignment_userId_revokedAt_idx" ON "ScannerAssignment"("userId", "revokedAt");

CREATE TABLE "ScannerAssignmentSession" (
  "assignmentId" TEXT NOT NULL REFERENCES "ScannerAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sessionId" TEXT NOT NULL REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY ("assignmentId", "sessionId")
);

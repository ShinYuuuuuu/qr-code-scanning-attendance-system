CREATE TYPE "QrCredentialStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "Student" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "studentId" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "yearLevel" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "StudentQrCredential" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "token" TEXT NOT NULL UNIQUE,
  "status" "QrCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "replacedByCredentialId" TEXT
);
CREATE INDEX "StudentQrCredential_studentId_status_idx" ON "StudentQrCredential"("studentId", "status");

CREATE TABLE "MasterlistImport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "filename" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MasterlistImportRow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "importId" TEXT NOT NULL REFERENCES "MasterlistImport"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "rowNumber" INTEGER NOT NULL,
  "studentId" TEXT,
  "name" TEXT,
  "yearLevel" TEXT,
  "errors" JSONB
);
CREATE INDEX "MasterlistImportRow_importId_rowNumber_idx" ON "MasterlistImportRow"("importId", "rowNumber");

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('OFFICE_HOURS', 'HUDDLE', 'SHOW_AND_TELL', 'WORKSHOP', 'SOCIAL', 'OTHER');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_CREATE_PROGRAM_EVENT';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_UPDATE_PROGRAM_EVENT';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_DELETE_PROGRAM_EVENT';

-- CreateTable
CREATE TABLE "program_event" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "EventKind" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "link" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "seriesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "program_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "program_event_published_startsAt_idx" ON "program_event"("published", "startsAt");

-- CreateIndex
CREATE INDEX "program_event_seriesId_idx" ON "program_event"("seriesId");
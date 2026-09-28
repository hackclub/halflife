-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'USER_DISPUTE_REVIEW';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_RESOLVE_DISPUTE';

-- CreateTable
CREATE TABLE "review_dispute" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "review_dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_dispute_submissionId_key" ON "review_dispute"("submissionId");

-- CreateIndex
CREATE INDEX "review_dispute_resolvedAt_idx" ON "review_dispute"("resolvedAt");

-- AddForeignKey
ALTER TABLE "review_dispute" ADD CONSTRAINT "review_dispute_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "phase_submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_dispute" ADD CONSTRAINT "review_dispute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

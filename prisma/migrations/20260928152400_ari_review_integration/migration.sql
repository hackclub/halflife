-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ARI_SYNC_SUCCESS';
ALTER TYPE "AuditAction" ADD VALUE 'ARI_SYNC_FAILURE';
ALTER TYPE "AuditAction" ADD VALUE 'ARI_WEBHOOK_APPLIED';
ALTER TYPE "AuditAction" ADD VALUE 'ARI_WEBHOOK_IGNORED';

-- AlterTable
ALTER TABLE "phase_submission" ADD COLUMN     "ariDecision" TEXT,
ADD COLUMN     "ariStatus" TEXT,
ADD COLUMN     "ariSubmissionId" TEXT,
ADD COLUMN     "ariSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "submission_review" ALTER COLUMN "reviewerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ari_webhook_delivery" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "ariSubmissionId" TEXT,
    "externalId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ari_webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ari_webhook_delivery_deliveryId_key" ON "ari_webhook_delivery"("deliveryId");

-- CreateIndex
CREATE INDEX "ari_webhook_delivery_receivedAt_idx" ON "ari_webhook_delivery"("receivedAt");

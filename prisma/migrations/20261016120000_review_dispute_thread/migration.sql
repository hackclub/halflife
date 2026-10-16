-- CreateEnum
CREATE TYPE "ReviewDisputeOutcome" AS ENUM ('upheld', 'stood');

-- AlterTable
ALTER TABLE "review_dispute" DROP COLUMN "resolutionNote",
ADD COLUMN "outcome" "ReviewDisputeOutcome";

-- CreateTable
CREATE TABLE "review_dispute_message" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "fromReviewer" BOOLEAN NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_dispute_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_dispute_message_disputeId_createdAt_idx" ON "review_dispute_message"("disputeId", "createdAt");

-- AddForeignKey
ALTER TABLE "review_dispute_message" ADD CONSTRAINT "review_dispute_message_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "review_dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_dispute_message" ADD CONSTRAINT "review_dispute_message_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

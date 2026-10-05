-- AlterTable
ALTER TABLE "help_ticket" ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedBy" TEXT;

-- CreateIndex
CREATE INDEX "help_ticket_resolvedAt_idx" ON "help_ticket"("resolvedAt");

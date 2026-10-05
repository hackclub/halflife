-- CreateTable
CREATE TABLE "help_ticket" (
    "id" TEXT NOT NULL,
    "authorSlackId" TEXT NOT NULL,
    "helpChannel" TEXT NOT NULL,
    "helpTs" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "help_ticket_helpChannel_helpTs_key" ON "help_ticket"("helpChannel", "helpTs");

-- CreateIndex
CREATE INDEX "help_ticket_authorSlackId_createdAt_idx" ON "help_ticket"("authorSlackId", "createdAt");

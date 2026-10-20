-- CreateTable
CREATE TABLE "slack_event_delivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "teamId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slack_event_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slack_event_delivery_eventId_key" ON "slack_event_delivery"("eventId");

-- CreateIndex
CREATE INDEX "slack_event_delivery_receivedAt_idx" ON "slack_event_delivery"("receivedAt");

-- A build approval can arrive before its design (Ari reviews each phase on
-- its own clock, and Half Life allows the build hand-in first). The event is
-- now stored whole and replayed by the retry job once the design is approved,
-- instead of relying on Ari's redelivery window being longer than the gap.
ALTER TABLE "ari_webhook_delivery" ADD COLUMN "appliedAt" TIMESTAMP(3);
ALTER TABLE "ari_webhook_delivery" ADD COLUMN "payload" JSONB;

CREATE INDEX "ari_webhook_delivery_appliedAt_idx" ON "ari_webhook_delivery"("appliedAt");

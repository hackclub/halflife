-- Timelapses are recorded on Lapse now rather than uploaded here. A session
-- keeps a reference to the Lapse timelapse it was checked against, and the
-- playback and thumbnail URLs Lapse handed back, in the columns the R2 uploads
-- already had for them.
ALTER TABLE "session_timelapse" ADD COLUMN "externalId" TEXT;

CREATE INDEX "session_timelapse_provider_externalId_idx" ON "session_timelapse"("provider", "externalId");

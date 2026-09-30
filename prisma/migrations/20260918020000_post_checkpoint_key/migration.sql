-- Which checkpoint on the trail a reel was posted for.
--
-- The trail asks for a reel at fixed points — the idea at the start of a design
-- week, then one every ten hours logged — and those nodes have to be told
-- apart. `kind` cannot do it: the 10h and the 20h reel are both PROGRESS, so
-- counting rows by kind marks the 20h node done the moment the 10h one lands.
--
-- Nullable and un-constrained on purpose. Most of the feed is posted outside
-- the trail and carries nothing here, and re-posting a reel for a node is
-- allowed — the newest row wins when the trail reads it back.
ALTER TABLE "post" ADD COLUMN "checkpointKey" TEXT;

CREATE INDEX "post_userId_checkpointKey_idx" ON "post"("userId", "checkpointKey");

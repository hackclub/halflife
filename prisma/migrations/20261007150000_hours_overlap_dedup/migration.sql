-- Records when a timelapse was RECORDED and which Hackatime project Lapse saw
-- while it ran.
--
-- `covered_seconds` alone says how long a recording was, not when, and a duration
-- with no date cannot be compared against Hackatime's tracked intervals. Without
-- these two columns a sitting tracked by both tools is paid for twice, because
-- the journal entry and the Hackatime link both claim the same minutes.
--
-- Both are nullable on purpose. Rows written before this migration have no
-- recording start, and a backfill fills only what Lapse still answers for.
-- Inventing a start from the row's own created_at would be wrong: that is when
-- the clip was ATTACHED, which can be days after the work, and a guessed window
-- would subtract Hackatime time from the wrong sitting.
ALTER TABLE "session_timelapse"
	ADD COLUMN "recordedAt" TIMESTAMP(3),
	ADD COLUMN "hackatimeProject" TEXT;

-- The tracked INTERVALS for a linked project, over the window they were fetched
-- for. `cached_seconds` answers "how much"; these answer "when", and only "when"
-- can be intersected with a recording window.
--
-- The fetch bounds travel with the data (`{ from, to, spans }`) because a cached
-- answer to a narrower question than the one being asked is not an answer: asked
-- about minutes outside its window it must refetch, not conclude "no overlap".
ALTER TABLE "hackatime_link"
	ADD COLUMN "cachedSpans" JSONB,
	ADD COLUMN "spansFetchedAt" TIMESTAMP(3),
	ADD COLUMN "spansFetchError" TEXT;

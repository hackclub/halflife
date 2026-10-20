-- The RSVP drain reads the rows it still has to push upstream: every row not
-- yet in Airtable, oldest first, with the rows that have failed too many
-- times left out. The index on (syncedToAirtable, syncAttempts, createdAt)
-- cannot supply that order, because syncAttempts is a range in the filter and
-- the index stops being ordered by createdAt before the order is used - so the
-- drain scanned and sorted the whole table on every run.
--
-- This one is partial on the rows the drain wants and ordered by createdAt, so
-- the drain walks them in the order it wants them and stops at its batch size.
CREATE INDEX "rsvp_buffer_createdAt_idx" ON "rsvp_buffer"("createdAt") WHERE ("syncedToAirtable" = false);

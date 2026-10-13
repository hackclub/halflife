-- A hand-in whose send to Ari failed for a reason a retry cannot fix - an unparseable
-- repo link, a missing title, an account with no Slack id.
--
-- The retry job replays every unsent hand-in hourly, so before this column the maker was
-- told nothing while the row churned forever. The notice is owed once per stuck hand-in,
-- not once per attempt, so the mark is what separates the first failure from the rest; and
-- it is the reason the project page can show, so a maker who never read the message still
-- finds out. A later successful send, or a fresh resubmission, clears it.
ALTER TABLE "phase_submission"
  ADD COLUMN "ariShipError" TEXT;

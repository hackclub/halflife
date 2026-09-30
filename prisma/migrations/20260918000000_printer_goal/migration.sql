-- The printer a participant is saving for.
--
-- Banking used to be paced by the funding tier (a fixed 2/5/10 hours a week),
-- which meant the expensive machines were unreachable from Tier 1 and the cheap
-- ones over-funded from Tier 3. It is now paced by the machine itself, so the
-- choice has to be stored, and it is economically load-bearing: it decides how
-- many hours of every approved design week mint into the printer fund.
--
-- Plain text rather than an enum or a relation. The catalogue is priced from a
-- budget spreadsheet and is expected to be re-priced between seasons; a machine
-- leaving it must not fail a migration or orphan a row. NULL means "has not
-- chosen", and every read falls back to the default goal.
ALTER TABLE "user" ADD COLUMN "printerGoalId" TEXT;

-- Reviews already freeze the tier's hour split so a payout stays reconstructable
-- after the tier table moves. Now that banking comes from the goal rather than
-- the tier, frozenBankHours alone no longer says where its number came from.
ALTER TABLE "submission_review" ADD COLUMN "frozenPrinterGoalId" TEXT;

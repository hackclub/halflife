-- A design whose parts list runs past what the tier funds can still be handed in, as
-- partial funding, provided the maker ticked the box saying they know. The two frozen
-- numbers are what they were shown when they ticked it: the cart total, and the tier
-- funding that covers only part of it.
--
-- The grant itself does not move. A design's funding has always been the tier's flat
-- grantUsd paid through YSWS; this records the agreement, not a different payout.
ALTER TABLE "phase_submission"
  ADD COLUMN "partialFundingAccepted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requestedBomUsd" DOUBLE PRECISION,
  ADD COLUMN "fundingCapUsd" INTEGER;
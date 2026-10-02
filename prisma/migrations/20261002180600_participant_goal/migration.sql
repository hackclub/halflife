-- What a participant is here for, asked once the first checkpoint is done.
--
-- Nullable and with no default, deliberately. Every existing row stays null,
-- which the platform reads as "has not answered", so the goal prompt opens for
-- everyone who finished onboarding before this column existed rather than
-- silently defaulting them to the printer branch and never asking. Backfilling
-- would have been a guess about hundreds of teenagers.
--
-- `printerGoalId` is untouched here: the printer is a preference under the
-- PRINTER branch, and a participant who picks funding this week and a printer
-- next week should get their machine back rather than the default.

-- CreateEnum
CREATE TYPE "ParticipantGoal" AS ENUM ('PRINTER', 'FULL_FUNDING', 'PARTIAL_FUNDING');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'USER_SET_PARTICIPANT_GOAL';

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "participantGoal" "ParticipantGoal";

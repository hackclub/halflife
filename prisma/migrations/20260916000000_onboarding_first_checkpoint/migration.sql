-- CreateEnum
CREATE TYPE "HardwareExperience" AS ENUM ('FIRST_TIME', 'A_LITTLE', 'A_GOOD_AMOUNT', 'ITS_LIFE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'USER_ADVANCE_ONBOARDING';
ALTER TYPE "AuditAction" ADD VALUE 'USER_COMPLETE_ONBOARDING';

-- AlterTable
ALTER TABLE "theme_project" ADD COLUMN     "requestedTier" INTEGER,
ADD COLUMN     "starterProjectId" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "hardwareExperience" "HardwareExperience",
ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trackingTutorialDismissedAt" TIMESTAMP(3);


-- Time markers for analytics: when each funnel step first happened per
-- person, last login and last activity, a row per active day (DAU) and per
-- week logged (hour milestones). All additive; existing rows read as null/0.
-- AlterTable
ALTER TABLE "user" ADD COLUMN     "activeDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "firstProjectAt" TIMESTAMP(3),
ADD COLUMN     "firstReelAt" TIMESTAMP(3),
ADD COLUMN     "firstSubmissionAt" TIMESTAMP(3),
ADD COLUMN     "lastActiveAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lastSubmissionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "theme_project" ADD COLUMN     "namedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "user_day" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_day_pkey" PRIMARY KEY ("userId","day")
);

-- CreateTable
CREATE TABLE "user_week" (
    "userId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reached1hAt" TIMESTAMP(3),
    "reached5hAt" TIMESTAMP(3),
    "reached10hAt" TIMESTAMP(3),
    "reached20hAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_week_pkey" PRIMARY KEY ("userId","week")
);

-- CreateIndex
CREATE INDEX "user_day_day_idx" ON "user_day"("day");

-- CreateIndex
CREATE INDEX "user_week_week_idx" ON "user_week"("week");

-- AddForeignKey
ALTER TABLE "user_day" ADD CONSTRAINT "user_day_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_week" ADD CONSTRAINT "user_week_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


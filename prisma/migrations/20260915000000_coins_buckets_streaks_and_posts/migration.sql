-- CreateEnum
CREATE TYPE "CoinBucket" AS ENUM ('SPENDABLE', 'BANKED');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('PROCESSING', 'PUBLISHED', 'HIDDEN', 'REMOVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'USER_CREATE_POST';
ALTER TYPE "AuditAction" ADD VALUE 'USER_DELETE_POST';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_HIDE_POST';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_RESTORE_POST';

-- AlterEnum
BEGIN;
CREATE TYPE "LedgerKind_new" AS ENUM ('DESIGN_BANKED_HOURS', 'DESIGN_EXCESS_HOURS', 'BUILD_HOURS', 'BOM_SAVINGS', 'THEME_COMPLETION_BONUS', 'PARTS_TOP_UP', 'ADMIN_ADJUSTMENT', 'REVIEWER_PAYMENT', 'SHOP_PURCHASE', 'SHOP_REFUND');
-- EXCESS_HOURS is remapped in the cast itself rather than by an UPDATE before
-- it: until this statement runs, the column's type is the OLD enum, which has
-- no BUILD_HOURS to assign. Going through ::text puts both vocabularies in
-- scope at once, so the rename happens in the same pass as the retype.
--
-- BUILD_HOURS is the right successor: the old kind was minted at BUILD
-- approval from hours beyond the tier minimum, so the phase, the trigger and
-- the (SPENDABLE) pot are all unchanged, and every balance sums the same
-- afterwards as before.
ALTER TABLE "ledger_entry" ALTER COLUMN "kind" TYPE "LedgerKind_new"
  USING (
    CASE "kind"::text
      WHEN 'EXCESS_HOURS' THEN 'BUILD_HOURS'
      ELSE "kind"::text
    END
  )::"LedgerKind_new";
ALTER TYPE "LedgerKind" RENAME TO "LedgerKind_old";
ALTER TYPE "LedgerKind_new" RENAME TO "LedgerKind";
DROP TYPE "public"."LedgerKind_old";
COMMIT;

-- AlterEnum
ALTER TYPE "ShopItemCategory" ADD VALUE 'PRINTER';

-- DropIndex
DROP INDEX "ledger_entry_shopOrderId_kind_key";

-- AlterTable
ALTER TABLE "ledger_entry" ADD COLUMN     "bucket" "CoinBucket" NOT NULL DEFAULT 'SPENDABLE';

-- AlterTable
ALTER TABLE "submission_review" DROP COLUMN "frozenExcessCredit",
ADD COLUMN     "frozenBankHours" DOUBLE PRECISION,
ADD COLUMN     "frozenBankedCoins" INTEGER,
ADD COLUMN     "frozenFundingHours" DOUBLE PRECISION,
ADD COLUMN     "frozenSpendableCoins" INTEGER;

-- AlterTable
ALTER TABLE "theme_project" DROP COLUMN "excessCredit",
ADD COLUMN     "bomSavingsUsd" INTEGER,
ADD COLUMN     "buildCoins" INTEGER,
ADD COLUMN     "designApprovedHours" DOUBLE PRECISION,
ADD COLUMN     "designApprovedHoursAt" TIMESTAMP(3),
ADD COLUMN     "designBankedCoins" INTEGER,
ADD COLUMN     "designSpendableCoins" INTEGER;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "currentStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastStreakDate" TEXT,
ADD COLUMN     "longestStreak" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "post" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "themeProjectId" TEXT,
    "caption" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "durationSeconds" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "status" "PostStatus" NOT NULL DEFAULT 'PROCESSING',
    "publishedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "hiddenReason" TEXT,
    "weekNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_view" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_view_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_status_publishedAt_idx" ON "post"("status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "post_userId_createdAt_idx" ON "post"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "post_themeProjectId_idx" ON "post"("themeProjectId");

-- CreateIndex
CREATE INDEX "post_view_userId_idx" ON "post_view"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "post_view_postId_userId_key" ON "post_view"("postId", "userId");

-- CreateIndex
CREATE INDEX "ledger_entry_userId_bucket_idx" ON "ledger_entry"("userId", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entry_shopOrderId_kind_bucket_key" ON "ledger_entry"("shopOrderId", "kind", "bucket");

-- AddForeignKey
ALTER TABLE "post" ADD CONSTRAINT "post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post" ADD CONSTRAINT "post_themeProjectId_fkey" FOREIGN KEY ("themeProjectId") REFERENCES "theme_project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_view" ADD CONSTRAINT "post_view_postId_fkey" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_view" ADD CONSTRAINT "post_view_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


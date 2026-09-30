-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('IDEA', 'PROGRESS', 'SUBMISSION', 'FREEFORM', 'ANNOUNCEMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'USER_COMMENT_POST';
ALTER TYPE "AuditAction" ADD VALUE 'USER_DELETE_COMMENT';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_HIDE_COMMENT';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_PIN_POST';

-- AlterTable
ALTER TABLE "post" ADD COLUMN     "commentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "PostKind" NOT NULL DEFAULT 'FREEFORM',
ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinnedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "post_like" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_like_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_comment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "post_comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_like_userId_idx" ON "post_like"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "post_like_postId_userId_key" ON "post_like"("postId", "userId");

-- CreateIndex
CREATE INDEX "post_comment_postId_createdAt_idx" ON "post_comment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "post_comment_userId_idx" ON "post_comment"("userId");

-- CreateIndex
CREATE INDEX "post_themeProjectId_kind_idx" ON "post"("themeProjectId", "kind");

-- AddForeignKey
ALTER TABLE "post_like" ADD CONSTRAINT "post_like_postId_fkey" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_like" ADD CONSTRAINT "post_like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comment" ADD CONSTRAINT "post_comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comment" ADD CONSTRAINT "post_comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


/*
  Warnings:

  - You are about to drop the `public_reels` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public_reels" DROP CONSTRAINT "public_reels_postId_fkey";

-- DropForeignKey
ALTER TABLE "public_reels" DROP CONSTRAINT "public_reels_themeProjectId_fkey";

-- DropForeignKey
ALTER TABLE "public_reels" DROP CONSTRAINT "public_reels_userId_fkey";

-- DropTable
DROP TABLE "public_reels";

-- CreateTable
CREATE TABLE "public_reel" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platform" "PublicReelPlatform" NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT,
    "themeProjectId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_reel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_reel_url_key" ON "public_reel"("url");

-- CreateIndex
CREATE INDEX "public_reel_userId_postedAt_idx" ON "public_reel"("userId", "postedAt");

-- CreateIndex
CREATE INDEX "public_reel_postId_idx" ON "public_reel"("postId");

-- CreateIndex
CREATE INDEX "public_reel_themeProjectId_idx" ON "public_reel"("themeProjectId");

-- AddForeignKey
ALTER TABLE "public_reel" ADD CONSTRAINT "public_reel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_reel" ADD CONSTRAINT "public_reel_postId_fkey" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_reel" ADD CONSTRAINT "public_reel_themeProjectId_fkey" FOREIGN KEY ("themeProjectId") REFERENCES "theme_project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

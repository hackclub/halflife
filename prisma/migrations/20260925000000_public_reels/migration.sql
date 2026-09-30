-- "Public Reels": a Half Life reel a participant has also posted publicly, one
-- row per link, so a post that goes viral can be found and paid for in coins.
-- CreateEnum
CREATE TYPE "PublicReelPlatform" AS ENUM ('INSTAGRAM', 'TIKTOK', 'X', 'YOUTUBE');

-- CreateTable
CREATE TABLE "public_reels" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platform" "PublicReelPlatform" NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT,
    "themeProjectId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_reels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_reels_url_key" ON "public_reels"("url");

-- CreateIndex
CREATE INDEX "public_reels_userId_postedAt_idx" ON "public_reels"("userId", "postedAt");

-- CreateIndex
CREATE INDEX "public_reels_postId_idx" ON "public_reels"("postId");

-- CreateIndex
CREATE INDEX "public_reels_themeProjectId_idx" ON "public_reels"("themeProjectId");

-- AddForeignKey
ALTER TABLE "public_reels" ADD CONSTRAINT "public_reels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_reels" ADD CONSTRAINT "public_reels_postId_fkey" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_reels" ADD CONSTRAINT "public_reels_themeProjectId_fkey" FOREIGN KEY ("themeProjectId") REFERENCES "theme_project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

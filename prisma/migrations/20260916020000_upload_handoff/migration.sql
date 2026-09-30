-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'USER_HANDOFF_UPLOAD';

-- CreateTable
CREATE TABLE "upload_handoff" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "objectKey" TEXT,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_handoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upload_handoff_tokenHash_key" ON "upload_handoff"("tokenHash");

-- CreateIndex
CREATE INDEX "upload_handoff_userId_createdAt_idx" ON "upload_handoff"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "upload_handoff_expiresAt_idx" ON "upload_handoff"("expiresAt");

-- AddForeignKey
ALTER TABLE "upload_handoff" ADD CONSTRAINT "upload_handoff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


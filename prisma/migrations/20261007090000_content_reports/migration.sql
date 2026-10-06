-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('REEL', 'REEL_COMMENT', 'PROJECT', 'USER', 'DEVLOG');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('EXCESSIVE_AI_USE', 'MISCONDUCT', 'SPAM', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'USER_CREATE_REPORT';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_RESOLVE_REPORT';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_DISMISS_REPORT';

-- CreateTable
CREATE TABLE "content_report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "target" "ReportTarget" NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "postId" TEXT,
    "commentId" TEXT,
    "themeProjectId" TEXT,
    "targetUserId" TEXT,
    "workSessionId" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_report_status_createdAt_idx" ON "content_report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "content_report_reporterId_idx" ON "content_report"("reporterId");

-- AddForeignKey
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_postId_fkey" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "post_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_themeProjectId_fkey" FOREIGN KEY ("themeProjectId") REFERENCES "theme_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

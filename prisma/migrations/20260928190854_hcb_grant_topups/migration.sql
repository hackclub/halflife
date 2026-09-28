-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_SEND_GRANT';

-- CreateTable
CREATE TABLE "hcb_grant_topup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "themeProjectId" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "grantHashid" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "transactionId" TEXT,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "hcb_grant_topup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hcb_grant_topup_userId_themeProjectId_phase_key" ON "hcb_grant_topup"("userId", "themeProjectId", "phase");

-- AddForeignKey
ALTER TABLE "hcb_grant_topup" ADD CONSTRAINT "hcb_grant_topup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hcb_grant_topup" ADD CONSTRAINT "hcb_grant_topup_themeProjectId_fkey" FOREIGN KEY ("themeProjectId") REFERENCES "theme_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

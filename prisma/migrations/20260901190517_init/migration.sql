-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('PCB', 'CAD', 'SYNTH', 'DISPLAYS', 'BREADBOARD_COMPUTER');

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('DESIGN', 'BUILD');

-- CreateEnum
CREATE TYPE "PhaseStatus" AS ENUM ('draft', 'in_review', 'update_requested', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ReviewResult" AS ENUM ('APPROVED', 'RETURNED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewPass" AS ENUM ('FIRST', 'FINAL');

-- CreateEnum
CREATE TYPE "HoursSource" AS ENUM ('MANUAL', 'HACKATIME_TRACKED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('EXCESS_HOURS', 'THEME_COMPLETION_BONUS', 'ADMIN_ADJUSTMENT', 'REVIEWER_PAYMENT', 'SHOP_PURCHASE', 'SHOP_REFUND');

-- CreateEnum
CREATE TYPE "ShopItemCategory" AS ENUM ('PRINTER_UPGRADE', 'CONSUMABLE', 'MISC');

-- CreateEnum
CREATE TYPE "ShopOrderStatus" AS ENUM ('PENDING', 'ON_HOLD', 'FULFILLED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrinterAwardStatus" AS ENUM ('QUALIFIED', 'ADDRESS_LOCKED', 'PACKING', 'SHIPPED', 'DELIVERED', 'REVOKED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'REVIEWER', 'FULFILLER', 'AUDITOR');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_UPDATE_PROJECT', 'USER_SUBMIT_PHASE', 'USER_UNSUBMIT_PHASE', 'USER_CREATE_SESSION', 'USER_UPDATE_SESSION', 'USER_DELETE_SESSION', 'USER_LINK_HACKATIME', 'USER_UNLINK_HACKATIME', 'USER_PLACE_ORDER', 'REVIEW_CLAIM', 'REVIEW_RELEASE', 'REVIEW_APPROVE', 'REVIEW_RETURN', 'REVIEW_REJECT', 'REVIEW_APPROVE_HOURS', 'ADMIN_UNAPPROVE_PHASE', 'ADMIN_REOPEN_PHASE', 'ADMIN_GRANT_ROLE', 'ADMIN_REVOKE_ROLE', 'ADMIN_FLAG_FRAUD', 'ADMIN_UNFLAG_FRAUD', 'ADMIN_GRANT_EXTENSION', 'ADMIN_ADJUST_CREDIT', 'ADMIN_DELETE_PROJECT', 'ADMIN_RESTORE_PROJECT', 'ADMIN_CREATE_SHOP_ITEM', 'ADMIN_UPDATE_SHOP_ITEM', 'ADMIN_RETIRE_SHOP_ITEM', 'ADMIN_FULFILL_ORDER', 'ADMIN_REJECT_ORDER', 'ADMIN_UPDATE_PROGRAM_SETTINGS', 'PRINTER_QUALIFIED', 'PRINTER_STATUS_CHANGE', 'PRINTER_REVOKED', 'AIRTABLE_SYNC_SUCCESS', 'AIRTABLE_SYNC_FAILURE', 'NOTIFICATION_FAILURE', 'SYSTEM_HACKATIME_SYNC', 'SYSTEM_CLAIM_SWEEP', 'SYSTEM_RSVP_DRAIN');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slackId" TEXT,
    "slackDisplayName" TEXT,
    "hackatimeUserId" TEXT,
    "verificationStatus" TEXT,
    "bio" TEXT,
    "pronouns" TEXT,
    "timezone" TEXT,
    "encryptedAddressStreet" TEXT,
    "encryptedAddressLine2" TEXT,
    "encryptedAddressCity" TEXT,
    "encryptedAddressState" TEXT,
    "encryptedAddressZip" TEXT,
    "encryptedAddressCountry" TEXT,
    "encryptedBirthday" TEXT,
    "encryptedPhone" TEXT,
    "joinedProgramAt" TIMESTAMP(3),
    "submissionExtensionUntil" TIMESTAMP(3),
    "fraudFlagged" BOOLEAN NOT NULL DEFAULT false,
    "utmSource" TEXT,
    "signupPage" TEXT,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theme_project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" "Theme" NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "coverImageKey" TEXT,
    "githubRepo" TEXT,
    "artifactLinks" JSONB,
    "designStatus" "PhaseStatus" NOT NULL DEFAULT 'draft',
    "designReviewComments" TEXT,
    "designReviewedAt" TIMESTAMP(3),
    "designReviewedById" TEXT,
    "buildStatus" "PhaseStatus" NOT NULL DEFAULT 'draft',
    "buildReviewComments" TEXT,
    "buildReviewedAt" TIMESTAMP(3),
    "buildReviewedById" TEXT,
    "tier" INTEGER,
    "grantUsd" INTEGER,
    "grantEmittedAt" TIMESTAMP(3),
    "approvedHours" DOUBLE PRECISION,
    "approvedHoursAt" TIMESTAMP(3),
    "excessCredit" INTEGER,
    "submissionExtensionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "theme_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_session" (
    "id" TEXT NOT NULL,
    "themeProjectId" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "hoursClaimed" DOUBLE PRECISION NOT NULL,
    "hoursApproved" DOUBLE PRECISION,
    "hoursSource" "HoursSource" NOT NULL DEFAULT 'MANUAL',
    "effectiveDate" TEXT,
    "weekNumber" INTEGER,
    "reviewComments" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "work_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_media" (
    "id" TEXT NOT NULL,
    "workSessionId" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_timelapse" (
    "id" TEXT NOT NULL,
    "workSessionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'r2',
    "objectKey" TEXT,
    "playbackUrl" TEXT,
    "thumbnailUrl" TEXT,
    "coveredSeconds" INTEGER,
    "runtimeSeconds" INTEGER,
    "speedupFactor" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_timelapse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hackatime_link" (
    "id" TEXT NOT NULL,
    "themeProjectId" TEXT NOT NULL,
    "hackatimeProject" TEXT NOT NULL,
    "phase" "Phase" NOT NULL DEFAULT 'BUILD',
    "hoursApproved" DOUBLE PRECISION,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "cachedSeconds" INTEGER,
    "cachedAt" TIMESTAMP(3),
    "lastFetchError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hackatime_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phase_submission" (
    "id" TEXT NOT NULL,
    "themeProjectId" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "notes" TEXT,
    "submittedInWeek" INTEGER,
    "scheduledWeek" INTEGER,
    "onTime" BOOLEAN NOT NULL DEFAULT false,
    "preReviewed" BOOLEAN NOT NULL DEFAULT false,
    "preReviewedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedResult" "ReviewResult",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phase_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_claim" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_review" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "pass" "ReviewPass" NOT NULL DEFAULT 'FINAL',
    "result" "ReviewResult" NOT NULL,
    "feedback" TEXT NOT NULL,
    "reason" TEXT,
    "invalidated" BOOLEAN NOT NULL DEFAULT false,
    "invalidatedAt" TIMESTAMP(3),
    "hoursOverride" DOUBLE PRECISION,
    "tierOverride" INTEGER,
    "grantUsdOverride" INTEGER,
    "frozenJournalHours" DOUBLE PRECISION,
    "frozenHackatimeHours" DOUBLE PRECISION,
    "frozenTimelapseSeconds" INTEGER,
    "frozenEntryCount" INTEGER,
    "frozenApprovedHours" DOUBLE PRECISION,
    "frozenTier" INTEGER,
    "frozenGrantUsd" INTEGER,
    "frozenExcessCredit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "themeProjectId" TEXT,
    "kind" "LedgerKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "shopOrderId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "category" "ShopItemCategory" NOT NULL DEFAULT 'PRINTER_UPGRADE',
    "priceCredits" INTEGER NOT NULL,
    "maxPerUser" INTEGER NOT NULL DEFAULT 1,
    "stock" INTEGER,
    "requiresPrinterQualified" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_order" (
    "id" TEXT NOT NULL,
    "orderNumber" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "shopItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCredits" INTEGER NOT NULL,
    "totalCredits" INTEGER NOT NULL,
    "itemNameSnapshot" TEXT NOT NULL,
    "status" "ShopOrderStatus" NOT NULL DEFAULT 'PENDING',
    "holdReason" TEXT,
    "rejectionReason" TEXT,
    "encryptedAddress" TEXT NOT NULL DEFAULT '',
    "encryptedPhone" TEXT NOT NULL DEFAULT '',
    "trackingNumber" TEXT,
    "trackingCarrier" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heldAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "lastActorId" TEXT,

    CONSTRAINT "shop_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_order_note" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_order_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printer_award" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "qualifiedAt" TIMESTAMP(3) NOT NULL,
    "qualifyingSnapshot" JSONB NOT NULL,
    "status" "PrinterAwardStatus" NOT NULL DEFAULT 'QUALIFIED',
    "encryptedAddress" TEXT NOT NULL DEFAULT '',
    "encryptedPhone" TEXT NOT NULL DEFAULT '',
    "addressLockedAt" TIMESTAMP(3),
    "trackingNumber" TEXT,
    "trackingCarrier" TEXT,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printer_award_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "eventStartDate" TIMESTAMP(3) NOT NULL,
    "programTimezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "submissionsOpen" BOOLEAN NOT NULL DEFAULT true,
    "submissionsCloseAt" TIMESTAMP(3),
    "shopOpen" BOOLEAN NOT NULL DEFAULT false,
    "shopClosesAt" TIMESTAMP(3),
    "shopGraceDays" INTEGER NOT NULL DEFAULT 7,
    "reviewClaimTtlMinutes" INTEGER NOT NULL DEFAULT 45,
    "airtableSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "program_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "actorIp" TEXT,
    "actorUserAgent" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_run_log" (
    "id" TEXT NOT NULL,
    "syncKey" TEXT NOT NULL,
    "result" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_run_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rsvp_buffer" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "pronouns" TEXT,
    "ip" TEXT,
    "utmSource" TEXT,
    "signupPage" TEXT,
    "referredBy" TEXT,
    "finishedAccountCreation" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "syncedToAirtable" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastSyncError" TEXT,
    "airtableRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rsvp_buffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_slackId_key" ON "user"("slackId");

-- CreateIndex
CREATE UNIQUE INDEX "user_hackatimeUserId_key" ON "user"("hackatimeUserId");

-- CreateIndex
CREATE INDEX "user_createdAt_idx" ON "user"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "user_role_userId_idx" ON "user_role"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_userId_role_key" ON "user_role"("userId", "role");

-- CreateIndex
CREATE INDEX "theme_project_userId_idx" ON "theme_project"("userId");

-- CreateIndex
CREATE INDEX "theme_project_designStatus_idx" ON "theme_project"("designStatus");

-- CreateIndex
CREATE INDEX "theme_project_buildStatus_idx" ON "theme_project"("buildStatus");

-- CreateIndex
CREATE UNIQUE INDEX "theme_project_userId_theme_key" ON "theme_project"("userId", "theme");

-- CreateIndex
CREATE INDEX "work_session_themeProjectId_phase_idx" ON "work_session"("themeProjectId", "phase");

-- CreateIndex
CREATE INDEX "work_session_themeProjectId_createdAt_idx" ON "work_session"("themeProjectId", "createdAt");

-- CreateIndex
CREATE INDEX "work_session_effectiveDate_idx" ON "work_session"("effectiveDate");

-- CreateIndex
CREATE INDEX "session_media_workSessionId_idx" ON "session_media"("workSessionId");

-- CreateIndex
CREATE INDEX "session_timelapse_workSessionId_idx" ON "session_timelapse"("workSessionId");

-- CreateIndex
CREATE INDEX "hackatime_link_themeProjectId_phase_idx" ON "hackatime_link"("themeProjectId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "hackatime_link_themeProjectId_hackatimeProject_key" ON "hackatime_link"("themeProjectId", "hackatimeProject");

-- CreateIndex
CREATE INDEX "phase_submission_themeProjectId_idx" ON "phase_submission"("themeProjectId");

-- CreateIndex
CREATE INDEX "phase_submission_themeProjectId_phase_createdAt_idx" ON "phase_submission"("themeProjectId", "phase", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "phase_submission_resolvedAt_createdAt_idx" ON "phase_submission"("resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "review_claim_submissionId_key" ON "review_claim"("submissionId");

-- CreateIndex
CREATE INDEX "review_claim_reviewerId_idx" ON "review_claim"("reviewerId");

-- CreateIndex
CREATE INDEX "review_claim_expiresAt_idx" ON "review_claim"("expiresAt");

-- CreateIndex
CREATE INDEX "submission_review_submissionId_idx" ON "submission_review"("submissionId");

-- CreateIndex
CREATE INDEX "submission_review_reviewerId_createdAt_idx" ON "submission_review"("reviewerId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entry_userId_createdAt_idx" ON "ledger_entry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entry_userId_themeProjectId_kind_idx" ON "ledger_entry"("userId", "themeProjectId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entry_shopOrderId_kind_key" ON "ledger_entry"("shopOrderId", "kind");

-- CreateIndex
CREATE INDEX "shop_item_active_sortOrder_idx" ON "shop_item"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "shop_order_orderNumber_key" ON "shop_order"("orderNumber");

-- CreateIndex
CREATE INDEX "shop_order_userId_idx" ON "shop_order"("userId");

-- CreateIndex
CREATE INDEX "shop_order_status_placedAt_idx" ON "shop_order"("status", "placedAt");

-- CreateIndex
CREATE INDEX "shop_order_shopItemId_idx" ON "shop_order"("shopItemId");

-- CreateIndex
CREATE INDEX "shop_order_note_orderId_idx" ON "shop_order_note"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "printer_award_userId_key" ON "printer_award"("userId");

-- CreateIndex
CREATE INDEX "printer_award_status_idx" ON "printer_award"("status");

-- CreateIndex
CREATE INDEX "audit_log_actorId_createdAt_idx" ON "audit_log"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_action_createdAt_idx" ON "audit_log"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_targetId_idx" ON "audit_log"("targetId");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "sync_run_log_syncKey_createdAt_idx" ON "sync_run_log"("syncKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "rsvp_buffer_email_key" ON "rsvp_buffer"("email");

-- CreateIndex
CREATE INDEX "rsvp_buffer_syncedToAirtable_syncAttempts_createdAt_idx" ON "rsvp_buffer"("syncedToAirtable", "syncAttempts", "createdAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theme_project" ADD CONSTRAINT "theme_project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_session" ADD CONSTRAINT "work_session_themeProjectId_fkey" FOREIGN KEY ("themeProjectId") REFERENCES "theme_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_media" ADD CONSTRAINT "session_media_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_timelapse" ADD CONSTRAINT "session_timelapse_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hackatime_link" ADD CONSTRAINT "hackatime_link_themeProjectId_fkey" FOREIGN KEY ("themeProjectId") REFERENCES "theme_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phase_submission" ADD CONSTRAINT "phase_submission_themeProjectId_fkey" FOREIGN KEY ("themeProjectId") REFERENCES "theme_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_claim" ADD CONSTRAINT "review_claim_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "phase_submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_claim" ADD CONSTRAINT "review_claim_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_review" ADD CONSTRAINT "submission_review_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "phase_submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_review" ADD CONSTRAINT "submission_review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_themeProjectId_fkey" FOREIGN KEY ("themeProjectId") REFERENCES "theme_project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_shopOrderId_fkey" FOREIGN KEY ("shopOrderId") REFERENCES "shop_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_shopItemId_fkey" FOREIGN KEY ("shopItemId") REFERENCES "shop_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_note" ADD CONSTRAINT "shop_order_note_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "shop_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_note" ADD CONSTRAINT "shop_order_note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_award" ADD CONSTRAINT "printer_award_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_run_log" ADD CONSTRAINT "sync_run_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

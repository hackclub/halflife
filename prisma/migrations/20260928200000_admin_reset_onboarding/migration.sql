-- An admin redoing their own first-checkpoint onboarding, for the audit log.
-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_RESET_ONBOARDING';

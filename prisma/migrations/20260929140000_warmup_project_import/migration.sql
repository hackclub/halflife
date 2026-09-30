-- The pre-season track warm-up projects are imported onto, and the audit
-- action that records each Airtable row brought across. Both additive.
-- AlterEnum
ALTER TYPE "Theme" ADD VALUE 'WARMUP';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_IMPORT_AIRTABLE_PROJECT';

-- An admin replacing the address on a user's row, for someone who no longer
-- receives mail at the one HCA holds. The audit row records both addresses.
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_CHANGE_EMAIL';
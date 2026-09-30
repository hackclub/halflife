-- Makers can delete their own projects, as a soft delete (`deletedAt`).
--
-- A deleted season project must free its theme's slot, or the week could never
-- get a project again: `ensureThemeProject` looks for a live row, finds none,
-- and its insert collides with the deleted one. So the partial unique index
-- that holds one project per season theme per maker now also leaves deleted
-- rows out. Live rows are held exactly as before.
DROP INDEX "theme_project_userId_theme_key";

CREATE UNIQUE INDEX "theme_project_userId_theme_key" ON "theme_project"("userId", "theme") WHERE (theme <> 'WARMUP' AND "deletedAt" IS NULL);

-- The audit action that records it. Additive.
-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'USER_DELETE_PROJECT';

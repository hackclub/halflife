-- Mirror a project's devlogs and parts list into the maker's own GitHub repo.
--
-- Opt-in per project and off by default: writing to someone's repository is a
-- privilege that is asked for rather than assumed, so `repoSyncEnabled` starts
-- false and the setup flow is what turns it on.
--
-- `repoSyncRepo` pins the target when the sync is switched on. Null means "follow
-- the project's repo link", which is the state before a maker has decided; once
-- the setup flow has written files it stays pinned, so a later edit to
-- `githubRepo` cannot silently redirect the next write at another repository.
--
-- There is no per-project staff switch: the global kill switch is
-- `program_settings.repoSyncEnabled`, mirroring `airtableSyncEnabled`, so a
-- GitHub-wide problem is one toggle in /admin/program rather than a column
-- edited across every row.

-- AlterTable
ALTER TABLE "theme_project"
    ADD COLUMN "repoSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "repoSyncRepo" TEXT,
    ADD COLUMN "repoSyncedAt" TIMESTAMP(3),
    ADD COLUMN "repoSyncError" TEXT,
    ADD COLUMN "repoSyncQueuedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "program_settings" ADD COLUMN "repoSyncEnabled" BOOLEAN NOT NULL DEFAULT true;

-- The job's hot path: every project with the sync on, which is a small set
-- across the whole table. Partial, so the index only carries the rows the job
-- ever looks at.
CREATE INDEX "theme_project_repoSyncEnabled_idx" ON "theme_project" ("repoSyncEnabled") WHERE ("repoSyncEnabled" = true);

-- CreateTable
CREATE TABLE "repo_sync_run" (
    "id" TEXT NOT NULL,
    "themeProjectId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "files" JSONB,
    "error" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "repo_sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repo_sync_run_themeProjectId_startedAt_idx" ON "repo_sync_run" ("themeProjectId", "startedAt" DESC);

-- AddForeignKey
ALTER TABLE "repo_sync_run" ADD CONSTRAINT "repo_sync_run_themeProjectId_fkey" FOREIGN KEY ("themeProjectId") REFERENCES "theme_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The audit actions that record it. Additive.
-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'USER_UPDATE_REPO_SYNC';
ALTER TYPE "AuditAction" ADD VALUE 'REPO_SYNC_SUCCESS';
ALTER TYPE "AuditAction" ADD VALUE 'REPO_SYNC_FAILURE';

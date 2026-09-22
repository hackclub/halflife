-- The repo checks a submission was made with (lib/repo-checks), frozen for the
-- reviewer. Null for submissions made before the checks existed.
ALTER TABLE "phase_submission" ADD COLUMN "repoChecks" JSONB;

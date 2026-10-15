-- Clear the repo-sync errors whose wording the sync no longer produces.
--
-- `theme_project.repoSyncError` is written when a sync fails and cleared only
-- when one succeeds, so a project whose last attempt predates the retry and
-- message work still shows the old sentence on its page – "GitHub did not
-- answer.", a rate limit dressed as "refused that – reconnect", a bare
-- "is rate-limiting us right now." – long after the code that wrote it is gone.
-- A page that blames the forge for not answering when the real failure was a
-- rejected commit (or that has since been fixed and never re-synced) is worse
-- than no message at all.
--
-- Only the sentences that are definitely obsolete are cleared. The generic
-- "returned an error (NNN)" is deliberately left alone: the current code still
-- emits it for a status it has no specific wording for, so a row carrying it may
-- be telling the truth. Either way the next attempt rewrites the column.
UPDATE "theme_project"
SET "repoSyncError" = NULL
WHERE "repoSyncError" IN (
    'GitHub did not answer.',
    'GitLab did not answer.',
    'GitHub is rate-limiting us right now.',
    'GitLab is rate-limiting us right now.',
    'GitHub refused that – reconnect GitHub and try again.',
    'GitLab refused that – reconnect GitLab and try again.'
);

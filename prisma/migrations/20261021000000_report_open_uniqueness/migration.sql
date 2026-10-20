-- One open report per reporter per row, restored.
--
-- 20261007120000_report_open_uniqueness created these five indexes, and the unrelated
-- 20261007190239_hours_overlap_dedup_2 dropped them again. Nothing in the schema said so,
-- so `migrate dev` never brought them back and the guard was gone without anyone noticing.
--
-- The guard belongs in the database rather than in the route. The route reads for an
-- existing open report before it creates one, but that read is a race: two presses in
-- flight both pass it, and two open reports for the same thing land in the staff queue.
-- The route catches this violation and answers it with the same conflict the friendly
-- check would have given, so the race ends as a 409 rather than as a duplicate row.
--
-- A decided report may be filed again, so the uniqueness only holds while OPEN. One
-- index per target column, because exactly one of them is ever set.

-- The indexes were gone for a fortnight, so the race had room to leave duplicates behind
-- and the unique indexes below would fail to build on them. The newest open report for a
-- reporter and a target is the one kept: it is the most recent word on the row, and the
-- older twin is the same complaint filed twice.
DELETE FROM "content_report" AS "dupe"
USING "content_report" AS "keep"
WHERE "dupe"."status" = 'OPEN'
    AND "keep"."status" = 'OPEN'
    AND "dupe"."reporterId" = "keep"."reporterId"
    AND (
        ("dupe"."postId" IS NOT NULL AND "dupe"."postId" = "keep"."postId")
        OR ("dupe"."commentId" IS NOT NULL AND "dupe"."commentId" = "keep"."commentId")
        OR ("dupe"."themeProjectId" IS NOT NULL AND "dupe"."themeProjectId" = "keep"."themeProjectId")
        OR ("dupe"."targetUserId" IS NOT NULL AND "dupe"."targetUserId" = "keep"."targetUserId")
        OR ("dupe"."workSessionId" IS NOT NULL AND "dupe"."workSessionId" = "keep"."workSessionId")
    )
    AND ("dupe"."createdAt", "dupe"."id") < ("keep"."createdAt", "keep"."id");

-- One open report per reporter per reel.
CREATE UNIQUE INDEX "content_report_open_post_idx" ON "content_report"("reporterId", "postId") WHERE ("status" = 'OPEN' AND "postId" IS NOT NULL);

-- One open report per reporter per reel comment.
CREATE UNIQUE INDEX "content_report_open_comment_idx" ON "content_report"("reporterId", "commentId") WHERE ("status" = 'OPEN' AND "commentId" IS NOT NULL);

-- One open report per reporter per project.
CREATE UNIQUE INDEX "content_report_open_project_idx" ON "content_report"("reporterId", "themeProjectId") WHERE ("status" = 'OPEN' AND "themeProjectId" IS NOT NULL);

-- One open report per reporter per user.
CREATE UNIQUE INDEX "content_report_open_user_idx" ON "content_report"("reporterId", "targetUserId") WHERE ("status" = 'OPEN' AND "targetUserId" IS NOT NULL);

-- One open report per reporter per devlog entry.
CREATE UNIQUE INDEX "content_report_open_session_idx" ON "content_report"("reporterId", "workSessionId") WHERE ("status" = 'OPEN' AND "workSessionId" IS NOT NULL);

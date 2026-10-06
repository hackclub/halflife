-- One open report per reporter per row, enforced where the race lives rather
-- than in the route's check-then-create: two concurrent POSTs for the same
-- reporter and target both passed the check before either created a row.
-- A decided report may be filed again, so the uniqueness only holds while
-- OPEN — one partial index per target column, since exactly one of them is
-- ever set.
CREATE UNIQUE INDEX "content_report_open_post_idx" ON "content_report"("reporterId", "postId") WHERE "status" = 'OPEN' AND "postId" IS NOT NULL;
CREATE UNIQUE INDEX "content_report_open_comment_idx" ON "content_report"("reporterId", "commentId") WHERE "status" = 'OPEN' AND "commentId" IS NOT NULL;
CREATE UNIQUE INDEX "content_report_open_project_idx" ON "content_report"("reporterId", "themeProjectId") WHERE "status" = 'OPEN' AND "themeProjectId" IS NOT NULL;
CREATE UNIQUE INDEX "content_report_open_user_idx" ON "content_report"("reporterId", "targetUserId") WHERE "status" = 'OPEN' AND "targetUserId" IS NOT NULL;
CREATE UNIQUE INDEX "content_report_open_session_idx" ON "content_report"("reporterId", "workSessionId") WHERE "status" = 'OPEN' AND "workSessionId" IS NOT NULL;

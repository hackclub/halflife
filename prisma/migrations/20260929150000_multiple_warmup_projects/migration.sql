-- A maker may hand the warm-up form in more than once, and each row is a
-- different project. The (userId, theme) unique index saw every warm-up row
-- after the first as a duplicate of it, because they all share Theme.WARMUP.
-- The index becomes partial so it still holds one project per SEASON theme
-- per maker — the five-slot invariant printer qualification reads — while
-- leaving warm-up rows alone. The predicate only excludes WARMUP, so nothing
-- about a season slot changes.
DROP INDEX "theme_project_userId_theme_key";

CREATE UNIQUE INDEX "theme_project_userId_theme_key" ON "theme_project"("userId", "theme") WHERE (theme <> 'WARMUP');

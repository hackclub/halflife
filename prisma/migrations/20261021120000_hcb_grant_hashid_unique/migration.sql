-- One HCB card, one payment.
--
-- The grant hashid is what identifies the card on HCB's side, and nothing constrained it. The unique key on
-- (user, project, phase) says a grant is paid once per project and says nothing at all about the card, so two
-- projects - or two makers - pointing at the same card each created their own row and each paid it.
--
-- The index cannot be built while duplicates are on the table, so they are resolved first. Which row is kept:
--
--   - a row that was sent is the record of a real money movement, so it is the one that is kept;
--   - among sent rows the earliest payment on a card is the original one, so it is the one that is kept;
--   - among rows that were never sent the newest is kept, which is the attempt an admin would have retried.
--
-- A deleted row that recorded a payment would be a payment with no trail, so what it carried is written into
-- the audit log before the row goes. Which of two payments on one card was the legitimate one is not something
-- this table can answer – it does not know who owns the card – so the removed row is kept in the audit log for a
-- human to reconcile against HCB.

-- Keep the trail of every duplicate that recorded a payment, before the row itself goes.
INSERT INTO "audit_log" ("id", "action", "metadata", "targetId", "targetType", "createdAt")
SELECT
	md5(random()::text || clock_timestamp()::text || t."id"),
	'ADMIN_SEND_GRANT',
	jsonb_build_object(
		'amountCents', t."amountCents",
		'grantHashid', t."grantHashid",
		'migratedAway', true,
		'phase', t."phase",
		'reason', 'A duplicate HCB grant row for the same card was removed by the unique-index migration',
		'sentAt', t."sentAt",
		'themeProjectId', t."themeProjectId",
		'transactionId', t."transactionId",
		'userId', t."userId"
	),
	t."themeProjectId",
	'ThemeProject',
	now()
FROM "hcb_grant_topup" AS t
WHERE t."sentAt" IS NOT NULL
	AND t."id" IN (
		SELECT "id"
		FROM (
			SELECT
				"id",
				ROW_NUMBER() OVER (
					PARTITION BY "grantHashid"
					ORDER BY ("sentAt" IS NULL) ASC, "sentAt" ASC, "createdAt" DESC, "id" ASC
				) AS rn
			FROM "hcb_grant_topup"
		) AS ranked
		WHERE ranked.rn > 1
	);

-- Remove the duplicates, keeping the row the ranking above chose.
DELETE FROM "hcb_grant_topup" AS t
USING (
	SELECT "id"
	FROM (
		SELECT
			"id",
			ROW_NUMBER() OVER (
				PARTITION BY "grantHashid"
				ORDER BY ("sentAt" IS NULL) ASC, "sentAt" ASC, "createdAt" DESC, "id" ASC
			) AS rn
		FROM "hcb_grant_topup"
	) AS ranked
	WHERE ranked.rn > 1
) AS dupe
WHERE t."id" = dupe."id";

-- One card, one payment.
CREATE UNIQUE INDEX "hcb_grant_topup_grantHashid_key" ON "hcb_grant_topup"("grantHashid");

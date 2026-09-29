-- A retried purchase (double-tap, proxy retry, two tabs) can mint two orders
-- and charge twice, because each request creates a new order id. A
-- client-supplied key per purchase intent makes the retry resolve to the
-- order it already made: Postgres treats the nulls as distinct, so orders
-- without a key (imported rows, API callers) are unaffected.
ALTER TABLE "shop_order" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "shop_order_userId_idempotencyKey_key" ON "shop_order"("userId", "idempotencyKey");

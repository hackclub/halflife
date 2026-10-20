-- The catalogue's stock figure can change after an order is placed: an item that was
-- unlimited when the order was made can be given a stock figure later, and rejecting
-- that order then hands back stock it never took, inflating the shelf. The order now
-- records whether it took stock, so the refund of the stock is exact.
--
-- Nullable on purpose: the orders that predate the column do not carry the answer, and
-- a null there is read as "unknown" rather than as "no stock was taken".
ALTER TABLE "shop_order" ADD COLUMN "stockDebited" BOOLEAN;

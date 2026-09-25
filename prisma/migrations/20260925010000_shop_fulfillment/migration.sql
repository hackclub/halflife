-- Fulfilment tracking for shop orders: how each one ships, where it is, and
-- what it costs Hack Club in dollars.
-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_UPDATE_ORDER_FULFILLMENT';

-- CreateEnum
CREATE TYPE "ShopFulfillmentMethod" AS ENUM ('DIRECT_SHIP', 'BULK_TO_HQ');

-- CreateEnum
CREATE TYPE "ShopFulfillmentStage" AS ENUM ('UNFULFILLED', 'ORDERED_TO_HQ', 'SENT_FOR_DELIVERY');

-- AlterTable
ALTER TABLE "shop_item" ADD COLUMN     "costUsd" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "shop_order" ADD COLUMN     "fulfillmentMethod" "ShopFulfillmentMethod",
ADD COLUMN     "fulfillmentStage" "ShopFulfillmentStage" NOT NULL DEFAULT 'UNFULFILLED',
ADD COLUMN     "fulfillmentUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "unitCostUsd" DOUBLE PRECISION;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_CREATE_SHOP_REGION';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_UPDATE_SHOP_REGION';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_SET_REGION_PRICE';

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "shopRegionId" TEXT;

-- CreateTable
CREATE TABLE "shop_region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_item_region_price" (
    "id" TEXT NOT NULL,
    "shopItemId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "priceCredits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_item_region_price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_region_active_sortOrder_idx" ON "shop_region"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "shop_item_region_price_shopItemId_regionId_key" ON "shop_item_region_price"("shopItemId", "regionId");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_shopRegionId_fkey" FOREIGN KEY ("shopRegionId") REFERENCES "shop_region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_item_region_price" ADD CONSTRAINT "shop_item_region_price_shopItemId_fkey" FOREIGN KEY ("shopItemId") REFERENCES "shop_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_item_region_price" ADD CONSTRAINT "shop_item_region_price_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "shop_region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

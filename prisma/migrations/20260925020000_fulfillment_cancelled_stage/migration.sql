-- Cancelled is now a fulfilment stage. An order the participant cancelled
-- reads as CANCELLED in the app whatever is stored, so no backfill.
-- AlterEnum
ALTER TYPE "ShopFulfillmentStage" ADD VALUE 'CANCELLED';

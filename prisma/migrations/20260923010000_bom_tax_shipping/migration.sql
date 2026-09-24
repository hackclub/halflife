-- Tax and shipping for a project's parts order, as one total. Nullable, so
-- every existing project reads as zero.
-- AlterTable
ALTER TABLE "theme_project" ADD COLUMN     "bomTaxShippingUsd" DOUBLE PRECISION;


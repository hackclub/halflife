-- A project's bill of materials, one row per line, so the maker can keep it
-- on the project page and the design submission can hand the real list in
-- rather than a placeholder.
-- CreateTable
CREATE TABLE "bom_item" (
    "id" TEXT NOT NULL,
    "themeProjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vendor" TEXT,
    "link" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bom_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bom_item_themeProjectId_sortOrder_idx" ON "bom_item"("themeProjectId", "sortOrder");

-- AddForeignKey
ALTER TABLE "bom_item" ADD CONSTRAINT "bom_item_themeProjectId_fkey" FOREIGN KEY ("themeProjectId") REFERENCES "theme_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- DropIndex
DROP INDEX "account_issuer_accountId_key";

-- AlterTable
ALTER TABLE "account" DROP COLUMN "issuer";

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");


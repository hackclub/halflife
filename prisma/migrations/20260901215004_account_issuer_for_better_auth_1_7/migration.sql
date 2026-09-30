-- DropIndex
DROP INDEX "account_providerId_accountId_key";

-- AlterTable
ALTER TABLE "account" ADD COLUMN     "issuer" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "account"("issuer", "accountId");


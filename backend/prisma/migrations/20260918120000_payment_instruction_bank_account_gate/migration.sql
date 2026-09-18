-- AlterTable
ALTER TABLE "payment_instructions" ADD COLUMN     "counterparty_bank_account_id" TEXT;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_counterparty_bank_account_id_fkey" FOREIGN KEY ("counterparty_bank_account_id") REFERENCES "counterparty_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

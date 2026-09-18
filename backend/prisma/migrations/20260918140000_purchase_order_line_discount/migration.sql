-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

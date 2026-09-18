#!/bin/sh
# ONE-TIME baseline for a production database that has real schema/data but
# was never tracked by Prisma Migrate (no _prisma_migrations table) — hence
# P3005 ("database schema is not empty") on a plain `migrate deploy`.
#
# This marks every pre-existing migration as already-applied (no SQL runs,
# just metadata bookkeeping — trusts the live schema already matches, which
# it does: this service has been running these features in production),
# then runs migrate deploy normally so only genuinely new migrations apply.
#
# Safe to leave in the repo — `migrate resolve --applied` on an
# already-resolved migration is a no-op, so re-running this script on a
# later deploy (once the tracking table exists) does nothing harmful. Revert
# the Render Start Command back to the plain form once this succeeds once.
set -e

PRE_EXISTING_MIGRATIONS="
20260907170246_phase0_foundation
20260907175036_phase1_org_structure
20260907175054_bank_account_default_constraint
20260907175100_bank_account_default_constraint
20260908151610_phase2_product_catalog_phase3_pricing
20260908160000_phase4_sales_documents
20260909151400_accounting_core
20260909151616_posting_sequence_autoincrement
20260909152645_account_tenant_nullable
20260909154654_tax_engine
20260910120000_sales_preorder
20260910130000_reservation_policy_default
20260910140000_sales_execution
20260911000217_phase8_procurement
20260911120000_phase9_purchase_execution
20260911160811_phase10_warehouse_inventory
20260911180000_phase10_document_line_serials
20260911190000_procurement_department_autofill
20260911200000_counterparty_management
20260911200500_counterparty_contact_department
20260911210000_counterparty_contract_terms_and_lines
20260911220000_po_contract_traceability
20260916185253_add_approval_mvp
20260916213213_grn_over_delivery_invoice_variance
20260916214817_contract_limit_control
20260916230000_sales_order_manager_approval
20260917000000_counterparty_bank_account_approval
20260917010000_counterparty_risk_status
"

for m in $PRE_EXISTING_MIGRATIONS; do
  npx prisma migrate resolve --applied "$m" || true
done

npx prisma migrate deploy
node dist/src/main.js

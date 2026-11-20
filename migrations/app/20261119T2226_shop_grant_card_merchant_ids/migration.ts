#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/dd6fc379b044abf43bf4c225709cca5fcb7a5448d2b5e8f9b2907355da2e3583/contract';
import startContract from '../../snapshots/dd6fc379b044abf43bf4c225709cca5fcb7a5448d2b5e8f9b2907355da2e3583/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fdac6ef67f025180d2ff06c6e185c218977b4a75e02049c7f18ed713b6cdff37/contract';
import endContract from '../../snapshots/fdac6ef67f025180d2ff06c6e185c218977b4a75e02049c7f18ed713b6cdff37/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'hcb_shop_grant_card',
        column: col('grantCardMerchantIds', 'text[]', {
          notNull: true,
          default: lit([]),
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'shop_item',
        column: col('grantCardMerchantIds', 'text[]', {
          notNull: true,
          default: lit([]),
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'shop_order',
        column: col('grantCardMerchantIds', 'text[]', {
          notNull: true,
          default: lit([]),
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'hcb_shop_grant_card',
        constraint: 'hcb_shop_grant_card_grantCardMerchantIds_elem_not_null_f610ed09',
        expression: sql`array_position("grantCardMerchantIds", NULL) IS NULL`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'shop_item',
        constraint: 'shop_item_grantCardMerchantIds_elem_not_null_f610ed09',
        expression: sql`array_position("grantCardMerchantIds", NULL) IS NULL`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'shop_order',
        constraint: 'shop_order_grantCardMerchantIds_elem_not_null_f610ed09',
        expression: sql`array_position("grantCardMerchantIds", NULL) IS NULL`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

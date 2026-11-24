#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/bc3144d4b8894f37ee227ecb93838fc2bee71f668b14061ec1c771bb07911bb4/contract';
import endContract from '../../snapshots/bc3144d4b8894f37ee227ecb93838fc2bee71f668b14061ec1c771bb07911bb4/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c9e888d16a96cfb16fcf2efa29bb6b67fd8c796540c6687b1976b9ecdbfae8cc/contract';
import startContract from '../../snapshots/c9e888d16a96cfb16fcf2efa29bb6b67fd8c796540c6687b1976b9ecdbfae8cc/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'grant_card_merchant',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('merchantIds', 'text[]', {
            notNull: true,
            default: lit([]),
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('slug', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceNote', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'grant_card_merchant_merchantIds_elem_not_null_d17ab448',
            sql`array_position("merchantIds", NULL) IS NULL`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'shop_item_grant_card_merchant',
        columns: [
          col('merchantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('shopItemId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['shopItemId', 'merchantId'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'grant_card_merchant',
        constraint: 'grant_card_merchant_slug_key',
        columns: ['slug'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'shop_item_grant_card_merchant',
        index: 'shop_item_grant_card_merchant_merchantId_idx',
        columns: ['merchantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'shop_item_grant_card_merchant',
        index: 'shop_item_grant_card_merchant_shopItemId_idx_8d36bb89',
        columns: ['shopItemId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'shop_item_grant_card_merchant',
        foreignKey: {
          name: 'shop_item_grant_card_merchant_shopItemId_fkey',
          columns: ['shopItemId'],
          references: { schema: 'public', table: 'shop_item', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'shop_item_grant_card_merchant',
        foreignKey: {
          name: 'shop_item_grant_card_merchant_merchantId_fkey',
          columns: ['merchantId'],
          references: { schema: 'public', table: 'grant_card_merchant', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

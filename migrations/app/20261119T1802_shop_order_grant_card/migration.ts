#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/08c89781f26dcf9eb1b8687193a5520843401bcddc24e05953876c524e4a5130/contract';
import endContract from '../../snapshots/08c89781f26dcf9eb1b8687193a5520843401bcddc24e05953876c524e4a5130/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e3a9f7c515c1952cb868308f8f53d08c5c3811c84c776e8ce2d4e13ea8a8c649/contract';
import startContract from '../../snapshots/e3a9f7c515c1952cb868308f8f53d08c5c3811c84c776e8ce2d4e13ea8a8c649/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
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
        table: 'hcb_shop_grant_card',
        columns: [
          col('amountCents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('canceledAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('cardId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('claimedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('disbursementId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('hcbCardGrantId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('hcbStatus', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('issuedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('purpose', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('shopOrderId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', '"HcbGrantCardStatus"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'HcbGrantCardStatus' } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'hcb_shop_grant_card',
        index: 'hcb_shop_grant_card_hcbCardGrantId_key',
        columns: ['hcbCardGrantId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'hcb_shop_grant_card',
        index: 'hcb_shop_grant_card_shopOrderId_live_key_3a271ec6',
        columns: ['shopOrderId'],
        extras: {
          where: sql`("status" IN ('PENDING'::"HcbGrantCardStatus", 'ISSUED'::"HcbGrantCardStatus", 'AMBIGUOUS'::"HcbGrantCardStatus"))`,
          unique: true,
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'hcb_shop_grant_card',
        foreignKey: {
          name: 'hcb_shop_grant_card_shopOrderId_fkey',
          columns: ['shopOrderId'],
          references: { schema: 'public', table: 'shop_order', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

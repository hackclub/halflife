#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/4f8e402e5eec4219f81f07bc3c4dd199072d0b07352374f39a882c03c12fdc7b/contract';
import endContract from '../../snapshots/4f8e402e5eec4219f81f07bc3c4dd199072d0b07352374f39a882c03c12fdc7b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/55324cd4c417de257c56c5187d6956f900b61949bc77ae4a73eabbb4fdcf6898/contract';
import startContract from '../../snapshots/55324cd4c417de257c56c5187d6956f900b61949bc77ae4a73eabbb4fdcf6898/contract.json' with { type: 'json' };
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
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'LegacyShopDmStatus',
        members: ['PENDING', 'SENT', 'FAILED'],
      }),
      this.createTable({
        schema: 'public',
        table: 'legacy_shop_dm',
        columns: [
          col('channel', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sentAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('sentById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('slackId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', '"LegacyShopDmStatus"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'LegacyShopDmStatus' } },
          }),
          col('test', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('ts', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'legacy_shop_dm_order',
        columns: [
          col('choice', '"ShopDeliveryPreference"', {
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ShopDeliveryPreference' } },
          }),
          col('choiceAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('dmId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('shopOrderId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', '"LegacyShopDmStatus"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'LegacyShopDmStatus' } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'legacy_shop_dm',
        index: 'legacy_shop_dm_createdAt_idx',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'legacy_shop_dm',
        index: 'legacy_shop_dm_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'legacy_shop_dm_order',
        index: 'legacy_shop_dm_order_dmId_idx',
        columns: ['dmId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'legacy_shop_dm_order',
        index: 'legacy_shop_dm_order_shopOrderId_live_key_4459003e',
        columns: ['shopOrderId'],
        extras: {
          where: sql`("status" IN ('PENDING'::"LegacyShopDmStatus", 'SENT'::"LegacyShopDmStatus"))`,
          unique: true,
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'legacy_shop_dm_order',
        foreignKey: {
          name: 'legacy_shop_dm_order_dmId_fkey',
          columns: ['dmId'],
          references: { schema: 'public', table: 'legacy_shop_dm', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'legacy_shop_dm_order',
        foreignKey: {
          name: 'legacy_shop_dm_order_shopOrderId_fkey',
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

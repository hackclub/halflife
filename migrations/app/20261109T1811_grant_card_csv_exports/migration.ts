#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/4d2add9d7eaeff9b94b27e16e0a6f4c8d0506330d4b5d5c843781fc510c3fffb/contract';
import startContract from '../../snapshots/4d2add9d7eaeff9b94b27e16e0a6f4c8d0506330d4b5d5c843781fc510c3fffb/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b65cc700c9059610a22502ffae604aac3fe7e97f6b7bb71588f99f42c9215243/contract';
import endContract from '../../snapshots/b65cc700c9059610a22502ffae604aac3fe7e97f6b7bb71588f99f42c9215243/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_CREATE_GRANT_CARD_EXPORT',
      }),
      this.createTable({
        schema: 'public',
        table: 'hcb_card_grant_export_batch',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('createdById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fingerprint', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('totalCents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'hcb_card_grant_export_row',
        columns: [
          col('amountCents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('batchId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('themeProjectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'hcb_card_grant_export_row',
        index: 'hcb_card_grant_export_row_batchId_idx',
        columns: ['batchId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'hcb_card_grant_export_row',
        index: 'hcb_card_grant_export_row_project_key',
        columns: ['themeProjectId'],
        extras: { unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'hcb_card_grant_export_row',
        foreignKey: {
          name: 'hcb_card_grant_export_row_batchId_fkey',
          columns: ['batchId'],
          references: { schema: 'public', table: 'hcb_card_grant_export_batch', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'hcb_card_grant_export_row',
        foreignKey: {
          name: 'hcb_card_grant_export_row_themeProjectId_fkey',
          columns: ['themeProjectId'],
          references: { schema: 'public', table: 'theme_project', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

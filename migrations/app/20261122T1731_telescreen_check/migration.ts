#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4efe91333a13ea096f561935623a2ab842ab2d3c50c3187885f3b5cd73bdecf6/contract';
import endContract from '../../snapshots/4efe91333a13ea096f561935623a2ab842ab2d3c50c3187885f3b5cd73bdecf6/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e76106a38af6aaa80637f84f88c5681b414f8f7c3093427577f6296f68d3735e/contract';
import startContract from '../../snapshots/e76106a38af6aaa80637f84f88c5681b414f8f7c3093427577f6296f68d3735e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'telescreen_check',
        columns: [
          col('conflicts', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('creditedSeconds', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outcomeAt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('outcomeReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('outcomeStatus', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reviewFields', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('reviewNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reviewedAt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reviewerName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('robertError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('robertId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('robertSpork', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('robertState', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sentByName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sporkCheckedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('sporkError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sporkResult', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('sporkVerdict', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('submittedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('syncedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('themeProjectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('trustScore', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'telescreen_check',
        index: 'telescreen_check_robertId_key',
        columns: ['robertId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'telescreen_check',
        index: 'telescreen_check_robertState_idx',
        columns: ['robertState'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'telescreen_check',
        index: 'telescreen_check_themeProjectId_key',
        columns: ['themeProjectId'],
        extras: { unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'telescreen_check',
        foreignKey: {
          name: 'telescreen_check_themeProjectId_fkey',
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

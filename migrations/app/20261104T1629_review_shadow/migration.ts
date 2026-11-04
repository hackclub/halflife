#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/d465ddb8e5a263c540535aabdd606b022c25637bca48ea948e6ecff213d9f7f6/contract';
import startContract from '../../snapshots/d465ddb8e5a263c540535aabdd606b022c25637bca48ea948e6ecff213d9f7f6/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f38c776a619f1f8942a7b6ff3346a34d573cfcf039263b8731c91feebb77421c/contract';
import endContract from '../../snapshots/f38c776a619f1f8942a7b6ff3346a34d573cfcf039263b8731c91feebb77421c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'REVIEW_SYNC_SUCCESS',
      }),
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'REVIEW_SYNC_FAILURE',
      }),
      this.createTable({
        schema: 'public',
        table: 'review_ship',
        columns: [
          col('closedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('decision', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('externalId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lastSubmissionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('phase', '"Phase"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'Phase' } },
          }),
          col('remoteId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('syncedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('themeProjectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('version', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'review_ship',
        index: 'review_ship_closedAt_idx',
        columns: ['closedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'review_ship',
        index: 'review_ship_remoteId_key',
        columns: ['remoteId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'review_ship',
        index: 'review_ship_themeProjectId_phase_key',
        columns: ['themeProjectId', 'phase'],
        extras: { unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'review_ship',
        foreignKey: {
          name: 'review_ship_themeProjectId_fkey',
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

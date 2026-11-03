#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/d465ddb8e5a263c540535aabdd606b022c25637bca48ea948e6ecff213d9f7f6/contract';
import endContract from '../../snapshots/d465ddb8e5a263c540535aabdd606b022c25637bca48ea948e6ecff213d9f7f6/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f3fc2e8af8c37a08c413e4179e5e2c539bc789e9173ae038cdc16ab1a0c1a0e4/contract';
import startContract from '../../snapshots/f3fc2e8af8c37a08c413e4179e5e2c539bc789e9173ae038cdc16ab1a0c1a0e4/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'week_extension',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('submissionExtensionUntil', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('week', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['userId', 'week'])],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'week_extension',
        foreignKey: {
          name: 'week_extension_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

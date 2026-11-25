#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/6d85032126e1e36fd69be5dd9cc2421107cb48034ddf2b75cc679c40ad57ec6a/contract';
import startContract from '../../snapshots/6d85032126e1e36fd69be5dd9cc2421107cb48034ddf2b75cc679c40ad57ec6a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c01dab21937d3c6ec30b4866ec95399c85d24e4f9b1ef93fa9dc7fe10fc47794/contract';
import endContract from '../../snapshots/c01dab21937d3c6ec30b4866ec95399c85d24e4f9b1ef93fa9dc7fe10fc47794/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'deferred_build_approval',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('decision', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('submissionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'deferred_build_approval',
        index: 'deferred_build_approval_submissionId_key',
        columns: ['submissionId'],
        extras: { unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'deferred_build_approval',
        foreignKey: {
          name: 'deferred_build_approval_submissionId_fkey',
          columns: ['submissionId'],
          references: { schema: 'public', table: 'phase_submission', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

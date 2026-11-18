#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/88263d56ead12649adf469071edaf58955bd338d0d5e9e1c5dd19bd9176d4f97/contract';
import endContract from '../../snapshots/88263d56ead12649adf469071edaf58955bd338d0d5e9e1c5dd19bd9176d4f97/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a8e9dd90d4a30f14e3c876cf19ec864e3603a5c87fe9e6e5a2e644cf2685ccbb/contract';
import startContract from '../../snapshots/a8e9dd90d4a30f14e3c876cf19ec864e3603a5c87fe9e6e5a2e644cf2685ccbb/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'uploaded_object',
        columns: [
          col('byteSize', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('confirmedAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('contentHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('contentType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('folder', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('objectKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'uploaded_object',
        index: 'uploaded_object_objectKey_key',
        columns: ['objectKey'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'uploaded_object',
        index: 'uploaded_object_user_folder_idx',
        columns: ['userId', 'folder'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'uploaded_object',
        foreignKey: {
          name: 'uploaded_object_userId_fkey',
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

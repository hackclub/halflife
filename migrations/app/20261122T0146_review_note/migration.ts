#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4f8e402e5eec4219f81f07bc3c4dd199072d0b07352374f39a882c03c12fdc7b/contract';
import startContract from '../../snapshots/4f8e402e5eec4219f81f07bc3c4dd199072d0b07352374f39a882c03c12fdc7b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e76106a38af6aaa80637f84f88c5681b414f8f7c3093427577f6296f68d3735e/contract';
import endContract from '../../snapshots/e76106a38af6aaa80637f84f88c5681b414f8f7c3093427577f6296f68d3735e/contract.json' with { type: 'json' };
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
        table: 'review_note',
        columns: [
          col('authorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('body', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('clearedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('clearedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('flag', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('makerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('submissionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('themeProjectId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'review_note',
        index: 'review_note_makerId_idx',
        columns: ['makerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'review_note',
        index: 'review_note_themeProjectId_idx',
        columns: ['themeProjectId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'review_note',
        foreignKey: {
          name: 'review_note_makerId_fkey',
          columns: ['makerId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'review_note',
        foreignKey: {
          name: 'review_note_authorId_fkey',
          columns: ['authorId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'review_note',
        foreignKey: {
          name: 'review_note_themeProjectId_fkey',
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

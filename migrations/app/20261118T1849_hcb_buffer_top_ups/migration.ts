#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/ac583d136f1bcad6630b8de415581d0ee2bef1af3dd4685c1c52b3b670b5d066/contract';
import endContract from '../../snapshots/ac583d136f1bcad6630b8de415581d0ee2bef1af3dd4685c1c52b3b670b5d066/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c22a2c982087a6d96a28b58106dcb735cfcbc7e0e9908ba45e153a3dc76784c1/contract';
import startContract from '../../snapshots/c22a2c982087a6d96a28b58106dcb735cfcbc7e0e9908ba45e153a3dc76784c1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'hcb_buffer_top_up',
        columns: [
          col('amountCents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('disbursementKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('hcbCardGrantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('hcbCreatedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('memo', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('observedAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'hcb_buffer_top_up',
        index: 'hcb_buffer_top_up_disbursementKey_key',
        columns: ['disbursementKey'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'hcb_buffer_top_up',
        index: 'hcb_buffer_top_up_hcbCardGrantId_idx',
        columns: ['hcbCardGrantId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

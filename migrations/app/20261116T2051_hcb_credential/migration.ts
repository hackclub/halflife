#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/c9275831f2f56d2a4bd0d0491895d069bac68574548c9007999f5578088f02e9/contract';
import endContract from '../../snapshots/c9275831f2f56d2a4bd0d0491895d069bac68574548c9007999f5578088f02e9/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fa9fc1c4181ecdd802e78c10ec1874287aee3d57a6b7eeac7c1a9211e1ff8d19/contract';
import startContract from '../../snapshots/fa9fc1c4181ecdd802e78c10ec1874287aee3d57a6b7eeac7c1a9211e1ff8d19/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'hcb_credential',
        columns: [
          col('id', 'text', {
            notNull: true,
            default: lit('singleton'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('refreshToken', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

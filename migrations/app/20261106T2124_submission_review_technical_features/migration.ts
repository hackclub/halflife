#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/4d2add9d7eaeff9b94b27e16e0a6f4c8d0506330d4b5d5c843781fc510c3fffb/contract';
import endContract from '../../snapshots/4d2add9d7eaeff9b94b27e16e0a6f4c8d0506330d4b5d5c843781fc510c3fffb/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9e0483430e76fe1f978d8a9ca8602bb11e81e094f2d411b3528ad222a1e6113e/contract';
import startContract from '../../snapshots/9e0483430e76fe1f978d8a9ca8602bb11e81e094f2d411b3528ad222a1e6113e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'submission_review',
        column: col('technicalFeatures', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

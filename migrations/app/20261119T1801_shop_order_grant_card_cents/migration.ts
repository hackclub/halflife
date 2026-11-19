#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/2616f60843af86db052bc8b89df8c8c1164dcc7941b6f73ae61a46e4d1377c6d/contract';
import startContract from '../../snapshots/2616f60843af86db052bc8b89df8c8c1164dcc7941b6f73ae61a46e4d1377c6d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e3a9f7c515c1952cb868308f8f53d08c5c3811c84c776e8ce2d4e13ea8a8c649/contract';
import endContract from '../../snapshots/e3a9f7c515c1952cb868308f8f53d08c5c3811c84c776e8ce2d4e13ea8a8c649/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'shop_order',
        column: col('grantCardCents', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

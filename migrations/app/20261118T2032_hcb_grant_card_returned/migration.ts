#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/05dcd1e109e3a953004a527aae4f1d342745f3d3602df755a4a894258194a6d9/contract';
import endContract from '../../snapshots/05dcd1e109e3a953004a527aae4f1d342745f3d3602df755a4a894258194a6d9/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/63e79ead29a7b3ae6be11c027927f1717d5bef5596b0db417a551ad3ce830f40/contract';
import startContract from '../../snapshots/63e79ead29a7b3ae6be11c027927f1717d5bef5596b0db417a551ad3ce830f40/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'HcbGrantCardStatus',
        value: 'RETURNED',
      }),
      this.addColumn({
        schema: 'public',
        table: 'hcb_grant_card',
        column: col('returnedAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

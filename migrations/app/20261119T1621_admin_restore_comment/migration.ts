#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/05dcd1e109e3a953004a527aae4f1d342745f3d3602df755a4a894258194a6d9/contract';
import startContract from '../../snapshots/05dcd1e109e3a953004a527aae4f1d342745f3d3602df755a4a894258194a6d9/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/2616f60843af86db052bc8b89df8c8c1164dcc7941b6f73ae61a46e4d1377c6d/contract';
import endContract from '../../snapshots/2616f60843af86db052bc8b89df8c8c1164dcc7941b6f73ae61a46e4d1377c6d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_RESTORE_COMMENT',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

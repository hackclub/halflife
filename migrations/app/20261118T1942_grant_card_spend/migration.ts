#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/a8e9dd90d4a30f14e3c876cf19ec864e3603a5c87fe9e6e5a2e644cf2685ccbb/contract';
import endContract from '../../snapshots/a8e9dd90d4a30f14e3c876cf19ec864e3603a5c87fe9e6e5a2e644cf2685ccbb/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ac583d136f1bcad6630b8de415581d0ee2bef1af3dd4685c1c52b3b670b5d066/contract';
import startContract from '../../snapshots/ac583d136f1bcad6630b8de415581d0ee2bef1af3dd4685c1c52b3b670b5d066/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'hcb_grant_card',
        column: col('spentCents', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

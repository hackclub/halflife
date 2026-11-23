#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/33b314016774741a0ca50a6878f5fde7d402a2eb8e5498db82ffe93f7ac34876/contract';
import startContract from '../../snapshots/33b314016774741a0ca50a6878f5fde7d402a2eb8e5498db82ffe93f7ac34876/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a77f387fb3d5945e2fab105792153826e37003022d64707865e286f8afd105f0/contract';
import endContract from '../../snapshots/a77f387fb3d5945e2fab105792153826e37003022d64707865e286f8afd105f0/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'hackatime_link',
        column: col('cachedOverlap', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'hackatime_link',
        column: col('overlapFetchError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'hackatime_link',
        column: col('overlapFetchedAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

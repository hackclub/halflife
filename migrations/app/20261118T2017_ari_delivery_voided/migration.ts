#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/63e79ead29a7b3ae6be11c027927f1717d5bef5596b0db417a551ad3ce830f40/contract';
import endContract from '../../snapshots/63e79ead29a7b3ae6be11c027927f1717d5bef5596b0db417a551ad3ce830f40/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/88263d56ead12649adf469071edaf58955bd338d0d5e9e1c5dd19bd9176d4f97/contract';
import startContract from '../../snapshots/88263d56ead12649adf469071edaf58955bd338d0d5e9e1c5dd19bd9176d4f97/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'ari_webhook_delivery',
        column: col('voidedAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

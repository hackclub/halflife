#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/08c89781f26dcf9eb1b8687193a5520843401bcddc24e05953876c524e4a5130/contract';
import startContract from '../../snapshots/08c89781f26dcf9eb1b8687193a5520843401bcddc24e05953876c524e4a5130/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/dd6fc379b044abf43bf4c225709cca5fcb7a5448d2b5e8f9b2907355da2e3583/contract';
import endContract from '../../snapshots/dd6fc379b044abf43bf4c225709cca5fcb7a5448d2b5e8f9b2907355da2e3583/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'hcb_shop_grant_card',
        column: col('spentCents', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

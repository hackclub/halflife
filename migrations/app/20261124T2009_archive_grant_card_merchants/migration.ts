#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/6d85032126e1e36fd69be5dd9cc2421107cb48034ddf2b75cc679c40ad57ec6a/contract';
import endContract from '../../snapshots/6d85032126e1e36fd69be5dd9cc2421107cb48034ddf2b75cc679c40ad57ec6a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b395cee2c1f695f30f220472921381e01930065704a5f11100205389b8db8546/contract';
import startContract from '../../snapshots/b395cee2c1f695f30f220472921381e01930065704a5f11100205389b8db8546/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'grant_card_merchant',
        column: col('archivedAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

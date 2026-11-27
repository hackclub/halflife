#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/c01dab21937d3c6ec30b4866ec95399c85d24e4f9b1ef93fa9dc7fe10fc47794/contract';
import startContract from '../../snapshots/c01dab21937d3c6ec30b4866ec95399c85d24e4f9b1ef93fa9dc7fe10fc47794/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e8416b730535b9f63ba03117c8eb3e18f820cd54998a96f608fe3716c53d4692/contract';
import endContract from '../../snapshots/e8416b730535b9f63ba03117c8eb3e18f820cd54998a96f608fe3716c53d4692/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'LedgerKind',
        value: 'GRANT_RETURN_COINS',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

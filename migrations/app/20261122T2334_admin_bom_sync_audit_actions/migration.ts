#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/33b314016774741a0ca50a6878f5fde7d402a2eb8e5498db82ffe93f7ac34876/contract';
import endContract from '../../snapshots/33b314016774741a0ca50a6878f5fde7d402a2eb8e5498db82ffe93f7ac34876/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/4efe91333a13ea096f561935623a2ab842ab2d3c50c3187885f3b5cd73bdecf6/contract';
import startContract from '../../snapshots/4efe91333a13ea096f561935623a2ab842ab2d3c50c3187885f3b5cd73bdecf6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_SYNC_BOM',
      }),
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_UNDO_BOM_SYNC',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

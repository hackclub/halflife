#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/55c7f5f138928c00bde559617d1e75e85ee9cd12aab40dbf4e7a2628224dba99/contract';
import endContract from '../../snapshots/55c7f5f138928c00bde559617d1e75e85ee9cd12aab40dbf4e7a2628224dba99/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fdac6ef67f025180d2ff06c6e185c218977b4a75e02049c7f18ed713b6cdff37/contract';
import startContract from '../../snapshots/fdac6ef67f025180d2ff06c6e185c218977b4a75e02049c7f18ed713b6cdff37/contract.json' with { type: 'json' };
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

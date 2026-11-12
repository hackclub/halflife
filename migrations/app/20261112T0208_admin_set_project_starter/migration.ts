#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/b65cc700c9059610a22502ffae604aac3fe7e97f6b7bb71588f99f42c9215243/contract';
import startContract from '../../snapshots/b65cc700c9059610a22502ffae604aac3fe7e97f6b7bb71588f99f42c9215243/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d6581e2f6357e120e40fd340b6e68eef4ff85d02f6318aa86ff41b85bb6d387c/contract';
import endContract from '../../snapshots/d6581e2f6357e120e40fd340b6e68eef4ff85d02f6318aa86ff41b85bb6d387c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_SET_PROJECT_STARTER',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

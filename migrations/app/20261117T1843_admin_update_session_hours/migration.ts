#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/17350e5b4ce7e424521b641dbdaa1667df38baac26a35a4a6e67b34dbfc0172e/contract';
import endContract from '../../snapshots/17350e5b4ce7e424521b641dbdaa1667df38baac26a35a4a6e67b34dbfc0172e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c9275831f2f56d2a4bd0d0491895d069bac68574548c9007999f5578088f02e9/contract';
import startContract from '../../snapshots/c9275831f2f56d2a4bd0d0491895d069bac68574548c9007999f5578088f02e9/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_UPDATE_SESSION_HOURS',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

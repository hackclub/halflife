#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/123db881527318fe673aae68acde74e6c73aacdd4de2333fe3d2ab0dd7cc6bfc/contract';
import endContract from '../../snapshots/123db881527318fe673aae68acde74e6c73aacdd4de2333fe3d2ab0dd7cc6bfc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/17350e5b4ce7e424521b641dbdaa1667df38baac26a35a4a6e67b34dbfc0172e/contract';
import startContract from '../../snapshots/17350e5b4ce7e424521b641dbdaa1667df38baac26a35a4a6e67b34dbfc0172e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_UNSUBMIT_PHASE',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

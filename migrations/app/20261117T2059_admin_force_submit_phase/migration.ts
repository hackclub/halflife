#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/123db881527318fe673aae68acde74e6c73aacdd4de2333fe3d2ab0dd7cc6bfc/contract';
import startContract from '../../snapshots/123db881527318fe673aae68acde74e6c73aacdd4de2333fe3d2ab0dd7cc6bfc/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/8303ed749082384e42e7233ee8ea94ee695f2b14335afca5908dfad48450b771/contract';
import endContract from '../../snapshots/8303ed749082384e42e7233ee8ea94ee695f2b14335afca5908dfad48450b771/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_FORCE_SUBMIT_PHASE',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

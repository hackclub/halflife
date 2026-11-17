#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/8303ed749082384e42e7233ee8ea94ee695f2b14335afca5908dfad48450b771/contract';
import startContract from '../../snapshots/8303ed749082384e42e7233ee8ea94ee695f2b14335afca5908dfad48450b771/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c22a2c982087a6d96a28b58106dcb735cfcbc7e0e9908ba45e153a3dc76784c1/contract';
import endContract from '../../snapshots/c22a2c982087a6d96a28b58106dcb735cfcbc7e0e9908ba45e153a3dc76784c1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'AIRTABLE_ADDRESS_GAP',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/babb137eea36ab1be7dd45652c05b1828022b3d78c9989bf0835b025a6033095/contract';
import endContract from '../../snapshots/babb137eea36ab1be7dd45652c05b1828022b3d78c9989bf0835b025a6033095/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c9e888d16a96cfb16fcf2efa29bb6b67fd8c796540c6687b1976b9ecdbfae8cc/contract';
import startContract from '../../snapshots/c9e888d16a96cfb16fcf2efa29bb6b67fd8c796540c6687b1976b9ecdbfae8cc/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'phase_submission',
        column: col('changesSinceLast', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'phase_submission',
        column: col('extraNotes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

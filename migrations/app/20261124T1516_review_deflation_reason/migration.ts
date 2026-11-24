#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a77f387fb3d5945e2fab105792153826e37003022d64707865e286f8afd105f0/contract';
import startContract from '../../snapshots/a77f387fb3d5945e2fab105792153826e37003022d64707865e286f8afd105f0/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c9e888d16a96cfb16fcf2efa29bb6b67fd8c796540c6687b1976b9ecdbfae8cc/contract';
import endContract from '../../snapshots/c9e888d16a96cfb16fcf2efa29bb6b67fd8c796540c6687b1976b9ecdbfae8cc/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'submission_review',
        column: col('deflationReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

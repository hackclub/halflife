#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/869bb3d4436fe96697fac600dfe0a5ddc80bea218c195d0ba29d1ee7c3c4d6d7/contract';
import startContract from '../../snapshots/869bb3d4436fe96697fac600dfe0a5ddc80bea218c195d0ba29d1ee7c3c4d6d7/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fd5a1fcf2f188ed8d32a1999d92520f4cda4ca20ab5d6896eeeda5703feb5b4c/contract';
import endContract from '../../snapshots/fd5a1fcf2f188ed8d32a1999d92520f4cda4ca20ab5d6896eeeda5703feb5b4c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'phase_submission',
        column: col('noMicrocontroller', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

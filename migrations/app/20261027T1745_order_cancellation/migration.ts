#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/8fc2beff87e71f16f8d3d2e856b084ad5f264ad98d511b2dc5947dae1a538e7d/contract';
import endContract from '../../snapshots/8fc2beff87e71f16f8d3d2e856b084ad5f264ad98d511b2dc5947dae1a538e7d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fd5a1fcf2f188ed8d32a1999d92520f4cda4ca20ab5d6896eeeda5703feb5b4c/contract';
import startContract from '../../snapshots/fd5a1fcf2f188ed8d32a1999d92520f4cda4ca20ab5d6896eeeda5703feb5b4c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'USER_CANCEL_ORDER',
      }),
      this.addColumn({
        schema: 'public',
        table: 'shop_order',
        column: col('cancellationReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'shop_order',
        column: col('cancelledAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/06c534590e9d44f4b1a9666c962ecf046bcf98f9f8408766f4a1480f38c15177/contract';
import endContract from '../../snapshots/06c534590e9d44f4b1a9666c962ecf046bcf98f9f8408766f4a1480f38c15177/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/6d85032126e1e36fd69be5dd9cc2421107cb48034ddf2b75cc679c40ad57ec6a/contract';
import startContract from '../../snapshots/6d85032126e1e36fd69be5dd9cc2421107cb48034ddf2b75cc679c40ad57ec6a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'LedgerKind',
        value: 'GRANT_CARD_RETURN',
      }),
      this.addColumn({
        schema: 'public',
        table: 'hcb_grant_card',
        column: col('coinsCreditedAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'hcb_grant_card',
        column: col('returnCoins', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

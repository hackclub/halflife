#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/5652ee0b322183a876fa68a34f27ef6520d7931f749a7c4774ade51ce5ed5040/contract';
import endContract from '../../snapshots/5652ee0b322183a876fa68a34f27ef6520d7931f749a7c4774ade51ce5ed5040/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/6d85032126e1e36fd69be5dd9cc2421107cb48034ddf2b75cc679c40ad57ec6a/contract';
import startContract from '../../snapshots/6d85032126e1e36fd69be5dd9cc2421107cb48034ddf2b75cc679c40ad57ec6a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, sql } from '@prisma/orm-postgres/migration';

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
      this.createIndex({
        schema: 'public',
        table: 'ledger_entry',
        index: 'ledger_entry_grantCardReturn_key',
        columns: ['themeProjectId', 'kind'],
        extras: { where: sql`("kind" = 'GRANT_CARD_RETURN'::"LedgerKind")`, unique: true },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

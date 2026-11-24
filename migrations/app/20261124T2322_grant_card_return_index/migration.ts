#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/06c534590e9d44f4b1a9666c962ecf046bcf98f9f8408766f4a1480f38c15177/contract';
import startContract from '../../snapshots/06c534590e9d44f4b1a9666c962ecf046bcf98f9f8408766f4a1480f38c15177/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5652ee0b322183a876fa68a34f27ef6520d7931f749a7c4774ade51ce5ed5040/contract';
import endContract from '../../snapshots/5652ee0b322183a876fa68a34f27ef6520d7931f749a7c4774ade51ce5ed5040/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
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

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/55324cd4c417de257c56c5187d6956f900b61949bc77ae4a73eabbb4fdcf6898/contract';
import endContract from '../../snapshots/55324cd4c417de257c56c5187d6956f900b61949bc77ae4a73eabbb4fdcf6898/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fdac6ef67f025180d2ff06c6e185c218977b4a75e02049c7f18ed713b6cdff37/contract';
import startContract from '../../snapshots/fdac6ef67f025180d2ff06c6e185c218977b4a75e02049c7f18ed713b6cdff37/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'submission_review',
        column: col('justification', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'submission_review',
        column: col('unifiedApprovedAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'submission_review',
        column: col('unifiedApprovedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'submission_review',
        column: col('unifiedOverrides', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'submission_review',
        foreignKey: {
          name: 'submission_review_unifiedApprovedById_fkey',
          columns: ['unifiedApprovedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

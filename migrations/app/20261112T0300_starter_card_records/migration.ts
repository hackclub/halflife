#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/6494104d31de4a658f13826be519eda3454ed97c77eafba80c116a9cd8b89c5f/contract';
import endContract from '../../snapshots/6494104d31de4a658f13826be519eda3454ed97c77eafba80c116a9cd8b89c5f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d6581e2f6357e120e40fd340b6e68eef4ff85d02f6318aa86ff41b85bb6d387c/contract';
import startContract from '../../snapshots/d6581e2f6357e120e40fd340b6e68eef4ff85d02f6318aa86ff41b85bb6d387c/contract.json' with { type: 'json' };
import { col, Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

/**
 * Starter card records: a CSV export row can now be superseded when its HCB grant is cancelled, so the project can be paid again.
 *
 * The unique index on a project's export row only covers live rows, so the superseded history stays in the table. The planner cannot change an existing index's condition, so the index is replaced here.
 */
export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_SUPERSEDE_GRANT_CARD_EXPORT',
      }),
      this.addColumn({
        schema: 'public',
        table: 'hcb_card_grant_export_row',
        column: col('supersededAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
      this.dropIndex({
        schema: 'public',
        table: 'hcb_card_grant_export_row',
        index: 'hcb_card_grant_export_row_project_key',
      }),
      this.createIndex({
        schema: 'public',
        table: 'hcb_card_grant_export_row',
        index: 'hcb_card_grant_export_row_project_key',
        columns: ['themeProjectId'],
        extras: {
          where: sql`("supersededAt" IS NULL)`,
          unique: true,
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/218a6e5fad533cf2010b2d28c4fcdcae20960e1ac8ed9b74b762e011f2b40301/contract';
import startContract from '../../snapshots/218a6e5fad533cf2010b2d28c4fcdcae20960e1ac8ed9b74b762e011f2b40301/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/869bb3d4436fe96697fac600dfe0a5ddc80bea218c195d0ba29d1ee7c3c4d6d7/contract';
import endContract from '../../snapshots/869bb3d4436fe96697fac600dfe0a5ddc80bea218c195d0ba29d1ee7c3c4d6d7/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_SUSPEND_USER',
      }),
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_UNSUSPEND_USER',
      }),
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_BAN_USER',
      }),
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_UNBAN_USER',
      }),
      this.addColumn({
        schema: 'public',
        table: 'post',
        column: col('hiddenByBanAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'post_comment',
        column: col('hiddenByBanAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('banReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('bannedAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('bannedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('suspendedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('suspendedUntil', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('suspensionReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

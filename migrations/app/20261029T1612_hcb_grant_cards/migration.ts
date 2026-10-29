#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/8fc2beff87e71f16f8d3d2e856b084ad5f264ad98d511b2dc5947dae1a538e7d/contract';
import startContract from '../../snapshots/8fc2beff87e71f16f8d3d2e856b084ad5f264ad98d511b2dc5947dae1a538e7d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f3fc2e8af8c37a08c413e4179e5e2c539bc789e9173ae038cdc16ab1a0c1a0e4/contract';
import endContract from '../../snapshots/f3fc2e8af8c37a08c413e4179e5e2c539bc789e9173ae038cdc16ab1a0c1a0e4/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_ISSUE_GRANT_CARD',
      }),
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_CREATE_GRANT_CARD_BATCH',
      }),
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'AuditAction',
        value: 'ADMIN_CANCEL_GRANT_CARD',
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'HcbGrantCardBatchStatus',
        members: ['PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'HcbGrantCardStatus',
        members: ['PENDING', 'ISSUED', 'FAILED', 'AMBIGUOUS', 'SKIPPED', 'CANCELED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'PayoutSource',
        members: ['AIRTABLE', 'HCB'],
      }),
      this.createTable({
        schema: 'public',
        table: 'hcb_grant_card',
        columns: [
          col('amountCents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('batchId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('bomLineCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('canceledAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('cardId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('claimedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('disbursementId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('grantUsdCents', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('hcbCardGrantId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('hcbStatus', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('issuedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('phase', '"Phase"', {
            notNull: true,
            default: lit('DESIGN'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'Phase' } },
          }),
          col('purpose', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', '"HcbGrantCardStatus"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'HcbGrantCardStatus' } },
          }),
          col('supersededAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('themeProjectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'hcb_grant_card_batch',
        columns: [
          col('ambiguousCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('completedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('createdById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('failedCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('fingerprint', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('issuedCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('skippedCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', '"HcbGrantCardBatchStatus"', {
            notNull: true,
            default: lit('PROCESSING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'HcbGrantCardBatchStatus' } },
          }),
          col('totalCents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'program_settings',
        column: col('payoutSource', '"PayoutSource"', {
          notNull: true,
          default: lit('AIRTABLE'),
          codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'PayoutSource' } },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'hcb_grant_card',
        index: 'hcb_grant_card_batchId_status_idx',
        columns: ['batchId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'hcb_grant_card',
        index: 'hcb_grant_card_hcbCardGrantId_key',
        columns: ['hcbCardGrantId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'hcb_grant_card',
        index: 'hcb_grant_card_project_phase_live_key_0605fbc3',
        columns: ['themeProjectId', 'phase'],
        extras: {
          where: sql`("supersededAt" IS NULL AND "status" IN ('PENDING'::"HcbGrantCardStatus", 'ISSUED'::"HcbGrantCardStatus", 'AMBIGUOUS'::"HcbGrantCardStatus"))`,
          unique: true,
        },
      }),
      this.createIndex({
        schema: 'public',
        table: 'hcb_grant_card',
        index: 'hcb_grant_card_userId_status_idx',
        columns: ['userId', 'status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'hcb_grant_card',
        foreignKey: {
          name: 'hcb_grant_card_batchId_fkey',
          columns: ['batchId'],
          references: { schema: 'public', table: 'hcb_grant_card_batch', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'hcb_grant_card',
        foreignKey: {
          name: 'hcb_grant_card_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'hcb_grant_card',
        foreignKey: {
          name: 'hcb_grant_card_themeProjectId_fkey',
          columns: ['themeProjectId'],
          references: { schema: 'public', table: 'theme_project', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/218a6e5fad533cf2010b2d28c4fcdcae20960e1ac8ed9b74b762e011f2b40301/contract';
import endContract from '../../snapshots/218a6e5fad533cf2010b2d28c4fcdcae20960e1ac8ed9b74b762e011f2b40301/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f8084ae571e7ed18760ecffe5d6d4321c7c0f587cff8e62f201c69ecc49c7e14/contract';
import startContract from '../../snapshots/f8084ae571e7ed18760ecffe5d6d4321c7c0f587cff8e62f201c69ecc49c7e14/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // Postgres cannot reorder an enum's existing values, so the reorder is
      // a swap: create the type again under a temporary name in the new
      // order, move the one column onto it, drop the old type, rename back.
      // The member set is identical, so the USING cast cannot fail.
      rawSql({
        id: 'createNativeEnumType.AuditAction_new',
        label: 'Create enum type "AuditAction_new"',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'type',
            name: 'AuditAction_new',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'create enum type "AuditAction_new"',
            sql: "CREATE TYPE \"public\".\"AuditAction_new\" AS ENUM ('USER_UPDATE_PROJECT', 'USER_SUBMIT_PHASE', 'USER_UNSUBMIT_PHASE', 'USER_CREATE_SESSION', 'USER_UPDATE_SESSION', 'USER_DELETE_SESSION', 'USER_LINK_HACKATIME', 'USER_UNLINK_HACKATIME', 'USER_PLACE_ORDER', 'REVIEW_CLAIM', 'REVIEW_RELEASE', 'REVIEW_APPROVE', 'REVIEW_RETURN', 'REVIEW_REJECT', 'REVIEW_APPROVE_HOURS', 'ADMIN_UNAPPROVE_PHASE', 'ADMIN_REOPEN_PHASE', 'ADMIN_GRANT_ROLE', 'ADMIN_REVOKE_ROLE', 'ADMIN_FLAG_FRAUD', 'ADMIN_UNFLAG_FRAUD', 'ADMIN_GRANT_EXTENSION', 'ADMIN_ADJUST_CREDIT', 'ADMIN_DELETE_PROJECT', 'ADMIN_RESTORE_PROJECT', 'ADMIN_CREATE_SHOP_ITEM', 'ADMIN_UPDATE_SHOP_ITEM', 'ADMIN_RETIRE_SHOP_ITEM', 'ADMIN_FULFILL_ORDER', 'ADMIN_REJECT_ORDER', 'ADMIN_UPDATE_PROGRAM_SETTINGS', 'PRINTER_QUALIFIED', 'PRINTER_STATUS_CHANGE', 'PRINTER_REVOKED', 'AIRTABLE_SYNC_SUCCESS', 'AIRTABLE_SYNC_FAILURE', 'NOTIFICATION_FAILURE', 'SYSTEM_HACKATIME_SYNC', 'SYSTEM_CLAIM_SWEEP', 'SYSTEM_RSVP_DRAIN', 'USER_CREATE_POST', 'USER_DELETE_POST', 'ADMIN_HIDE_POST', 'ADMIN_RESTORE_POST', 'USER_ADVANCE_ONBOARDING', 'USER_COMPLETE_ONBOARDING', 'USER_COMMENT_POST', 'USER_DELETE_COMMENT', 'ADMIN_HIDE_COMMENT', 'ADMIN_PIN_POST', 'USER_HANDOFF_UPLOAD', 'USER_SET_PRINTER_GOAL', 'ADMIN_UPDATE_ORDER_FULFILLMENT', 'ARI_SYNC_SUCCESS', 'ARI_SYNC_FAILURE', 'ARI_WEBHOOK_APPLIED', 'ARI_WEBHOOK_IGNORED', 'USER_DISPUTE_REVIEW', 'ADMIN_RESOLVE_DISPUTE', 'ADMIN_SEND_GRANT', 'ADMIN_RESET_ONBOARDING', 'ADMIN_IMPORT_AIRTABLE_PROJECT', 'USER_DELETE_PROJECT', 'USER_UPDATE_REPO_SYNC', 'REPO_SYNC_SUCCESS', 'REPO_SYNC_FAILURE', 'USER_SET_PARTICIPANT_GOAL', 'ADMIN_CREATE_SHOP_REGION', 'ADMIN_UPDATE_SHOP_REGION', 'ADMIN_SET_REGION_PRICE', 'USER_CREATE_REPORT', 'ADMIN_RESOLVE_REPORT', 'ADMIN_DISMISS_REPORT', 'ADMIN_CREATE_PROGRAM_EVENT', 'ADMIN_UPDATE_PROGRAM_EVENT', 'ADMIN_DELETE_PROGRAM_EVENT', 'ADMIN_MOVE_PROJECT', 'ADMIN_CHANGE_EMAIL', 'USER_CREATE_POST_FAILED')",
            params: [],
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'alterColumnType.audit_log.action',
        label: 'Alter column "action" on "audit_log"',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'column',
            table: 'audit_log',
            name: 'action',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'alter column "action" on "audit_log"',
            sql: 'ALTER TABLE "public"."audit_log" ALTER COLUMN "action" TYPE "public"."AuditAction_new" USING "action"::text::"public"."AuditAction_new"',
            params: [],
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'dropNativeEnumType.AuditAction',
        label: 'Drop enum type "AuditAction"',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'type',
            name: 'AuditAction',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'drop enum type "AuditAction"',
            sql: 'DROP TYPE "public"."AuditAction"',
            params: [],
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'renameNativeEnumType.AuditAction_new',
        label: 'Rename enum type "AuditAction_new" to "AuditAction"',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'type',
            name: 'AuditAction_new',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'rename enum type "AuditAction_new" to "AuditAction"',
            sql: 'ALTER TYPE "public"."AuditAction_new" RENAME TO "AuditAction"',
            params: [],
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

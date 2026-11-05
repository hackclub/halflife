#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/f38c776a619f1f8942a7b6ff3346a34d573cfcf039263b8731c91feebb77421c/contract';
import startContract from '../../snapshots/f38c776a619f1f8942a7b6ff3346a34d573cfcf039263b8731c91feebb77421c/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/9e0483430e76fe1f978d8a9ca8602bb11e81e094f2d411b3528ad222a1e6113e/contract';
import endContract from '../../snapshots/9e0483430e76fe1f978d8a9ca8602bb11e81e094f2d411b3528ad222a1e6113e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

const STEPS: Array<[string, string]> = [
  [`Recreate enum type with the Ire sync labels`,
   `CREATE TYPE "public"."AuditAction_new" AS ENUM ('USER_UPDATE_PROJECT', 'USER_SUBMIT_PHASE', 'USER_UNSUBMIT_PHASE', 'USER_CREATE_SESSION', 'USER_UPDATE_SESSION', 'USER_DELETE_SESSION', 'USER_LINK_HACKATIME', 'USER_UNLINK_HACKATIME', 'USER_PLACE_ORDER', 'REVIEW_CLAIM', 'REVIEW_RELEASE', 'REVIEW_APPROVE', 'REVIEW_RETURN', 'REVIEW_REJECT', 'REVIEW_APPROVE_HOURS', 'ADMIN_UNAPPROVE_PHASE', 'ADMIN_REOPEN_PHASE', 'ADMIN_GRANT_ROLE', 'ADMIN_REVOKE_ROLE', 'ADMIN_FLAG_FRAUD', 'ADMIN_UNFLAG_FRAUD', 'ADMIN_GRANT_EXTENSION', 'ADMIN_ADJUST_CREDIT', 'ADMIN_DELETE_PROJECT', 'ADMIN_RESTORE_PROJECT', 'ADMIN_CREATE_SHOP_ITEM', 'ADMIN_UPDATE_SHOP_ITEM', 'ADMIN_RETIRE_SHOP_ITEM', 'ADMIN_FULFILL_ORDER', 'ADMIN_REJECT_ORDER', 'ADMIN_UPDATE_PROGRAM_SETTINGS', 'PRINTER_QUALIFIED', 'PRINTER_STATUS_CHANGE', 'PRINTER_REVOKED', 'AIRTABLE_SYNC_SUCCESS', 'AIRTABLE_SYNC_FAILURE', 'NOTIFICATION_FAILURE', 'SYSTEM_HACKATIME_SYNC', 'SYSTEM_CLAIM_SWEEP', 'SYSTEM_RSVP_DRAIN', 'USER_CREATE_POST', 'USER_DELETE_POST', 'ADMIN_HIDE_POST', 'ADMIN_RESTORE_POST', 'USER_ADVANCE_ONBOARDING', 'USER_COMPLETE_ONBOARDING', 'USER_COMMENT_POST', 'USER_DELETE_COMMENT', 'ADMIN_HIDE_COMMENT', 'ADMIN_PIN_POST', 'USER_HANDOFF_UPLOAD', 'USER_SET_PRINTER_GOAL', 'ADMIN_UPDATE_ORDER_FULFILLMENT', 'ARI_SYNC_SUCCESS', 'ARI_SYNC_FAILURE', 'ARI_WEBHOOK_APPLIED', 'ARI_WEBHOOK_IGNORED', 'USER_DISPUTE_REVIEW', 'ADMIN_RESOLVE_DISPUTE', 'ADMIN_SEND_GRANT', 'ADMIN_RESET_ONBOARDING', 'ADMIN_IMPORT_AIRTABLE_PROJECT', 'USER_DELETE_PROJECT', 'USER_UPDATE_REPO_SYNC', 'REPO_SYNC_SUCCESS', 'REPO_SYNC_FAILURE', 'USER_SET_PARTICIPANT_GOAL', 'ADMIN_CREATE_SHOP_REGION', 'ADMIN_UPDATE_SHOP_REGION', 'ADMIN_SET_REGION_PRICE', 'USER_CREATE_REPORT', 'ADMIN_RESOLVE_REPORT', 'ADMIN_DISMISS_REPORT', 'ADMIN_CREATE_PROGRAM_EVENT', 'ADMIN_UPDATE_PROGRAM_EVENT', 'ADMIN_DELETE_PROGRAM_EVENT', 'ADMIN_MOVE_PROJECT', 'ADMIN_CHANGE_EMAIL', 'USER_CREATE_POST_FAILED', 'ADMIN_SUSPEND_USER', 'ADMIN_UNSUSPEND_USER', 'ADMIN_BAN_USER', 'ADMIN_UNBAN_USER', 'USER_CANCEL_ORDER', 'ADMIN_ISSUE_GRANT_CARD', 'ADMIN_CREATE_GRANT_CARD_BATCH', 'ADMIN_CANCEL_GRANT_CARD', 'IRE_SYNC_SUCCESS', 'IRE_SYNC_FAILURE')`],
  [`Move audit_log.action onto the replacement type, mapping retired labels`,
   `ALTER TABLE "public"."audit_log" ALTER COLUMN "action" TYPE "public"."AuditAction_new" USING (REPLACE("action"::text, 'REVIEW_SYNC', 'IRE_SYNC')::"public"."AuditAction_new")`],
  [`Drop the old enum type`,
   `DROP TYPE "public"."AuditAction"`],
  [`Rename the replacement type to AuditAction`,
   `ALTER TYPE "public"."AuditAction_new" RENAME TO "AuditAction"`],
  [`Rename review_ship to ire_ship, keeping every row`,
   `ALTER TABLE "public"."review_ship" RENAME TO "ire_ship"`],
  [`Rename the primary key index`,
   `ALTER INDEX "public"."review_ship_pkey" RENAME TO "ire_ship_pkey"`],
  [`Rename the remote-id unique index`,
   `ALTER INDEX "public"."review_ship_remoteId_key" RENAME TO "ire_ship_remoteId_key"`],
  [`Rename the theme-project-phase unique index`,
   `ALTER INDEX "public"."review_ship_themeProjectId_phase_key" RENAME TO "ire_ship_themeProjectId_phase_key"`],
  [`Rename the closed-at index`,
   `ALTER INDEX "public"."review_ship_closedAt_idx" RENAME TO "ire_ship_closedAt_idx"`],
  [`Rename the theme-project foreign key`,
   `ALTER TABLE "public"."ire_ship" RENAME CONSTRAINT "review_ship_themeProjectId_fkey" TO "ire_ship_themeProjectId_fkey"`],
  [`Point sync_run_log at the renamed sync key`,
   `UPDATE "public"."sync_run_log" SET "syncKey" = 'ire_ship' WHERE "syncKey" = 'review_ship'`],
  [`Record Ire shadow deliveries under provider ire`,
   `UPDATE "public"."audit_log" SET "metadata" = jsonb_set("metadata", '{provider}', '"ire"') WHERE ("metadata" ->> 'provider') = 'review'`],
];

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return STEPS.map(([label, sql], i) =>
      rawSql({
        id: `rename-review-to-ire.step${i}`,
        label,
        operationClass: "data",
        target: { id: "postgres" },
        precheck: [],
        execute: [{ description: label, sql, params: [] }],
        postcheck: [],
      }),
    );
  }
}

MigrationCLI.run(import.meta.url, M);

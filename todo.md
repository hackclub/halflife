# Half Life — open work

The six items from the original notes are **done**. This file records the
cross-cutting decisions that were settled alongside them and the external steps
that remain before launch.

## Status

| # | Item | State |
| --- | --- | --- |
| 1 | Register the Ari callback URL | Built; operator panel at `/admin/program` shows the URL + config state. External: register it and set the secrets. |
| 2 | Notify participants of review outcomes | Built — Slack DM + email, all three outcomes, both decision paths (console + Ari). External: email credentials. |
| 3 | Submission state across the projects UI | Built — card borders, per-phase chips, legend; the project page has a Review block above the repo checks. |
| 4 | Review actions on the project page | Built — resubmit (opens the submit sheet) and dispute (flags for staff, changes no state). |
| 5 | Project placeholder from a reel or devlog | Built — cover → newest journal image → newest reel frame (thumbnail, else a video's first frame). |
| 6 | Send grants from the admin panel (HCB) | Built — manual, idempotent top-up on `/admin/users/[id]`. External: HCB OAuth app + refresh-token persistence. |

## Decisions

- **Payout ownership — the Airtable/YSWS pipeline owns payouts.** The HCB
  "Send grant" action is a deliberate **manual fallback**, not the normal path.
  It is idempotent within Half Life but does **not** know what the pipeline has
  paid, so enabling both can double-pay. See `docs/BACKEND.md` → Payouts.
- **Email — Resend.** `sendEmail` (Resend's HTTP API, no SDK) sends a text and
  an HTML body; unconfigured, the send fails and the notifier records a
  `NOTIFICATION_FAILURE` audit row, so a deployment missing credentials is
  visible in ops.
- **Notifications — all three outcomes, to the maker, Slack DM + email.**
  `approved`, `changes requested` and `rejected` all notify.
- **Green border — the current phase approved.** The design until the build
  starts, the build once it has. A passed design with the build not begun reads
  green.

## Before launch (external)

1. **Ari:** register `https://<host>/api/integrations/ari/webhook`, set
   `ARI_PROGRAM_ID` / `ARI_SIGNING_SECRET` / `ARI_WEBHOOK_SECRET`, create the
   `ari-retry` job.
2. **Email:** set `RESEND_API_KEY` and a verified `EMAIL_FROM`.
3. **HCB (only if the manual fallback is wanted):** register the OAuth app,
   invite it to the org as a manager, run a $1 top-up on a test org, and decide
   where the rotated refresh token is persisted.
4. **Slack:** set `SLACK_REVIEW_CHANNEL_ID` if dispute notices should be posted.

## Original notes

- Callback URL for Ari
- Project approval (when done in Ari) should notify the user
  - By email and by Slack DM
- Indicate submission state on the projects page for each project
  - Green border = approved
  - Blue border = submitted, not reviewed
  - Yellow/orange/amber border = reviewed, needs changes
  - Red border = rejected
  - Also display state and extra review info on the project page
    - Display above repo checks section
    - Multiple choice for options
      - "I have made these changes, resubmit"
      - "This review is incorrect, project works as intended" or similar
      - Other idk
- A button in the admin panel to send out grants
  - Use the HCB API at https://hcb.hackclub.com/docs/api/v3
    - we need to find an authenticated version of this that allows for sending out grant cards
- Placeholder image for project should be a screenshot from a reel or image from a devlog

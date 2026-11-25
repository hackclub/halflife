# Half Life – open work

The six items from the original notes are **done**. This file records the cross-cutting decisions that were settled alongside them and the external steps that remain before launch.

## Status

| # | Item | State |
| --- | --- | --- |
| 1 | Notify participants of review outcomes | Built – Slack DM, all three outcomes, from the review console. Email is a Loops workflow off the Airtable row. External: configure that workflow. |
| 2 | Submission state across the projects UI | Built – card borders, per-phase chips, legend; the project page has a Review block above the repo checks. |
| 3 | Review actions on the project page | Built – resubmit (opens the submit sheet) and dispute (flags for staff, changes no state). |
| 4 | Project placeholder from a reel or devlog | Built – cover → newest journal image → newest reel frame (thumbnail, else a video's first frame). |
| 5 | Send grants from the admin panel (HCB) | Built – manual, idempotent top-up on `/admin/users/[id]`. External: HCB OAuth app + refresh-token persistence. |

## Decisions

- **Payouts – HCB.** Grants are paid through the HCB API, never through the YSWS table, which only feeds Loops. The HCB "Send grant" action on a user is a manual top-up. It is idempotent within Half Life but does not see grant cards issued elsewhere, so check a project's payments before sending one. See `docs/BACKEND.md` → Payouts.
- **Email – Loops, off Airtable.** Half Life does not mail anyone. It writes the decision to the submission's row – `Loops - halfLifeReviewStatus` and the reviewer's note in `Loops - halfLifeReviewerNotes` (see `syncReviewDecisionToYsws` in `src/lib/airtable/sync.ts`) – and a Loops workflow sends from there. The Resend path was removed rather than kept as a second sender. The same write fills two override columns – `Loops - Override - halfLifeProjectName` and `Loops - Override - halfLifeProjectWeek` – because email-tools only forwards a `Loops - …` field whose value changed on that row. Without them a decision on an older project changed only status and note, so the contact kept the project name and week from the maker's most recent submission. The override prefix makes email-tools apply them to the same contact property.
- **Notifications – all three outcomes, to the maker, Slack DM plus the Loops email.** `approved`, `changes requested` and `rejected` all notify.
- **Green border – the current phase approved.** The design until the build starts, the build once it has. A passed design with the build not begun reads green.

## Before launch (external)

1. **Email:** build the Loops workflow on the Airtable base – it reads `Loops - halfLifeReviewStatus` (and quotes `Loops - halfLifeReviewerNotes`) and sends for `Approved`, `Changes Requested` and `Rejected`. Create `Loops - Override - halfLifeProjectName` and `Loops - Override - halfLifeProjectWeek` as single-line text fields, then run `bun run loops:backfill-review-overrides` once (dry run first, then `--commit`) so the new columns start with each row's own values. Pause the email-tools Airtable source while doing this: the first poll after new `Loops - …` fields appear does a full resync, and blank overrides on that pass would clear the project name on every contact. Resume once the backfill has filled them.
2. **HCB (only if the manual top-up is wanted):** register the OAuth app, invite it to the org as a manager, run a $1 top-up on a test org, and decide where the rotated refresh token is persisted.
3. **Slack:** set `SLACK_DISPUTES_CHANNEL_ID` if dispute notices should be posted.

## Original notes

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

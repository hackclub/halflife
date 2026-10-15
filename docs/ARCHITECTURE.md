# Architecture notes

Short version of the decisions that are not obvious from the code, and what
each one is defending against. Most were learned from reading
`hackclub/siege` and `hackclub/stasis`, the two sibling program platforms.

## Postgres is the source of truth; Airtable is a sink

Both siege and stasis are described as "Airtable programs" and neither uses
Airtable as its datastore. Airtable holds three things in both: the RSVP funnel,
the `YSWS Project Submission` rows the payout pipeline reads, and a few
ops-curated tables the app only reads. Everything transactional is Postgres.

That split is not incidental. Airtable has no transactions, no unique
constraints, a 5 req/s cap and 100 records per page. The review claim lock, the
credit ledger and shop purchases all need exactly the guarantees it lacks.

## The ledger reconciles to a target instead of reversing

`reconcileGrant(tx, { userId, themeProjectId, kind, target })` appends one delta
row so that `SUM(amount)` over that triple equals `target`. Approving a build
five times converges on one balance; un-approving is the same call with
`target: 0`.

Stasis instead pairs each ledger kind with a `*_REVERSED` twin and cancels by
hand, which means every aggregate over the ledger has to remember to include the
twin. Its `lib/currency.ts` carries a long comment about the query that forgot:

> Do NOT compute this by summing every DESIGN_APPROVED entry: no build approval
> ever nets out a project-less credit, so a blind sum overcounts forever and
> hides real spendable bits once the credit has been spent.

Having no reversal code path means there is no reversal code path to get wrong.
`pnpm verify:ledger` asserts the property end to end.

## Credit mutations take a per-user advisory lock

The balance is `SUM(amount)` over an append-only table, so there is no row a
transaction can lock, and Postgres's default READ COMMITTED lets two concurrent
transactions both read the same pre-existing balance and both commit. The first
version of `purchase()` relied on `@@unique([shopOrderId, kind])` and was wrong:
that constraint stops one order being charged twice, but two concurrent
purchases mint two different order ids and collide with nothing. Eight parallel
requests bought eight things with one balance.

`lockUserCredit(tx, userId)` takes a `pg_advisory_xact_lock` as the first
statement inside every transaction that reads a balance and then writes against
it – purchase, refund, admin adjustment, and the review reconcile. It releases
with the transaction, including on rollback. `scripts/verify-ledger.ts` fires
eight concurrent purchases and asserts exactly one succeeds.

## Tiers are assigned at design approval

The tier's dollars are parts money. A participant cannot buy components for a
build whose budget has not been decided, so the tier lands when the design is
approved, and the `YSWS Project Submission` row for the Design stage is the one
that carries `Requested Grant Amount`. The Build row is written at zero so the
payout team has the full trail without a second payment.

## Banking is paced by the printer, not by the tier

A tier decides one thing: how many of a design week's hours the project itself
eats. Everything above that funded block banks toward a machine, and how much
has to bank each week is a property of the machine, not of the tier – so Tier 1
and Tier 3 both reach a Bambu P1S, and Tier 3 simply has more funded hours
underneath the same banking.

It used to be a tier property (a fixed 2, 5 or 10 hours a week), which quietly
made the expensive machines unreachable from Tier 1 and over-funded the cheap
ones from Tier 3 – and sized the whole programme against a 175-coin printer that
was not the price of anything. The cheapest machine on the budget sheet is
$218.90.

`lib/config/printers.ts` is that sheet transcribed, column for column, and the
identity it has to keep is: five design weeks at a goal's banking rate, plus
five build weeks of `BUILD_HOURS`, clears that goal's price. `verify:ledger`
checks it for all eight machines, because the failure mode is a season that ends
with no printer and no error message.

Banked hours round UP to coins. The sheet paces in fractions and coins are
whole; flooring costs a coin a week, which leaves an A1 Mini saver one coin
short of the machine the goal tracker spent ten weeks promising them.

## The trail is derived, not stored

The platform's shape – how many nodes a week has, where the progress reels fall,
which node is live, what is locked and why – is computed by one pure function
(`lib/curriculum.ts`) from one map of checkpoint states. The server's only job
is to say which checkpoints are done and with what; `lib/queries/store.ts` reads
that map out of the projects, sessions, posts and submissions that already
exist.

There is deliberately no checkpoint table. It would be a second source of truth
for "has this week had its idea reel", and the first time the two disagreed the
trail would lie to someone about work they had really done.

Reels bind to their node by `Post.checkpointKey` rather than by counting posts
of a kind: the 5h and the 15h reel are both `PROGRESS`, so counting would tick
the 20h node the moment the 10h one landed.

## Three hours sources, two ways to double-count

- **Journal + Hackatime are additive**, so a session whose time is already
  tracked by a linked Hackatime project must not also count as journal hours.
  `WorkSession.hoursSource = HACKATIME_TRACKED` marks those; they still exist as
  a journal entry and as evidence, but contribute zero. Stasis sums both
  unconditionally and relies on reviewers noticing.
- **Timelapse is evidence, not a bucket.** Its duration is never added to a
  total; it becomes a coverage ratio against claimed time. `coveredSeconds`
  (wall-clock time represented) is stored separately from `runtimeSeconds` (the
  video's length), because stasis stores only the runtime and then reports it as
  hours – so a 30× timelapse of eight hours displays as 0.27h and looks like the
  participant did nothing.

Approving refuses outright when Hackatime data is stale, rather than treating a
failed fetch as zero. Stasis's client returns 0 on any error including a
timeout, and that zero flows into the hours field on the grant row with no
trace: a blip during an approval silently underpays someone.

## Weeks are derived, themes are constants

Week number is counted in program-timezone calendar days from the program
start's UTC date: a week flips at midnight in the program's timezone, the same
instant its deadline closes. There is no `Week` table: a week is not something
anyone edits, and a row would only create drift between the database and the
copy on the dashboard. Siege has run a 14-week program on exactly this.

Deadlines are **soft**. The week schedule drives what the dashboard highlights
and stamps an `onTime` flag on submissions for analytics. Nothing gates on it –
a late joiner has to be able to finish, and someone doing week 3's theme in
week 5 lands on the same row they would have in week 3. Hard gating is one
settings toggle plus per-user and per-project `submissionExtensionUntil`
columns, which stasis added after doing manual database surgery for every
extension request.

## Build may be submitted before design is approved

With five concurrent themes sharing one review queue, gating submission on
approval turns a reviewer-capacity problem into a participant-blocked problem:
someone sits idle through their build week waiting on the queue. So submission
requires only that the design has left `draft`. **Finalising** a build still
requires the design to be approved, so the ordering invariant holds where money
is involved and not where it only costs people time.

## Live switches are database rows, not env vars

Submissions open, shop open, event start date and the Airtable kill switch live
in `ProgramSettings` and are edited at `/admin/program`. Stasis put its
submission gate in `SUBMISSIONS_CLOSED` and `lib/event.ts` records the outcome:
the variable "was never flipped in Coolify and submissions silently stayed open
for two weeks". A row with a toggle and an audit trail cannot be forgotten in a
dashboard.

Tier values are the deliberate exception: they are code, because an ops person
editing a currency field at 2am must not be able to change what everyone gets
paid with no review and no record. Every review freezes the numbers it used onto
`SubmissionReview`, so changing them never rewrites history.

## Airtable writes

- An adopt-or-create keyed on `(email, project name, stage)` under a Postgres
  advisory lock per `(project, phase)`, not a plain read-then-write. Two
  concurrent writes – an admin double-click, a retried request, the submit hook
  racing the retry job – would both read zero rows and both create, putting
  duplicate grant rows into the payout sink. (Airtable's `performUpsert` on a
  `(Half-Life ID, Stage)` field pair is the better key when those fields
  exist; the lock is what makes the current key safe.)
- `typecast: false`, or a typo in a theme name silently adds a sixth option to
  the single-select.
- Deletion from the shared unified base goes by exact record id, captured from
  `Automation - YSWS Record ID` before the local rows are removed. Code URL is
  not unique across programs, and here all five of a participant's themed
  projects may live in one monorepo.
- One shared token bucket plus retry-with-backoff, ported from siege. Stasis has
  no rate-limit handling at all; siege's per-job `sleep 0.25` only works because
  its sync is a single serialised job.
- Failures write an `AIRTABLE_SYNC_FAILURE` audit row and are replayable from
  `/admin/program` and by the hourly retry job, because approval and the row
  reaching Airtable are separate steps and only the first one is transactional.
- The writes made after the row exists are the two Loops columns: the status,
  set from every committed decision (the Ari webhook, the review console, an
  admin's un-approve or reopen), and the reviewer's note the email quotes.
  Both go through `mirrorReviewDecision`, which splits them into separate
  requests so a notes column that refuses its value cannot cost the status its
  update. Best-effort and never throwing: the review is committed in Postgres
  first, and a base that is briefly unreachable must not make Ari redeliver a
  decision that has already been applied.

## RSVP is write-behind

Every RSVP lands in `RsvpBuffer` in Postgres and is drained to Airtable by a
job. Stasis writes through synchronously inside the request handler, so a
rate-limited Airtable becomes a failed signup – and only falls back to Postgres
when someone flips an env var by hand.

## Auth and guards

Hack Club Auth is one provider carrying identity, Slack ID, YSWS
`verification_status` and (optionally) address and birthday, which replaces
siege's separate Slack-OAuth-plus-identity-vault dance.

It answers with two names, and the site shows one of them. HCA's `nickname`
claim is copied to `User.displayName` at every sign-in and is what every
surface renders, through `lib/display-name`; `User.name` keeps the full
"first last" string for everything that needs a whole person – the Airtable
RSVP and YSWS rows, Ari, the participant export – all of which split it into
first and last. The helper falls back to `name` for a row that has not signed
in since the column existed.

Two guard modules, because they fail differently: `lib/guards.ts` returns a JSON
response for route handlers, `lib/page-guards.ts` redirects or 404s for server
components. Page-level auth in a server component removes the auth flash and
stops an unauthorised page rendering at all – stasis does admin auth in a
`'use client'` layout, so `/admin` renders first and then vanishes.

Permission checks 404 rather than 403 where the resource's existence is itself
information, so guessing at `/admin` tells you nothing.

## Uploads store keys, not URLs

`SessionMedia.objectKey` is an R2 key; the public URL is minted at read time.
Stasis stores full URLs, so moving buckets or adding a CDN means rewriting every
row. Keys are namespaced by user id, which makes abuse traceable and orphan
cleanup possible.

Airtable attachment URLs are never handed to a browser: they are signed and
expire in about two hours. Images live in R2, and Airtable is given a URL it
fetches once.

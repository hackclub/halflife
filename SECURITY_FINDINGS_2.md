1. Signing in as any user, including admins. Checked in the code; the attack depends on one thing I couldn't confirm.
- better-auth's /api/auth/sign-in/social accepts a Hack Club Auth (HCA) login token pasted in by the caller. It checks the token is genuine, but then works out who you are from a separate access token that the caller also supplies (src/lib/auth.ts:190).
- Nothing checks that the two belong to the same person, and the replay protection only applies if the caller opts in.
- So an attacker sends their own valid login token plus a victim's HCA access token, and gets a session as the victim.
- What I couldn't confirm: how hard it is to get a victim's access token. One route: if anyone can register an HCA OAuth app, the attacker gets the victim to sign into theirs.
- Fix: add a better-auth hooks.before that rejects body.idToken on /sign-in/social and /link-social. That's a few lines.

High

2. Identity verification can be borrowed and reused.
- A signed-in user can link a second, already-verified person's HCA account, because HCA is a trusted provider and different emails are allowed.
- The verification status gets copied over (src/lib/hca-profile.ts:250). Once it says "verified" it's never checked again, so they can unlink and pass the same identity to another account.
- That gets around the identity check on the shop, HCB grants and coin credits.
- Fix: block linking and unlinking HCA after sign-up, and tie verification to the specific HCA account that proved it.

3. Hackatime hours count again on every project they're linked to.
- fetchProjectSeconds asks Hackatime for the project's all-time total, with no date range.
- The duplicate check only looks within one project (src/app/api/projects/[id]/hackatime/route.ts:71).
- So 20 tracked hours can be linked to every theme and warm-up, and each passes the tier-3 minimum. That's a $100 HCB grant plus up to 250 coins per project for one block of work.
- Fix: limit the query to the phase's week, and refuse a Hackatime project that's already linked on another of the user's projects.

4. One unauthenticated request can use up a server's memory.
- better-auth ships its own copy of zod at 4.6.5 (bun.lock:1464). The reviewer reports this version has advisory GHSA-mrhx-c7xc-m3w5.
- Sending /sign-in/social a huge scopes array builds an enormous error message. The reviewer measured about 670 MB from a 2 MB request.
- Fix: bump better-auth, or add an override forcing zod 4.6.6 or later, and cap request bodies at 1 MB.

5. A README can freeze the server for minutes.
- The image-matching regex at src/lib/repo-checks.ts:289 takes quadratic time on input like ![![![…, and README length isn't capped.
- One call to /preflight with such a README (a participant can point their project at any repo) stops that server responding.
- Fix: truncate the README to about 64 KB before running the regex.

Medium

- Reviewers can award themselves or friends money. hoursOverride goes up to 168 hours and the tier isn't checked against what was requested. Only setting the grant amount directly needs MANAGE_CREDIT. Approving a one-hour design at 168 hours and tier 3 mints coins and sets a $100 grant.
- The fraud flag only blocks submitting. Flagged users can still spend in the shop, receive grants and have printers shipped, and fulfillers can't see the flag. The printer award also has no identity check at all.
- Anyone can log out everyone viewing Explore. Markdown images allow any path starting with /, and /signed-out clears session cookies with no check. So ![x](/signed-out) in a journal entry logs out every viewer.
- Tracking pixels on a platform for minors. Journal images and avatars (better-auth's update-user still accepts image and name) can point at any external host, which logs viewers' IP addresses. There's no img-src rule in the Content-Security-Policy (CSP) to stop it.
- Participants can find out who reviewed them. GET /api/projects/[id] returns entire database rows, including designReviewedById and buildReviewedById. Reviewers, some of them teens, are meant to stay anonymous.
- Private repos can be read through the server's tokens, if those tokens can see private repos. Nothing checks a repo is public before the BOM import returns its CSV contents. The GitLab token is the most likely way in.
- Rate limits can be dodged on the direct host. half-life.k.hackclub.dev isn't behind Cloudflare, but the code trusts the CF-Connecting-IP header anyway, so sending a different fake value each time escapes every per-IP limit. It also makes the /api/subscribe problem worse: each signup makes about 66 Airtable calls that skip the throttle, so one IP can keep the whole Airtable base rate-limited.
- No cap on self-reported hours. Ten 15-hour entries in a minute are accepted.
- GitHub and GitLab tokens are stored in plain text. These are tokens that can write to repos. Also, /api/auth/get-access-token is reachable from the browser.
- Request size and upload problems:
  - The Slack and Ari webhooks read the whole request before checking the signature, with no size cap.
  - The unauthenticated phone-upload route can hog the shared upload memory budget, so other users' uploads fail.
  - The check that stops upload-from-URL fetching internal addresses has never been tested on Bun, which production runs on.

Low

- Admin pages: the referrals page shows participants' emails to reviewers and fulfillers.
- Shop pricing: buyers pick their own shop region, which sets the price.
- Review edge cases:
  - Ari can raise a project's tier, not just lower it.
  - Warm-up projects get the completion bonus.
  - Returning a submission reopens the whole project after the program closes.
  - An old Ari decision can land on a resubmission Ari never saw.
- Deleted content: deleted or hidden reels stay live in storage.
- Spam: comments have no rate limit, and the rate limiter keeps counts per server, so limits multiply as you add servers.
- CI: the lint workflows hold a token that can push to main, which auto-deploys, while running third-party code. Their actions aren't pinned to exact versions.
- Defence in depth:
  - The CSP has no script-src.
  - The image optimiser's cache can be bypassed to burn CPU.
  - A user's name falls back to their email, which then shows publicly.
  - One integration key does everything and is sent over plain HTTP inside the cluster.

Suggested order

1. Today: #1, #2 and #4. All three are small changes in src/lib/auth.ts and package.json.
2. Next: #3, #5, the reviewer hour caps and the fraud-flag checks, since these are where money leaks.
3. Then: the /signed-out and image fixes, explicit field lists on the project API, and checking CF-Connecting-IP comes from Cloudflare.

One thing to sort out before going public: this report describes unfixed holes in enough detail to exploit them, so it shouldn't go in SECURITY_FINDINGS.md until they're fixed. I can start fixing in that order, or publish it as a private page your team can work from – which would you like?
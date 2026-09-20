# family-chart Session Handoff Baton

2026-09-20 -- Issue clear-out: bug fix, uploads, modal editing session

**Branch:** master

**Last commits this session:**
- 4f7003c Merge pull request #27 from rodlunt/feat/issue-8-modal-editing
- b43a6c7 fix: multi-spouse child attribution and dropdown escaping in wizard
- 8c36e5b feat: modal-based editing and relationship-first add-relative wizard
- 3f7256f Merge pull request #26 from rodlunt/feat/issue-5-9-upload-endpoint
- bd1b473 fix: close upload/attachment XSS gaps flagged by security review
- d7045b9 feat: file upload endpoint, avatar picker, notes and attachments
- 97a36c8 Merge pull request #24 from rodlunt/fix/issue-22-unconfirmed-anchor-vanishing
- a5ee3ce fix: recurse show_unconnected into per-component nested layout
- eb39715 Merge pull request #23 from rodlunt/chore/remove-cypress-dependabot-alerts
- cc56404 chore: remove unused Cypress e2e suite

---

## What shipped this session

- **Issue #22 fixed (the vanishing-tree bug).** Root cause found: `placeUnconnected`'s nested per-component `calculateTree()` call only walked blood ancestors/descendants plus direct spouses, so a component member reachable only via a spouse's own parent (e.g. an unconfirmed ancestor tied in through an in-law) could never be placed, which silently dropped the entire component when that unreachable person carried the anchor link. Fixed by letting the nested call recurse with its own `show_unconnected` pass. Verified with a synthetic fixture that genuinely failed pre-fix and passed post-fix.
- **Issue #21 closed.** Removed the unused Cypress e2e devDependency (tested upstream's unchanged demo pages, wasn't wired into CI) -- cleared all 11 open Dependabot alerts at once. Filed a heads-up issue on upstream `donatso/family-chart` (#108) about the same Cypress-driven vulnerabilities, since it inherited the same devDependency.
- **Issues #5 + #9 shipped together (file upload, avatar picker, notes, attachments).** New `POST /api/upload` / `GET /uploads/*` in `server/index.js`, new `file`/`file-list` field types in the core library, `EditTree.setUploadHandler()`. Two real security defects found and fixed before merge: the server was deriving the served `Content-Type` from the client-supplied filename extension rather than the validated content-type (stored-XSS risk, fixed by forcing the extension from the validated type allowlist); and stored avatar/attachment URLs were rendered into `href`/`src` without scheme validation (fixed with an `isSafeUrl` check at every sink).
- **Issue #8 shipped (modal-based editing + relationship-first add-relative wizard).** Reused the library's existing `Modal` class (previously only used for the remove-relative confirmation) and `EditTree`'s already-swappable form-container abstraction, so this was less invasive than the issue's "real redesign" framing suggested. The old "5 ghost cards on the canvas" add-relative mechanism is replaced by an explicit two-step modal wizard (relationship type, then create-new-vs-link-existing). Found and fixed two defects before merge: the child-adding path silently misattributed a new child to `spouses[0]` when a person has more than one spouse (added a spouse-picker sub-step instead); and the wizard's dropdown (plus a pre-existing function it copied) interpolated person names into raw HTML unescaped (fixed with d3's safe `.text()`/`.attr()` API).
- **New issue #25 filed**: an in-app "something to contribute" form (text + file, with a credited/anonymous choice) for the four existing logins, explicitly deferring any review/moderation-queue question to #11.
- Backlog went from 8 open issues to 5 this session (#21, #22, #5, #9, #8 closed; #25 opened).

---

## Open follow-ups

1. **Issue #11 -- full passwordless magic-link login system + review workflow.** Still the biggest open design question: real auth, roles, a moderation queue, replacing the current "every login has equal direct write access" model. Issue #13 (admin panel) is blocked on this.
2. **Issue #13 -- user management admin panel.** Blocked on #11's user model existing first.
3. **Issue #10 -- per-person timeline (life events + artefacts).** Biggest of the remaining feature requests, needs its own design pass.
4. **Issue #12 -- move off the flat JSON file to a real (vector-capable) database.** Explicitly sequenced after #9/#10 settle what the new tables need to hold; #9 shipped this session, so this may be less premature than before, but hasn't been revisited.
5. **Issue #25 -- "something to contribute" form**, filed this session, not started. Depends on #5/#9's upload plumbing (already shipped), explicitly out of scope: any moderation gate (tracked in #11).
6. **Uncommitted `.gitignore` change on disk right now** (adds `/outreach/`), still present, still not from this session's issue work -- it's Rodney's own in-progress LinkedIn outreach drafting in this same checkout. Left alone deliberately again this session; check with Rodney before touching it.
7. Upstream `donatso/family-chart` issue #108 (Cypress vulnerability heads-up) is open on their repo, not ours -- nothing to do here, just noting it exists in case it comes up.

---

## Suggested starting point

Issue #11 (the login/invite/review-workflow redesign) is the natural next pickup -- it's the one remaining open issue that everything else (#13, and arguably how far #9's contribution features can go) is blocked behind, and it explicitly needs a dedicated design conversation with Rodney before any code, not a straight implementation session.

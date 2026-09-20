# family-chart Session Handoff Baton

2026-09-20 -- Layout fixes, request-access flow, repo public-launch session

**Branch:** master

**Last commits this session:**
- 12fc724 Merge pull request #20 from rodlunt/fix/no-real-names-in-repo
- 530dc8d fix: move real names out of the public repo entirely
- f430328 Merge pull request #19 from rodlunt/chore/repo-setup-public-standard-v2
- f1805fb fix(ci): pin pnpm version via packageManager field
- 5d6caa7 chore: bring the repo up to public-repo standard
- 43f7a7d Merge pull request #18 from rodlunt/chore/rename-to-tree-research
- 1fed3c2 chore: rename app from "Lunt Family Tree" to "Tree Research"
- cfd3dd3 Merge pull request #17 from rodlunt/feat/request-access

(Earlier in the same session, not shown above: PR #15/#16, the full design pass and the
collateral-branch/multi-spouse layout fixes -- see "What shipped" below.)

---

## What shipped this session

- **Missing connector lines fixed.** People placed near a real relative via the
  floating/collateral-branch layout (Vivienne, Pauline, Noel to Bernard and Laurel Jean; Aunty
  Sally to Nanna Pat) now actually get a line drawn to that relative -- previously the position
  was right but the line was silently missing for anyone anchored by a *confirmed* relationship
  (only unconfirmed ones got a line before).
- **Multi-spouse centering fixed.** A person with two spouses (Ken Dowman) now renders centred
  between them instead of one spouse being pushed to the edge, so children's lines read
  unambiguously (Tony Dowman's line no longer looks like it passes through Aunty Sally).
- **"Reset view" button added.** Clicking into someone while in full-tree mode could silently
  half-update with no way back to a working view. This button unconditionally returns to a
  fitted view of everyone, regardless of how far main_id has drifted from clicking around.
- **Public `/request-access` page shipped.** Carved out of Caddy's basic_auth (Caddyfile change
  lives in the smart-home repo). Submitting emails Rodney via Resend with a reply-to of the
  requester -- he still creates and sends logins by hand. Own rate limit and input validation
  since it's the one public unauthenticated write surface. Caught and fixed a same-session
  regression where the first version also intercepted the actual login challenge, not just a
  cancelled one.
- **App renamed** "Lunt Family Tree" -> "Tree Research" (not everyone invited will carry the
  Lunt surname).
- **Repo brought to public-repo standard.** Full git-history audit came back clean (no genealogy
  data or secrets ever committed). Added a real README, issue/PR templates, CONTRIBUTING.md,
  SECURITY.md, Dependabot, build-only CI, repo description/topics.
- **Real names removed from source entirely.** `AUTH_USER_PERSON_IDS` used to hardcode real
  family members' names in `server/index.js`; moved to `AUTH_USER_PERSON_IDS_JSON`, a runtime
  env var in opti's gitignored `.env` (same pattern as `RESEND_API_KEY`).
- Live data: 48 people, Janyta added, Vivienne's birthdate added, one stray auto-generated
  placeholder record found and cleaned up (unrelated to any of the above -- root cause never
  identified, Rodney reviewed the full list and confirmed nothing looked missing).

---

## Open follow-ups

1. **Issue #22 -- full-tree view can silently vanish**, when focusing a person (e.g. Geoff)
   whose only connection to the rest of the tree is an unconfirmed relationship. Confirmed via
   direct testing that the underlying data and the anchor-finding logic are both correct, but
   the rest of the tree still doesn't appear -- root cause not found, needs actual
   instrumentation inside `calculate-tree.ts`, not more black-box testing. "Reset view" recovers
   from it in the meantime.
2. **Issue #21 -- dependency vulnerability sweep**, 11 open Dependabot alerts, all traced to
   `cypress` as a devDependency (systeminformation, extract-zip, and deeper transitives). Two
   ways to close it out: bump Cypress, or remove it entirely since it isn't wired into CI and
   only tests upstream's unchanged demo pages.
3. **Issue #11 -- full passwordless magic-link login system + review workflow.** The
   `/request-access` page shipped this session is explicitly the simple interim step toward
   this, not a replacement for it.
4. Issues #5 (photo upload), #8 (modal-based editing), #9 (notes/attachments), #10 (per-person
   timeline), #12 (real database), #13 (admin panel) -- all filed, none started, all deliberately
   deferred as bigger design decisions.
5. **Uncommitted `.gitignore` change on disk right now** (adds `/outreach/`) that isn't from
   this session's work -- looks like it's from a concurrent Claude session on the same machine
   drafting Rodney's LinkedIn outreach message in this same shared checkout. Left alone
   deliberately; check with Rodney or that other session before touching it.

---

## Suggested starting point

Issue #22 (the vanishing-tree bug) is the most valuable next pickup -- it's a real, reproducible
defect with a workaround already shipped, but the root cause needs someone to actually
instrument `calculate-tree.ts`'s `placeUnconnected` rather than keep testing from the outside.

# family-chart Session Handoff Baton

2026-09-20 -- Engineering grill + issue #25 shipped session

**Branch:** feat/issue-25-contribute-form

**Last commits this session:**
- 7020370 feat(contribute): add "something to contribute" form for logged-in users
- 2a0f74e chore(session-end): update handoff baton for 2026-09-20 session (previous session)

---

## What shipped this session

- **Full build-order and design plan for the remaining backlog (#10, #11, #12, #13, #25).** Ran the `engineering-grill` skill against the live rules pack (17 domains, 11 triaged as active-now, 88 questions derived). Six irreversible-tier decisions confirmed with Rodney and a concrete implementation approach worked out for every issue. The full plan (context, confirmed decisions, repo grounding, per-issue approach, flagged assumptions, verification steps) is saved at `~/.claude/plans/imperative-wobbling-puppy.md` -- read that before starting #11, it has real detail this baton only summarises.
- **Build order settled: #25 -> #11 (incl. minimal roles + #13's admin screen) -> #12 -> #10's data model, then #10's UI either side of #12.** This is a change from the previous baton's assumption that #11/#13/#10/#12 all wait on a single big #11 redesign -- #25 was pulled forward since it doesn't need #11 at all, and #12 was pulled closer to #11 (not deferred to "after #10 settles") because #11 introduces a concurrent-write risk on the flat JSON file that only #12 actually closes.
- **Issue #25 shipped this session** ("something to contribute" form). New `datum.data.notes_entries` (JSON-encoded array, replacing the old single-string `notes` field), reusing the existing `/api/upload` endpoint, with a credited/anonymous choice. Anonymity is enforced (a real field respected everywhere, never a display-only toggle) not just described, and identity is never rendered in the UI for an anonymous entry to any of the four current logins (there's no admin/viewer role yet -- that's #11). A pre-existing legacy note is preserved read-only, not auto-migrated. Reviewed via `/code-review`: fixed a silent-misattribution bug (submission now refused, not silently unattributed, if the login can't be resolved to a person id) and tightened the anonymity hint copy. Tested end-to-end in a real browser against local fixture data (credited, anonymous, file-attachment, legacy-note-preservation, and the misattribution-guard paths), verified against the raw saved JSON each time, not just the screen. **PR open, not yet merged:** https://github.com/rodlunt/family-chart/pull/28
- **Real decision locked in for #11: the unconfirmed Geoff/Bernard/Allan half-sibling branch (involving Andy and Tomas Lunt, two of Rodney's actual paying work customers) needs its own restricted-visibility scope, not the current "every login sees everything" default, before #11 widens who can log in.** This has to be built into #11's role/visibility model from day one (a `visibility_scope` concept separate from admin/contributor role), not retrofitted -- see the plan file for the concrete mechanism (a one-time, reviewable data migration tagging the affected people/edge into a restricted scope).
- **Fixed a `gh` CLI trap the hard way.** `gh repo set-default` was stuck pointing at the upstream `donatso/family-chart` instead of the fork. Caught it first on read commands (`gh issue list`/`gh pr list` were silently returning upstream's issues), fixed the default, then hit the same trap again on a *mutating* command: `gh pr create` opened a real, live PR against `donatso/family-chart` before the fix carried over to write commands too. Closed that erroneous PR immediately with an apology comment, `gh repo set-default rodlunt/family-chart` is now set correctly for this checkout, and PR #28 (the correct one) is up.

---

## Open follow-ups

1. **Issue #11 -- roles, magic-link login, review workflow.** Now has a concrete plan (see `~/.claude/plans/imperative-wobbling-puppy.md`), but five things need a quick sign-off from Rodney before coding starts: (a) does Caddy still gate access once the app has its own login, or does it become a plain reverse proxy; (b) reshape `/api/tree` onto resource routes as part of #11, or keep the blob contract longer; (c) Postgres+pgvector vs an embedded vector-capable store for #12 -- not yet decided; (d) #13's first cut: admin-reset only, defer self-service reset, or build both; (e) the exact proposal state list (`pending/approved/rejected/withdrawn/superseded`) is Claude's design, not Rodney's -- wants a read-through before coding.
2. **Issue #13 -- admin panel.** No longer a separate phase -- lands inside/right after #11 as the UI over #11's new user/role table. See flagged assumption (d) above.
3. **Issue #10 -- per-person timeline.** Data model designed (event shape, approximate-date handling) but not built. Needs to be locked in before #12's schema is cut. Also: the orphan-on-delete fix (never cascade-delete a person's notes/events/contributions -- decision made this session) needs implementing in the *current* flat-file delete/merge code path independent of #10's UI, since the ghost-record incident (see previous baton, issue history) shows this is live risk today, not a future one. Not started.
4. **Issue #12 -- move off the flat JSON file to a real database.** Sequencing changed this session: now follows #11 closely (not deferred), because #11 introduces a concurrent-write risk on the flat file that Rodney accepted as an interim risk specifically on the condition that #12 closes it soon after, not later. Database choice (Postgres+pgvector vs an embedded option) still open -- see (c) above. Needs a verified dry-run migration with a field-by-field diff check, and a tested backup/restore procedure (Restic can't validly restore a live database) as a go-live gate, not a fast-follow.
5. **Issue #25 PR #28 is open, not merged.** Test plan includes one unchecked item: a manual smoke test against the real tree.lunt.au data before merge.
6. **Uncommitted `.gitignore` change on disk right now** (adds `/outreach/`), still present, still not from any issue work in this or the previous session -- it's Rodney's own in-progress LinkedIn outreach drafting in this same checkout. Left alone deliberately again this session; check with Rodney before touching it.
7. Upstream `donatso/family-chart` issue #108 (Cypress vulnerability heads-up, filed last session) is open on their repo, not ours -- nothing to do here.
8. 79 of the 88 engineering-grill questions were derived but never asked (offered for a deep-dive round, declined in favour of moving to the plan) -- not judged unimportant, just not put. Worth a look if #11 turns up a design question this baton doesn't cover; the full derived set isn't saved anywhere outside this session's transcript, so a fresh grill run would be needed to get them back.

---

## Suggested starting point

Merge PR #28 (#25) once the real-data smoke test is done, then start #11 -- but resolve the five flagged assumptions in follow-up #1 with Rodney first (they're quick, mostly one-line calls, not a full design pass) since the plan in `~/.claude/plans/imperative-wobbling-puppy.md` is otherwise ready to implement against.

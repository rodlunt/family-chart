# Family Chart

A self-hosted family tree app: a D3.js chart library plus a small Node server, so a family can
add and edit their own tree together over the web, no accounts service or database required.
Forked from [donatso/family-chart](https://github.com/donatso/family-chart) (MIT licensed) and
extended for real, multi-contributor, ongoing genealogy work.

## TL;DR

Clone it, `pnpm install && pnpm build`, run `node server/index.js`, open the browser. Data is a
flat JSON file on disk. Put a reverse proxy with HTTP basic auth in front of it if more than one
person needs write access, that's how the live deployment works.

## Quickstart

```bash
git clone https://github.com/rodlunt/family-chart.git
cd family-chart
pnpm install
pnpm build                 # compiles the library (dist/family-chart.js + dist/styles/family-chart.css)
node server/index.js       # serves server/public/ and a tiny /api/tree JSON API
```

Open `http://localhost:3000`. The first run seeds one placeholder person; click their card to
start building the tree. Data persists to `./data/tree.json` by default (override with the
`DATA_FILE` env var) - back that file up like you would any other data you care about.

### Docker

```bash
docker compose up -d --build
```

Builds the library in a throwaway stage and ships only the runtime server + built assets. Tree
data lives on the `family_chart_data` named volume, so it survives an image rebuild.

### Optional: the request-access form

`/request-access` is a public form (name, email, note) for someone to ask the tree's owner for a
login, without needing one themselves. It emails the owner via [Resend](https://resend.com) when
submitted. To enable it, copy `.env.example` to `.env` and set `RESEND_API_KEY` (and optionally
`MAIL_FROM`/`MAIL_TO`). Without it, the form fails with a clear error instead of silently
pretending to send.

## What's different from upstream

This fork is built around one real use case: several relatives editing one shared, growing tree
over time, where some people are only tentatively connected. On top of the original chart
library, it adds:

- **A persistent, shared server** (`server/index.js`) - upstream is a client-side library only; a
  live, multi-person tree needs somewhere to save to.
- **Floating/unconnected people render as visible cards**, not silently disappear, based on true
  graph reachability rather than only what's visible from the currently-focused person. Useful
  for "I think this person is related, but I'm not sure how yet."
- **Unconfirmed relationships**: a relationship can be marked "suspected, not confirmed" and
  renders as a dashed line in a distinct accent colour, everywhere that meaning applies (the link
  itself, a floating candidate's border, the relationship checklist in the edit panel).
- **Collateral-branch auto-layout**: a person's siblings, cousins, etc. who aren't on the direct
  ancestor/descendant line still get placed sensibly near their real relatives, with collision
  avoidance, and multi-spouse families render with the shared parent centred between spouses
  rather than pushed to one side.
- **Print and standalone HTML export** - a full-tree print view, and a one-file, self-contained
  HTML export (no server, no network calls) for sharing with someone non-technical.
- **A public request-access flow** (above) so someone without a login can ask for one.

## Development

```bash
pnpm dev      # vite dev server for the example pages under examples/
pnpm build    # compile the library (what the server actually serves)
pnpm docs     # generate API docs with typedoc
```

Only `pnpm` is used here.

An end-to-end Cypress suite lives under `cypress/e2e/`, inherited from upstream and covering the
example pages (`pnpm test` to open it interactively, `pnpm test-run` headless) - it needs the
Cypress binary installed (`pnpm exec cypress install`) and the `pnpm dev` server running first.
It isn't currently wired into CI (see `.github/workflows/ci.yml`'s comment for why).

## Documentation

- [Installation & quickstart](docs/installation-and-quickstart.md)
- [Data format](docs/data-format.md)
- Upstream's own docs and interactive examples: [donatso.github.io/family-chart-doc](https://donatso.github.io/family-chart-doc/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE.txt](LICENSE.txt). Original work Copyright (c) 2026 donatso
([donatso/family-chart](https://github.com/donatso/family-chart)).

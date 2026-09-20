# Contributing

Thanks for taking a look. This is a small, personal fork with light traffic, so the process here
is deliberately simple.

## Where things go

- **Bug**: open a [bug report](https://github.com/rodlunt/family-chart/issues/new/choose).
- **Feature idea**: open a [feature request](https://github.com/rodlunt/family-chart/issues/new/choose),
  or start a thread in [Discussions](https://github.com/rodlunt/family-chart/discussions) if it's
  not yet concrete.
- **Security issue**: never as a public issue. Use
  [private security advisories](https://github.com/rodlunt/family-chart/security/advisories/new),
  or email the address in [SECURITY.md](SECURITY.md).
- **Question**: [Discussions Q&A](https://github.com/rodlunt/family-chart/discussions/categories/q-a).

## Dev setup

```bash
git clone https://github.com/rodlunt/family-chart.git
cd family-chart
pnpm install
pnpm build
node server/index.js
```

Only `pnpm` is used in this repo (no `npm`/`yarn`, despite the leftover `yarn.lock`).

Before opening a PR, make sure `pnpm build` succeeds locally, that's the one thing CI actually
checks right now.

## Pull requests

- Branch from `master`, one focused change per PR.
- [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`,
  `chore:`, ...) - CI and the changelog both read these.
- Reference the issue you're closing (`Closes #123`) if there is one.
- Describe what you changed and how you checked it, the PR template has the shape.
- Never include real personal data in a commit, PR description, or test fixture. Use
  clearly-fake sample data for anything family-tree-shaped.

## Code style

No enforced formatter yet - match the surrounding code's style. Comments explain *why*, not
*what*; the code itself should make the "what" obvious.

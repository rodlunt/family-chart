# Security

If you find a security problem in this code (the library, the server, or the deployment setup
in this repo), please don't open a public issue.

Use GitHub's [private security advisories](https://github.com/rodlunt/family-chart/security/advisories/new)
for this repo, or email **rod@lunt.au** if you'd rather not use GitHub.

Include what you found, how to reproduce it, and its likely impact if you can. This is a small,
personally-run project - expect a reply, not a bug bounty program.

## Scope

This covers the code in this repository: the chart library, the self-hosted server
(`server/index.js`), and the request-access flow. It doesn't cover the specific live deployment
at tree.lunt.au (its actual data is private and never in this repo) beyond what the code itself
does.

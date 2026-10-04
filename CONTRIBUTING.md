# Contributing

Start with the setup in [README.md](README.md). Use your own Convex deployment and Clerk instance; development does not require access to bento.cat's production accounts.

For bugs, open an issue with the steps to reproduce, expected behavior, actual behavior, and browser or Bun version. Remove personal data and credentials from logs and screenshots. Report security issues privately using [SECURITY.md](SECURITY.md).

For larger changes, open an issue to discuss the approach first. Keep pull requests focused, explain the behavior change, and include screenshots for visual changes. Follow the existing code style and [AGENTS.md](AGENTS.md).

Before submitting:

```sh
bun install --frozen-lockfile
bun run check
```

Add or update tests when changing backend rules, authentication, privacy, or save behavior. Tests use mock services; do not point them at production.

Commit `bun.lock` when changing dependencies and keep the generated Convex API files in sync with backend changes. Keep real environment files, account exports, private keys, and local logs out of Git. CI runs Vite+ lint checks, tests, and the build, and scans Git history for secrets.

By submitting a contribution, you agree that your source code contribution is licensed under the repository's AGPL-3.0-only license. Third-party assets must include their source, author, and applicable license.

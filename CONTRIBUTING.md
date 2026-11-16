# Contributing

## Dependency policy: minimum release age

A **new** dependency version must be at least **14 days old** before pnpm resolves it
(supply-chain hardening: freshly published, compromised releases are usually caught within days).

- Enforced in `pnpm-workspace.yaml`: `minimumReleaseAge: 20160` (minutes = 14 days; pnpm >= 10.16).
  `minimumReleaseAgeExclude` lists only `@jini-ai/*` (our own packages).
- Versions already in `pnpm-lock.yaml` are unaffected; `pnpm install --frozen-lockfile` installs the lockfile as-is.
- Adding or bumping a too-young version fails with a "no matching version ... minimumReleaseAge" error.
  Pick the newest release older than 14 days (`pnpm view <pkg> time --json`) and pin it.
- Do not add third-party packages to the exclude list except for an audited security fix, and say so in the commit message.

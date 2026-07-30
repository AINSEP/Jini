# `@jini-ai/registry`

Three interchangeable backends for a content registry — the thing that answers "give me version
`^2.1.0` of the entry named `acme/theme`" — plus the semver specifier parsing and version resolution
they share, and real cryptographic signature verification against a GitHub Actions OIDC trust root.
The wire types (`RegistryEntry`, `RegistryManifest`, `RegistryBackend`, …) live in
`@jini-ai/protocol`; this package only adds the concrete backend logic, mirroring how
`@jini-ai/sqlite` implements ports that `@jini-ai/protocol` defines.

## Install

```sh
npm install @jini-ai/registry

# only if you use DatabaseRegistryBackend  (native compiled addon)
npm install better-sqlite3
```

`better-sqlite3` is an **optional peer dependency**: `database-backend.ts` needs only its *type*, and
the caller owns and opens the real handle. `StaticRegistryBackend`, `GithubRegistryBackend`, and the
resolution/trust helpers need nothing extra, so most adopters never pay the native-compile cost.
`@jini-ai/protocol` is a regular dependency.

## What you get

**Three backends**, all implementing `@jini-ai/protocol`'s `RegistryBackend`:
- `StaticRegistryBackend` / `StaticRegistryBackendOptions` — serves an in-memory
  `RegistryManifest` you hand it. The zero-infrastructure option; also the one to reach for in tests.
- `GithubRegistryBackend` / `GithubRegistryBackendOptions` — reads (and, via
  `GithubPublishMutation`, writes) a manifest stored in a GitHub repository through an injected
  `GithubRegistryClient`. `GithubApiRegistryClient` / `GithubApiRegistryClientOptions` is the real
  HTTP implementation of that client interface.
- `DatabaseRegistryBackend` / `DatabaseRegistryBackendOptions` — SQL-backed, over a database handle
  you supply. `ensureRegistryTables(db)` creates the schema; `upsertRegistryEntry(db, entry)` writes
  a single entry.

**Version resolution** — `parseRegistrySpecifier('acme/theme@^2.1.0')` → `ParsedRegistrySpecifier`
(`{ name, range? }`), and `resolveRegistryEntryVersion` → `ResolvedRegistryEntryVersion`.

**Signature trust** — `verifyRegistryEntrySignatures` and `verifyRegistrySignature` returning a
`SignatureVerificationResult` (never thrown, always returned), plus
`canonicalRegistrySigningPayload` (the exact `name@version:digest` string a signature must cover),
`RegistryTrustRoot` / `GithubOidcTrustRoot`, and `GITHUB_ACTIONS_OIDC_ISSUER`. Verification is
**opt-in and additive**: omit `trustRoot` and a backend reports `verified: false` for every entry
without attempting anything, which is the pre-existing default. Configure it — at minimum
`githubOidc.caCertificates` — and `entry.signatures[]` gets real cryptographic checking, with
`allowedIdentities` matched against the certificate's own `subjectAltName` URIs rather than a
self-reported field.

## Usage

```ts
import {
  StaticRegistryBackend,
  DatabaseRegistryBackend,
  ensureRegistryTables,
  parseRegistrySpecifier,
} from '@jini-ai/registry';
import type { RegistryManifest } from '@jini-ai/protocol';
import { readFileSync } from 'node:fs';

const manifest: RegistryManifest = loadManifestSomehow(); // see RegistryManifestSchema

const registry = new StaticRegistryBackend({
  id: 'builtin',
  kind: 'local',
  trust: 'official', // 'official' | 'trusted' | 'restricted'
  manifest,
  // Opt in to real signature verification; omit entirely for the verified:false default.
  trustRoot: {
    githubOidc: {
      caCertificates: [readFileSync('/etc/example/fulcio-root.pem', 'utf8')],
      allowedIdentities: [/^https:\/\/github\.com\/acme\/themes\/\.github\/workflows\//],
    },
  },
});

const { name, range } = parseRegistrySpecifier('acme/theme@^2.1.0');
const resolved = await registry.resolve(name, range); // ResolvedRegistryEntry | null

// Or the SQL-backed variant, over a handle you own.
import Database from 'better-sqlite3';
const db = new Database('/var/lib/example/registry.sqlite');
ensureRegistryTables(db);
const dbRegistry = new DatabaseRegistryBackend({ id: 'local', trust: 'restricted', db });
```

`RegistryBackend`'s full surface is `list` / `search` / `resolve` / `manifest` / `doctor`, plus
optional `publish` / `yank`. Check `RegistryManifestSchema` in `@jini-ai/protocol` for the manifest
shape before building one by hand.

## What's swappable

`RegistryBackend` (defined in `@jini-ai/protocol`, alongside `RegistryBackendFactory`) is the port,
and these three are just the implementations that ship — a fourth reading an S3 bucket or an internal
service plugs in with no consumer change. Inside `GithubRegistryBackend`, `GithubRegistryClient` is
itself an injected interface, so the GitHub API calls are replaceable (or fakeable) without touching
the backend logic. `DatabaseRegistryBackend` takes an already-open handle rather than a path, so
connection lifetime and `:memory:` testing are yours. `RegistryTrustRoot` selects the verification
policy. Fixed: the specifier grammar, the semver resolution rules, and
`canonicalRegistrySigningPayload`'s byte layout — a signature is only meaningful if every party
canonicalizes identically.

## Runtime

`jini.runtime: "node"` — `node:crypto` for signature verification, and `better-sqlite3` types for
the SQL backend.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.

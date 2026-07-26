# Unlocked package admission manifest

Every `packages/*` directory NOT in `foundry/docs/jini-port/extraction-plan.md` §3's locked 14-package
set must have an entry here. This is the package-admission manifest the 2026-07-19 swarm-consensus
architecture debate recommended (`ADS-memory/reports/swarm-consensus/runs/2026-07-19T1632-consensus-report.md`)
after finding 9 packages had been added ad hoc, without the Coordinator/Software-Architect
sign-off `AGENTS.md` says is required, and at least 2 (`capability-providers`, `metatool`)
admitting zero consumers in their own `source-map.md` files.

**Enforcement:** every `packages/*/package.json` carries canonical `jini` domain/kind/runtime/
admission metadata. `scripts/check-engine-boundaries.ts` reconciles `jini.admission` with the
fenced JSON below and rejects dependencies from locked/admitted packages into incubating ones.
This admission field is architectural governance, not a claim about API maturity. Sign-off is
still `PENDING` for every entry; see the "Promotion" section below for what changes that.

## Manifest

```json
{
  "@jini/artifacts": {
    "status": "incubating",
    "consumers": [],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "Not ad hoc sprawl like the other 9 entries here — moved OUT of @jini/daemon's kernel token set on 2026-07-19 to fix a locked-rule violation (ArtifactStoreToken sat alongside genuine kernel tokens). Zero consumers confirmed before the move. Listed here because it is, structurally, an unlocked package like the rest: not in extraction-plan.md §3's 14, needs the same named-consumer promotion path."
  },
  "@jini/deploy": {
    "status": "incubating",
    "consumers": [],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "DeployTarget many-token port + Vercel/Cloudflare Pages adapters. Named only in extraction-plan.md §10's roadmap-appendix prose (Netlify/Vercel/GitHub Pages wishlist), not §3's locked set."
  },
  "@jini/registry": {
    "status": "incubating",
    "consumers": [],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "Pluggable static/GitHub/database registry backends. Not named anywhere in extraction-plan.md."
  },
  "@jini/memory": {
    "status": "incubating",
    "consumers": ["examples/reference-web (workspace composition root; not promotion-qualified)"],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "Frontmatter note-store + extraction-attempt log + self-verify scorecard enforcer. Not named anywhere in extraction-plan.md."
  },
  "@jini/media": {
    "status": "incubating",
    "consumers": ["examples/reference-web (workspace composition root; not promotion-qualified)"],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "Multi-provider image/video/audio generation gateway substrate. Not named anywhere in extraction-plan.md."
  },
  "@jini/capability-providers": {
    "status": "incubating",
    "consumers": [],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "Greenfield, no OD source. Own source-map.md states: 'This package currently has NO identified consumer.' Named aspirational future consumers (Zana, Tovu-Runner) per foundry/docs/jini-port/recon/r5b-consumers-matrix.md, but neither is confirmed today. Highest-priority candidate for archival if not promoted soon."
  },
  "@jini/desktop-host": {
    "status": "incubating",
    "consumers": [],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "extraction-plan.md §3 explicitly deferred this 'until a 2nd host exists'; built ahead of that deferral by explicit human decision on 2026-07-17. No second host consumer confirmed today."
  },
  "@jini/diagnostics": {
    "status": "incubating",
    "consumers": [],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "Not named anywhere in extraction-plan.md; not even listed in AGENTS.md's own package inventory (stale by 3 packages per the 2026-07-19 debate's Round 3 finding)."
  },
  "@jini/mcp": {
    "status": "incubating",
    "consumers": [],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "Not named anywhere in extraction-plan.md; not even listed in AGENTS.md's own package inventory."
  },
  "@jini/agui": {
    "status": "incubating",
    "consumers": ["examples/reference-web (workspace composition root; not promotion-qualified)"],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "Added 2026-07-19, before this manifest existed — fell through the admission process entirely rather than being deliberately deferred like the other 10 entries here. Not named anywhere in extraction-plan.md §3's locked set or its own §10 roadmap appendix. Backfilled 2026-07-22 to close the gap; needs the same named-consumer promotion path as every other incubating package."
  },
  "@jini/composio": {
    "status": "incubating",
    "consumers": [],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "Concrete Composio catalog, OAuth, connected-account, and tool-execution adapter ported under the approved ADS-memory/reports/composio-port-plan-2026-07-23.md. No HTTP/UI wiring or external packed-tarball consumer yet."
  }
}
```

## Promotion requirements (per the 2026-07-19 debate's convergence)

An entry graduates from `"incubating"` to `"stable"` only when ALL of the following are true,
matching the same two-consumer-rule discipline `extraction-plan.md` §7 already applies to new
kernel tokens/protocol event families (this manifest exists because that rule was never extended
to whole new *packages* — see the debate report's Divergence/Agreement sections):

1. At least one real, named consumer (an actual external repo, not an aspirational one) depends
   on the package via a packed tarball, not a workspace link.
2. An API snapshot review has been done and recorded.
3. The package passes through `examples/minimal-host`'s packed-release-slice test
   (`scripts/health-boot.ts`) without requiring product-shaped concepts.
4. Coordinator + Software-Architect sign-off is recorded in this file (`signOff` field updated
   from `PENDING` to a date + reviewer).

Until then, each entry's `"status": "incubating"` and the matching package admission metadata are
enforced by `scripts/check-engine-boundaries.ts`: locked/admitted packages may not import any
incubating package. `lockedPackagesMayImport: false` records that same policy for human and tooling
consumers of this manifest; it is not a separate override switch.

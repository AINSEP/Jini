# Unlocked package admission manifest (historical — no longer enforced)

**Removed 2026-07-28, at the user's explicit direction ("get rid of that locked 14 thing").** This
file used to be a live, enforced gate: `scripts/check-engine-boundaries.ts`'s R7 rule rejected any
import from a "locked" package into an "incubating" one, and every `packages/*/package.json`
carried a `jini.admission` field that had to agree with the manifest below. Both the rule and the
`admission` field are gone — see `packages/README.md` and `check-engine-boundaries.ts`'s own header
comment for where that's now documented. Nothing reads this file anymore; the JSON below is kept
only as a record of what was flagged and why, in case that reasoning is useful later.

Originally: every `packages/*` directory NOT in `ADS-memory/reports/jini-port/extraction-plan.md` §3's
locked 14-package set needed an entry here. This was the package-admission manifest the 2026-07-19
swarm-consensus architecture debate recommended (`ADS-memory/reports/swarm-consensus/runs/2026-07-19T1632-consensus-report.md`)
after finding 9 packages had been added ad hoc, without the Coordinator/Software-Architect
sign-off `AGENTS.md` says is required, and at least 2 (`capability-providers`, `metatool`)
admitting zero consumers in their own `source-map.md` files.

## Manifest (historical snapshot, not enforced)

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
    "note": "Greenfield, no OD source. Own source-map.md states: 'This package currently has NO identified consumer.' Named aspirational future consumers (Zana, Tovu-Runner) per ADS-memory/reports/jini-port/recon/r5b-consumers-matrix.md, but neither is confirmed today. Highest-priority candidate for archival if not promoted soon."
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
  "@jini/composio": {
    "status": "incubating",
    "consumers": [],
    "lockedPackagesMayImport": false,
    "signOff": "PENDING",
    "note": "Concrete Composio catalog, OAuth, connected-account, and tool-execution adapter ported under the approved ADS-memory/reports/composio-port-plan-2026-07-23.md. No HTTP/UI wiring or external packed-tarball consumer yet."
  },
  "@jini/agentic": {
    "status": "stable",
    "consumers": ["@jini/chat-core (locked)", "@jini/chat-react (locked)", "examples/reference-web (workspace composition root; not promotion-qualified)"],
    "lockedPackagesMayImport": true,
    "signOff": "2026-07-26 — admitted at creation, Coordinator (agentic-extraction dispatch)",
    "note": "Extracted 2026-07-26 out of @jini/chat-core's src/agentic/* (minus chat-capabilities.ts, which stayed) and @jini/chat-react's dom-page-driver.ts, per ADS-memory/reports/proposals/PLAN-jini-agentic-extraction-2026-07-26.md §6. Admitted directly to 'stable' rather than entering as 'incubating' and going through the normal 4-requirement promotion gate (named external consumer, API snapshot, minimal-host slice test, sign-off) — because that gate's premise (new, unproven surface) doesn't hold here: this is a relocation of code that was already inside a locked package with 615+393 tests passing against it. Entering as 'incubating' would have actively broken the extraction, since incubating packages cannot be imported by locked ones and chat-core/chat-react (both locked) are its first two consumers by construction. The normal 4 promotion requirements remain unmet (no external packed-tarball consumer yet) and should still be satisfied before this note is treated as a closed loop — flagged here rather than silently treated as equivalent to a package that actually cleared the gate."
  }
}
```

## Removed entries

- **`@jini/agui`** — removed 2026-07-26. Not dropped: folded into `@jini/agentic` (already
  `"stable"` above) per `ADS-memory/reports/proposals/PLAN-jini-agentic-extraction-2026-07-26.md`
  §3a/§4a. Its `"incubating"` status (never promoted; added 2026-07-19, backfilled 2026-07-22)
  became moot the moment the package itself stopped existing — folding incubating code into an
  admitted package promotes it, since there is no longer a standalone unit for the four normal
  promotion requirements to apply to. See `packages/agentic/source-map.md`'s "Folded from
  `@jini/agui`" section for the full reasoning, and `packages/agui/source-map.md` in git history
  (commit `7773af01e` and earlier) for the package's own provenance, preserved rather than
  re-derived.

## Promotion requirements (historical — per the 2026-07-19 debate's convergence, no longer enforced)

An entry used to graduate from `"incubating"` to `"stable"` only when ALL of the following were
true, matching the same two-consumer-rule discipline `extraction-plan.md` §7 already applies to new
kernel tokens/protocol event families:

1. At least one real, named consumer (an actual external repo, not an aspirational one) depends
   on the package via a packed tarball, not a workspace link.
2. An API snapshot review has been done and recorded.
3. The package passes through `examples/minimal-host`'s packed-release-slice test
   (`scripts/health-boot.ts`) without requiring product-shaped concepts.
4. Coordinator + Software-Architect sign-off is recorded in this file (`signOff` field updated
   from `PENDING` to a date + reviewer).

None of this is enforced anymore — see the top of this file. `scripts/health-boot.ts` (item 3) is
still worth having on its own merits (proving `@jini/*` actually installs from real tarballs), and
is being built independent of this now-removed gate.

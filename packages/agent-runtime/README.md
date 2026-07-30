# `@jini-ai/agent-runtime`

Runtime-side content and execution code for agent-driven artifact
generation: brand-agnostic craft knowledge and portable skill packages
(both product-neutral per root `AGENTS.md`) plus a real TypeScript runtime
surface — the `runtimes/` -> agent-runtime adapter registry/detection/
launch/stream-parser port and the `agent-protocol/` ACP + pi-rpc subprocess
transport (see `src/index.ts`'s own header comment and `source-map.md`'s
"Barrel merge" section for the full inventory), plus `src/model-registry.ts`
below. This top-level blurb has historically lagged that TS surface's
growth — treat `src/index.ts` and `source-map.md` as the source of truth
for what's actually implemented.

## `src/model-registry.ts`

The provider/model/agent-picker vocabulary (`ModelProvider`,
`ModelCatalogOption` — exported as `ModelOption` is already taken by
`agent-protocol/acp/models.ts`'s narrower ACP-probe shape —,
`AgentDefinition`, `AgentDiagnostic`, `CredentialStatus`, ...) and a handful
of pure helpers (credential-status resolution, model-list merging, a stable
model-catalogue cache key, model-choice normalization against a live
catalogue) for any consumer building a "pick a model/agent" UI — e.g.
`@jini-ai/chat-react`'s `features/model-picker/` slice. Distinct from
`src/registry.ts` (the static `BASE_AGENT_DEFS` CLI-adapter catalog). See
`source-map.md` for full provenance.

## `src/craft/`

Universal UI-craft rulebooks (typography, color, motion, accessibility,
forms, RTL, anti-AI-slop, …) that a skill can opt into via a
`craft.requires` front-matter array. See `src/craft/README.md` for the
full mechanism and `source-map.md` for provenance.

## `src/skills/`

160 portable Skill packages ported from OD's 162-skill catalog (2 excluded
as OD-internal — see `source-map.md`), each a `SKILL.md` + optional
`assets/`/`scripts/`/`references/`. Frontmatter uses the same flat
`craft.requires`/`design_system.requires`/`mode`/etc. key convention as
`src/craft/`, not OD's original nested `od:` block. No TypeScript lives
inside `src/skills/` itself — this directory is content only; the
package's TypeScript runtime surface lives at `src/`'s top level, see
above.

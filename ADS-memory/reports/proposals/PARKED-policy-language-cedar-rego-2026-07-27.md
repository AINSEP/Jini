# PARKED — a policy language (Cedar / Rego) behind `ToolPolicy`

**Status:** parked 2026-07-27, deliberately not adopted. **Revisit trigger:** a consumer needs
operator-editable, per-tenant tool authorization that cannot be a code change.

## What was considered

Replacing or supplementing `ToolPolicy` (`packages/core/src/tool-registry.ts:67-86`) — currently a
TypeScript interface with one method returning `'allow' | 'deny'` — with a declarative policy
language, as Microsoft's Agent Governance Toolkit does (YAML, OPA Rego, and Cedar).

## Why not now

1. **Two authorization mechanisms is the failure mode we already have evidence for.** Cedar cannot
   express a policy needing a live lookup, so adopting it means keeping the TS interface too. That
   is a second model beside the primary one — precisely what Payload paid for twice and then
   deleted (commit `5effd37122`, 7,500 deletions, three days before that repo's HEAD; see
   `/Users/la/Programming/OSS-Repos/AI-Capabilities/payload.md` §10.13).
2. **A WASM policy runtime in a kernel with near-zero dependencies**, plus a context-mapping layer,
   policy distribution/versioning, and a second language to debug.
3. **Microsoft's own docs don't recommend it by default.** Their tutorial positions YAML as covering
   most use cases and OPA/Cedar as being for organizations with existing investment in them —
   `/Users/la/Programming/OSS-Repos/agent-governance-toolkit/docs/tutorials/08-opa-rego-cedar-policies.md:15`.

## What we do instead — the part that was actually load-bearing

The weakness is the **decision contract**, not the implementation language. An unconditional allow
is equally invisible whether written in TypeScript, Rego, or Cedar, unless the system records
*which* policy decided and *why*. So the cheap change, with no dependency:

```ts
// instead of: AuthorizationDecision = 'allow' | 'deny'
interface AuthorizationResult {
  effect: 'allow' | 'deny';
  reasonCode: string;
  policyId: string;
  policyVersion: string;
  obligations?: readonly string[];   // e.g. 'require-confirmation', 'redact-output'
}
```

plus, at registration time: mandatory policy provenance, risk validation, and a host-level veto
policy that no per-tool policy can override.

This is a breaking change to `@jini/core` and every registration site, so it is its own task.

## If the trigger fires

Prefer **Cedar** over Rego for this shape: it is designed for principal/action/resource
authorization, is analyzable by construction (you can ask "who can run X?" of a policy set), ships
a Rust core with WASM bindings, and needs no sidecar. Rego wins only if a consumer already operates
OPA bundles.

**Replace the TS interface — do not run both.** The whole argument above collapses if Cedar lands
*beside* `ToolPolicy` rather than under it.

## Provenance

Raised during the 2026-07-27 capability-corpus review. Second opinion from `gpt-5.6-sol` (high
reasoning) reached the same conclusion independently and supplied the decision-contract shape.
Corpus context: `/Users/la/Programming/OSS-Repos/AI-Capabilities/`.

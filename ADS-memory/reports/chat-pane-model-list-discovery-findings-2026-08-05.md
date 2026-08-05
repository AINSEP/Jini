# Bug 2 rediscovery: why the Local CLI model list can't call a live Anthropic endpoint today

**Date:** 2026-08-05
**Agent:** Programmer
**Status:** STOPPED before implementing, per Coordinator's correction #1 — reporting evidence for a
user decision, not shipping a workaround.

## What changed from the original brief

Original brief: "if hardcoded, replace the strings with these current model IDs." Correction #1:
that's wrong — the list must come from a real backend discovery call (agent-runtime probing which
Claude models are actually available), with any hardcoded array demoted to a last-resort fallback,
never the primary path. My already-committed change (`9525b794`, adding `claude-opus-5`/
`claude-sonnet-5` to `CLAUDE_FALLBACK_MODELS`) still stands as reasonable *fallback content*, but it
does not satisfy this requirement and I'm not treating it as done.

## 1. Who owns the list — confirmed

- `packages/agent-runtime/src/detection.ts:54-93` — the generic per-def dispatcher every agent
  goes through. For each def it prefers `def.fetchModels(resolvedBin, env)` (custom async probe) or
  `def.listModels` (`{args, parse}` — spawn the CLI itself and parse its stdout), and falls back to
  `def.fallbackModels` only when the live attempt returns nothing or throws.
- `packages/agent-runtime/src/defs/claude.ts:85-92` — the `claude` def's current `fetchModels` is
  `loadMmdRouteModels(env, CLAUDE_FALLBACK_MODELS)`, which does exactly one thing: check for a
  local `~/.config/mms/model-routes.json` file (a self-hosted-proxy routing config) and return its
  route ids merged with the static array if that file exists. If the file doesn't exist (the
  common case — confirmed not present at `~/.config/mms/model-routes.json` on this machine), it
  returns `null`, and `detection.ts` falls straight to the static `fallbackModels`. **There is no
  code path today that calls Anthropic's `/v1/models` or any other live API for this def.**

## 2. Credential reachability — the crux, checked directly, none found

| Candidate | Finding |
|---|---|
| Claude Code CLI's own login | `claude auth status` on this machine: `{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "max"}` — this is a claude.ai/Max **subscription OAuth session**, not an Anthropic Developer API key. It authenticates the CLI's own usage; there is no subcommand or documented mechanism in this codebase (or in `claude --help`, checked directly) that exposes this session as a bearer token another process could attach to a raw `GET /v1/models` call. Also confirmed independently via `claude --help`: **no models-list subcommand exists** — the only model-related flags are `--model <model>` (set one) and `--fallback-model`. This corroborates (not merely trusts) the file's own comment "`claude` has no list-models subcommand." |
| `ant auth login` profile | No `ant` binary on PATH (`command -v ant` → nothing), no `~/.anthropic`, no `~/.config/anthropic` directory, and no reference to "ant auth" anywhere in either repo's source or docs. This surface does not exist in this environment. |
| BYOK credential | Real, and already does call the provider's live API for its own model list (per the original brief's own note) — but it's a separate mode/toggle (`executionMode: 'api'`), a separate stored credential (`hasStoredAdminKey`, encrypted server-side, per `AssistantDock.tsx:620-628`), and explicitly flagged out of scope for this bug. The Local CLI path (`executionMode: 'local'`) does not carry this credential. |
| `ANTHROPIC_API_KEY` env var | Not set in this shell. Not present in Tovu's `.env` or `.env.example`. Referenced in `packages/daemon/src/agent-executor.ts:535-539` only as `credentialEnv` — a value the **host must explicitly delegate per run**; the doc comment there is explicit: "Never read implicitly from `process.env` — see SEC-001." So even if an operator set this var on the daemon's host process, the daemon is designed not to pick it up implicitly for a spawned CLI run, by design (SEC-001 hardening against a prompt-influenced subprocess inheriting ambient secrets). |

**Conclusion: no credential reachable from the Local CLI path can call a live Anthropic models
endpoint today.** This matches the prior session finding that Tovu's Local CLI path launches agent
CLIs discovered on PATH with no API key ([[project_tovu_chat_uses_agent_clis]] in this project's
memory) — that finding still holds and this investigation reconfirms it independently rather than
trusting it blind.

## 3. Is `client.models.list()` viable? Not from this path, and not without a new dependency either

Even setting the credential question aside: `@anthropic-ai/sdk` is not a dependency anywhere in
Jini or Tovu today (checked `package.json` in `packages/agent-runtime` and repo roots). Adding it
would require `pnpm install`, which is on the explicit do-not-run list for this session (other live
sessions depend on the current `node_modules`). A raw `fetch()` to `https://api.anthropic.com/v1/models`
would sidestep the missing dependency, but still needs a credential from row 1 of the table above,
which doesn't exist on this path.

## 4. How the other agents in the picker actually get live model lists

Confirmed the pattern is uniform and doesn't need a held credential at all: every other CLI-backed
def (`codex.ts:71-75` is the clearest example — `listModels: { args: ['debug', 'models'], parse:
parseCodexDebugModels }`) asks the **already-installed, already-authenticated CLI itself** to
report its own model catalog, by spawning it with a subcommand and parsing stdout. The CLI holds
its own auth; agent-runtime never touches a credential for this. `claude` is the outlier precisely
because its CLI has no equivalent subcommand — confirmed directly above, not inferred from the
comment. So "wire the same live-discovery pattern used by Codex/OpenCode" isn't available for
Claude Code today; it would require Anthropic's own CLI to ship one.

## Recommendation (not implemented — needs the user's call)

This is a design decision, not a code question:
- **(a)** Leave Claude Code's model list on the static fallback array (freshened, as already
  committed) until Anthropic's CLI ships a models-enumeration subcommand — i.e., accept that
  `claude` behaves like every OTHER static-fallback-only def already in this registry (several
  defs have no `listModels`/custom `fetchModels` at all and rely solely on `fallbackModels`), rather
  than being uniquely singled out for a mechanism nothing else in the registry has either; **or**
- **(b)** Explicitly wire a credential into this specific path — e.g., extend the BYOK-style
  stored-credential mechanism so the Local CLI picker can optionally call the live endpoint when
  (and only when) the operator has supplied their own Anthropic API key for that purpose, with a
  static-array fallback when they haven't. This is a real feature (new credential surface + new
  dependency + a decision about when it fires), not a bug fix, and needs explicit product sign-off
  before I build it.

I have not touched any code for this since the correction landed. Bug 1 remains committed and
unaffected (`9525b794`, already verified end to end).

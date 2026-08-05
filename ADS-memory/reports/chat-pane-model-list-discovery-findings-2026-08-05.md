# Bug 2 rediscovery: why the Local CLI model list can't call a live Anthropic endpoint today

**Date:** 2026-08-05
**Agent:** Programmer
**Status:** STOPPED before implementing, per Coordinator's correction #1 — reporting evidence for a
user decision, not shipping a workaround.

**Update (same day, second pass):** Coordinator pushed back that section 1 below didn't trace
*why* `loadMmdRouteModels` returns nothing, and asked for that as the first question — because a
discovery path that exists and returns empty could itself be the bug. Traced it (new section "0."
below): it isn't a bug. `loadMmdRouteModels` was never a live-Anthropic-API call to begin with — it
reads one specific local, opt-in config file for an unrelated feature (self-hosted proxy routing),
and that file has never existed on this machine. Also re-verified the "no list-models subcommand"
claim against an exact file:line (it exists, just past the range initially checked) and checked one
more candidate mechanism (ACP JSON-RPC) the Coordinator's own examples pointed at. Conclusion is
unchanged: no viable discovery seam, no reachable credential. Still stopped, not implementing.

## 0. Why `loadMmdRouteModels` returns nothing for Claude here — traced, not assumed

`packages/agent-runtime/src/mmd-routes.ts` (full file read): `loadMmdRouteModels(env, fallbackModels)`
at line 127 calls `resolveMmdRoutesFile(env)` (line 44) — which checks the `MMD_MODEL_ROUTES_FILE`
env var first (unset here: confirmed `echo "$MMD_MODEL_ROUTES_FILE"` is empty), then falls back to
`~/.config/mms/model-routes.json` (`DEFAULT_MMD_MODEL_ROUTES_FILE`, line 16). It then does
`readFile(routesFile, 'utf8')` in a `try`; **any** error there (line 135-139) — not just
ENOENT — returns `null` and `fetchModels` in `claude.ts` treats that as "nothing live," falling to
`CLAUDE_FALLBACK_MODELS`.

Checked directly: `~/.config/mms/` does not exist on this machine at all (`ls` → No such file or
directory), and a depth-3 search of `$HOME` for `model-routes.json` finds nothing anywhere. So the
concrete answer to "unconfigured env, empty route set, swallowed error, or doesn't cover Claude at
all" is: **unconfigured env** — the file the function looks for has never been created. This is the
default state for every host that hasn't opted into this feature; it is not an error being
swallowed silently in the "something went wrong" sense.

**More importantly — even configured, this mechanism doesn't do what's being asked for.** Reading
the rest of the module: `resolveMmdRouteLaunchEnv` (line 71) and the module's own doc comment (line
1-9) describe its actual purpose — mapping a synthetic model id to an alternate
`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` pair, i.e. **pointing the `claude` CLI at a self-hosted
or third-party proxy endpoint per model.** It has no code path that calls Anthropic's real
`api.anthropic.com` on the user's own account to ask "which models can I use." Populating this file
would surface whatever a *proxy operator* chose to expose as route ids — not a live answer to "what
does my Claude subscription/API access actually support." So this isn't "the primary discovery
path, currently broken" — it's a different feature entirely that happens to share the same
fallback-array argument. Repairing or configuring it would not deliver what the user asked for.

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
| Claude Code CLI's own login | `claude auth status` on this machine: `{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "max"}` — this is a claude.ai/Max **subscription OAuth session**, not an Anthropic Developer API key. It authenticates the CLI's own usage; there is no subcommand or documented mechanism in this codebase (or in `claude --help`, checked directly) that exposes this session as a bearer token another process could attach to a raw `GET /v1/models` call. Also confirmed independently via `claude --help` / `claude -p --help`: **no models-list subcommand and no ACP/JSON-RPC flag exist** — the only model-related flags are `--model <model>` (set one) and `--fallback-model`. This corroborates — quoted exactly, `packages/agent-runtime/src/defs/claude.ts:88`: `// \`claude\` has no list-models subcommand. Prefer local mmd/MMS routes` — a claim that's true, not merely present. (It sits outside the `25-75` range checked the first time; verifying with `grep -n` rather than re-reading the same slice found it immediately.) |
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

Two mechanisms exist in this registry, both of them the **spawned CLI answering for itself** —
neither needs agent-runtime to hold a credential:

- **Plain-stdout probe (`listModels`).** `codex.ts:71-75` — `listModels: { args: ['debug',
  'models'], parse: parseCodexDebugModels }`. `detection.ts` execs the CLI with those args and
  parses stdout.
- **ACP JSON-RPC probe (`detectAcpModels`, via `acp-model-probe.ts`).** Used by 8 defs — devin,
  hermes, kilo, kimi, kiro, reasonix, trae-cli, vibe (`shared.ts`) — which speak a `session/new` →
  `session/list_models` handshake over the spawned process's stdio.

Checked whether either applies to `claude`: it doesn't call `detectAcpModels` anywhere in
`claude.ts`, and I re-verified rather than assumed — `claude -p --help` has no ACP/protocol/
JSON-RPC flag of any kind, matching the earlier `--help` check that found no models-list
subcommand either. `claude` is the one def in this registry where *neither* live mechanism the
Coordinator's own examples point at is available on the CLI side — confirmed against the installed
binary, not inferred from a comment. So "wire the same live-discovery pattern used by
Codex/hermes/kilo/etc." isn't available for Claude Code today; it would require Anthropic's own CLI
to ship a models-list subcommand or ACP support.

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

---
name: browser-live-analysis
version: 1.0.0
last_updated: 2026-04-06
description: Reproduce live website behavior in a real browser session using a host-configured browser automation provider, capture evidence, and verify fixes without pretending static code inspection is enough.
---

# Skill: Browser Live Analysis

Use this skill when a bug, regression, or acceptance criterion depends on what the browser actually renders or does at runtime.

Current provider boundary:

- AI Dev Shop capability name: `browser_automation`
- Current provider mapping: Playwright MCP
- Ownership split: the client installs the MCP server; the repo detects and uses the capability when present

Do not hardwire routing or user-facing language to Playwright alone. Treat Playwright as the current provider for `browser_automation`, not the permanent architecture.

## When To Use

- a UI bug only appears in the running app
- browser console or network behavior may explain the issue
- DOM, layout, hydration, navigation, auth redirect, or client-side state needs direct observation
- a fix should be verified against the rendered site instead of only unit or E2E output

## Preflight

1. Resolve the current host.
2. Verify MCP surface support:

```bash
bash harness-engineering/validators/probe_host_capabilities.sh --host <detected-host> --capability mcp_surface
```

3. If `mcp_surface` is not `enabled`, stop there and report that browser automation cannot be verified on this host.

4. Verify browser automation:

```bash
bash harness-engineering/validators/probe_host_capabilities.sh --host <detected-host> --capability browser_automation
```

5. Interpret the result exactly:
   - `enabled`: use the browser provider
   - `unavailable`: say the current host does not have the provider configured
   - `unverified`: say the repo cannot prove browser automation here

If `browser_automation` is not `enabled`, do not bluff. Fall back to code inspection, tests, logs, or manual reproduction instructions.

## Workflow

1. Start the target app using the project's normal local run command.
2. Open the target URL in the browser automation provider.
3. Reproduce the issue or critical path deliberately.
4. Capture only the evidence needed for the active failure cluster:
   - console errors or warnings
   - failed requests or suspicious network responses
   - DOM or text state that proves the bug
   - screenshot, trace, or HTML snapshot when the visual state matters
5. Convert the evidence into a narrow fix hypothesis before editing code.
6. Apply the fix in the owner agent's normal implementation loop.
7. Re-run the same browser path to verify the fix against the rendered app.
8. Keep large raw captures in local offloads instead of pasting them into the active context.

## Evidence Expectations

Prefer compact evidence summaries:

- route visited
- user action taken
- observed failure
- concrete browser evidence
- hypothesis implied by that evidence
- post-fix verification result

## Guardrails

- Do not claim browser evidence when `browser_automation` is not proven locally.
- Do not replace certified tests with browser poking; this skill supplements tests, it does not waive them.
- Do not save large screenshots, traces, or raw DOM dumps inline when an offload file will do.
- Do not force Playwright-specific assumptions into repo architecture docs; keep the capability/provider split intact.

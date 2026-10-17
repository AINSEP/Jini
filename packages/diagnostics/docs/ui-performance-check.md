# On-demand UI performance check

Run only on an explicitly requested local/staging session with disposable synthetic data. Default workload: **500 messages, 50 keys, three measured runs; every keystroke ≤50 ms** from input to next paint. This is a lab check, not field INP.

1. Import `CHROME_DEVTOOLS_MCP_PRESET` from `@jini-ai/mcp`; call `planAgentInstall({ slug, spec: CHROME_DEVTOOLS_MCP_PRESET, ctx: { home, platform, serverName: 'chrome-devtools' } }, {})`. Apply the returned CLI/JSON/manual plan using the agent's existing capabilities. The preset pins `chrome-devtools-mcp@1.10.1`, `--no-usage-statistics` and `--no-performance-crux`.
2. Verify the connected tool schemas; open/select the authorized target page and record its `pageId`. Keep the browser, build, hardware, viewport and throttle settings fixed across runs.
3. Seed a disposable chat harness through its real renderer: `import { createLongTranscriptFixture } from '@jini-ai/chat/testing'`; pass `createLongTranscriptFixture({ turns: 250, toolRowsPerTurn: 15 }, {})` as `ChatPane.initialMessages` with `toolCallDisplay="show"`. Turns are user/assistant pairs; this produces 500 messages and 3,750 finished tool rows. Warm up once before measuring.
4. Focus the composer, then call `performance_start_trace({ pageId, reload: false, autoStop: false, filePath: '<local trace path>' })` so the prepared transcript survives.
5. Send N=50 separate printable `press_key({ pageId, key: 'a' })` calls, waiting for a paint between inputs; record intended count and confirm the draft grew by 50 characters. Alternatively send one character per `type_text` call after checking its schema. Use trusted keyboard input; value assignment, bulk fill and `dispatchEvent` are not typing evidence. Do not submit the draft.
6. Always call `performance_stop_trace({ pageId })` in cleanup, including after an input error. Use returned insight-set IDs and insight names with `performance_analyze_insight({ pageId, insightSetId, insightName })`.
7. Inspect raw trace interaction/presentation events when insights do not expose every key's latency; correlate input delay, script work, style/layout and next paint without double-counting overlapping work. Insight summaries alone cannot establish the typing budget.
8. Collect `list_console_messages({ pageId, pageSize: 50 })` and `list_network_requests({ pageId, pageSize: 50 })`; note pagination/truncation and inspect relevant failures via their returned IDs.
9. Reset the draft and repeat steps 4–8 for three identical measured runs. Record each trace path, input/observed counts, timing source, max, p95 and number over 50 ms, plus console/network failures and suspected bottlenecks.
10. Remove the disposable fixture and draft; retain requested traces locally with synthetic content. Traces can contain page content and URLs; never capture production or attach secrets.

A pass requires all 50 keys in each of three runs to have complete input-to-paint evidence ≤50 ms. A measured key above budget fails; report the offending run/key and trace evidence.
Report **inconclusive** when inputs are missing/untrusted/coalesced, timing or next-paint evidence is unavailable, trace samples are dropped, setup differs, or a run is interrupted. Missing insight sets also limit attribution; do not invent an insight ID or equate no insight with a pass. Rounded timings that straddle 50 ms require raw trace resolution.

This recipe adds no automatic capture, scheduler or CI timing gate. Tovu launch integration remains pending an existing launch hook.

Sources: [pinned launch/privacy reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/chrome-devtools-mcp-v1.10.1/README.md), [pinned tool schemas](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/chrome-devtools-mcp-v1.10.1/docs/tool-reference.md).

## Native page evidence sample

The web-evidence port also accepts the explicit `collectPerformance: true` option. Tovu exposes it
on `site_collect_page_evidence({ paths: ["/"], collectPerformance: true })`. Ordinary evidence calls
do not evaluate the performance script. It uses the existing origin/egress checks, browser factory,
15-second page budget and 60-second whole-call budget, and closes the same ephemeral contexts.

The numeric report includes approximate Chromium heap counters (or null when unavailable), up to
100,000 DOM nodes with an explicit truncation flag, mounted hidden/collapsed panels, hidden pre
counts/text-character totals, iframe count, and up to 200 buffered long tasks plus a 100ms sample.
Unsupported long-task APIs are explicit. Suspect descriptions report these facts without a score.
No hidden text, heap objects, DOM attributes or iframe documents are returned by this sample.

This sample describes a fresh anonymous page. It cannot diagnose the user's existing signed-in
admin tab or restored chat; `/admin` may instead render a sign-in screen. That requires an explicit
host connection to the selected browser tab and remains a separate integration decision. The
DevTools recipe above retains its role for the actual open tab, traces and typing evidence.

# web-evidence

Bounded, same-origin rendered-page evidence collection (`collect-page-evidence.ts`) over an injected
browser port, plus the agent-tool catalog for `site_collect_page_evidence` (`agent-tools.ts`).

## Wiring

- `agent-tools.ts` — the host indexes `siteEvidenceAgentToolCatalog` and passes it as `catalog` to
  `buildDomainRegistrations` (`@jini-ai/core`), with its own handler for `SITE_EVIDENCE_TOOL_ID`.
  No injected fields.
- `collectPageEvidence` — the host supplies `originRegistry`, `openBrowser` and its disclosure
  `observationPolicy`; see `browser-port.ts` for what the evidence shapes may carry.

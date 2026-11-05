# Job om-chat: shared chat fixes for Open Marketing and Tovu
cloud/plans/OMJ-plan-result.md: steps for items 0 (with Tovu site + desktop adoption), 1, 2, 3, 4, 8 only. Items 5, 6, 7 later.
Required invariant on item 0: the CLI's bridge approval never replaces a person's approval card; test that a confirmation-required action runs zero times without a human answer. Bridge-scoped only; no other MCP server changes. Verify the installed Codex accepts the setting, with one real small run if credentials allow; otherwise say UNVERIFIED.
Base: Jini origin/integ/night-1105, Tovu origin/night-1105.

# Trim of P25-key-store-result.md (tovu-f4, 11-04 night). Codex estimate: 7–10 days
PHASE 1, ship first (~3–4 days): API KEYS by reference only.
- one project.db owner store (it already exists)
- a site stores only {credentialId}, with the grant held in the owner DB
- one approval card: "Use this key on this site"
- revoke per site
- the copy-keys card becomes "use a saved key"
- both GitHub readers resolve the same entry
- exports carry NO owner keys (remove "include saved keys")
- localhost uses the same app-data store
PHASE 2, separate go-ahead: shared OAuth connections, plus "disconnect everywhere", the shared refresher and lease (items 7–10).
CUT for now: moving ownership into new Jini packages (@jini-ai/db adapters, @jini-ai/integrations orchestration). Keep it in the existing credential-sets module plus Tovu until a second host needs it. Remote/self-hosted access: out of scope.

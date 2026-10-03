Spec ID: SPEC-JINI-DIAGNOSTICS-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:7e74c0cc1d0e8f87128ef5a0d2a5b27fe302909567544ee21825b4de402061b5
spec_mode: reverse_spec


# Diagnostics lifecycle contract

## Archives and source reads

Each export owns a fresh archive from the required factory. Sources and summary files are assembled in memory, then `generate({})` returns a Buffer. The package writes no bundle to disk. Node tail reads own and close only their temporary file descriptor; full reads use the filesystem adapter. No source cache, retained archive or durable export ledger exists.

## Request trackers

Each enabled/hook tracker transitions `tracking -> ended` on its first end call. The ended flag is set before span/logger/metrics callbacks; failed completion is terminal for that tracker. No retry queue or persisted metrics state exists. No-op requests share one frozen tracker with no requestId. Exporter/provider lifecycle is host-owned; the package offers no flush or shutdown operation.

## Browser sessions

`openPlaywrightSiteEvidenceBrowser` yields unavailable data or an owned browser capability. Direct consumers must call `browser.close({})`. `collectPageEvidence` closes an available browser in finally, including when observation fails. Every observe call creates its own context and closes it in finally; cookies and storage do not carry across pages or calls. No HAR, recording, user-data directory or saved state is configured.

Requests accumulate up to the cap during one observation; consent changes that observation's phase from before to after. Context close discards browser state. The collector retains only returned pages/skips in memory; consumers own any later persistence and retention. A failed context creation has no context to clean up; a close failure can reject the entire collection.

DNS helpers retain no lookup cache or configuration singleton. Their dependencies and saved-host lookup remain host-owned.

---
"@jini-ai/cms": patch
---

The admin recovery status and restore-ceremony routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/recovery/{status,restore}`). Status reads only its own small deps (cost-class probe, site status, the operation-lock peek and the banner precedence, all injected); the restore plan/confirm/execute specs own the body checks, the AUD-001 instance-scoped pre-authorization and the ceremony error → status table, while the host injects each orchestrator step and the gateway pre-check. Wire bodies and statuses are unchanged.

---
"@jini-ai/cms": patch
---

The admin external-MCP routes list, put, delete, admissions, tool-approvals (list + revoke) and OAuth disconnect ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/external-mcp/{list,put,delete,admissions,tool-approvals,oauth-disconnect}`). Each reads only its own small deps type; the host injects its stores, roster fan-out, built-in ownership rules and error classes (as predicates). Wire bodies and statuses are unchanged.

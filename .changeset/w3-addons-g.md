---
"@jini-ai/user-management": patch
"@jini-ai/agentic": patch
---

User management: add `mail/status/*` — the mail status, provider and delivery agent-tool catalogs, the Email page permission ids with their grant registrar, and `mailDomainDepsFrom` (binds those ids to a host's activity/suppression deps; an absent collaborator now stays absent). Agentic: add `skills/site/live-registration` (live skill slots on the core tool registry and the skill-refresh request middleware).

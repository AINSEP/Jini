---
"@jini-ai/provider-plugins": patch
---

Provider factories accept a neutral host `attribution` input (`attributes`, `groups`, `tags`; the host names the keys): OTel adds the attributes to every span's resource (`service.name` stays the host's), PostHog adds them to every event's properties (not overridable by the event) plus `$groups`, Langfuse adds them to trace metadata and appends the tags.

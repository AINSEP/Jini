---
"@jini-ai/agent-plugins": minor
"@jini-ai/core": minor
---

Separate guidance offers from delivery recording. The automatic agent-plugin controller gains `offer`, which drafts full and catalog-only guidance for one live attempt without recording delivery, and `commit`, which records only the offered plugin ids the host actually delivered after rechecking enablement and the host's live-attempt fence. A same-choice replay returns the cached result without publishing again; a changed replay is refused. `@jini-ai/core` adds the `AgentPluginGuidanceAttempt` and `AgentPluginGuidanceOffer` contract types. One-shot `prepare` output and recording are unchanged.

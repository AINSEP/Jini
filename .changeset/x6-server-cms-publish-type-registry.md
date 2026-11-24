---
"@jini-ai/cms": minor
---

Add the publish-content planner, export-bundle builder, apply-run state and repo-backed handler factory as package entries, generic over the host's publish-port bag. The planner and export-bundle take the host-bound registry's catalog builder as a required `catalog` field instead of importing a process-wide registry.

---
"@jini-ai/admin": patch
---

`PostAuthorFields` and `PostPublishAtField` label their controls with the `jini-field-label` class (was the host's bare `field-label`), following the `jini-*` class rule for engine-rendered markup. Hosts that styled the post labels through `.field-label` extend that styling to `.jini-post-publishing__field > .jini-field-label`.

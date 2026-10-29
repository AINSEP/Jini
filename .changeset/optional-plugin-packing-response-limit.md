---
"@jini-ai/agent-plugins": minor
"@jini-ai/platform": minor
"@jini-ai/cms": minor
---

Add opt-in plugin source suffix exclusions and test-file inclusion. Explicit allow-paths and their ancestors now override name exclusions, while excluded descendants and suffix exclusions still skip. Default packing stays unchanged when the new options and conflicting allow/name rules are absent.

Export ResponseLimitExceededError with limitBytes from platform/fetch-with-timeout and the platform root. Guarded response-text overflow throws this RangeError subclass; invalid caps keep plain RangeError and existing truncation behavior is preserved.

Accept jsdom 26 and 27 as optional CMS peers alongside 25; media uses DOM APIs shared across these versions.

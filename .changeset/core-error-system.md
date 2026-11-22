---
"@jini-ai/core": patch
---

New `@jini-ai/core/errors/*` entries (no index file): `sentences` (`defineErrorSentences`, `CORE_ERROR_SENTENCES`, `interpolateSentence`), `bindings` (`defineErrorScope`), `catalog` (`createErrorCatalog`: scoped class-to-code lookup that also produces today's model-facing rules, caller-safe rules and log-describer vocabulary), `reporter` (`createErrorReporter`: one incident path with one error ID, one host record and one tracker report; `record` takes `tracker: 'skip'`), `disclosure` and `approved-cause` (who may read what about an incident; `approveCause` is the only way an error's own text reaches a caller), `idioms` (`observed`, `afterSettled`, `orFallback`, `orFallbackSync`, `bestEffort`, `absentWhen`) and `testing` (recording fakes). Nothing existing changes behaviour.

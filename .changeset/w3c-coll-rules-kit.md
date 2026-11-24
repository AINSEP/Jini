---
"@jini-ai/admin": patch
---

Collections rules: `CollectionsHostKit` gains required `embedMarkerSnippet` and `nextDraftRowId` (built with the new `createDraftRowIdCounter`); `collectionEmbedSnippet`/`emptyField`/`draftFieldsFromContentType`/`addDraftField` take the kit and are bound by `bindCollectionsRules`.

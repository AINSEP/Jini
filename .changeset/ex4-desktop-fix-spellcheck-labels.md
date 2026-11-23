---
"@jini-ai/desktop-host": patch
---

`./shell/spellcheck-menu`: `buildSpellCheckMenuTemplate` and `registerSpellCheckContextMenu` take the host's menu wording as `labels` on their required objects; the module authors no copy.

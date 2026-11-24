---
"@jini-ai/admin": patch
---

Skills screen: host design-system classes (page, card, notice, buttons, dialog, plugin-row look) now arrive through a required `classNames` prop (`SkillsScreenClassNames`, `SkillRowClassNames`, `SkillDialogClassNames`) on `Skills`, `SkillRow`, `SkillRemoveConfirmDialog` and `SkillInstallConfirmation`; the package emits only `jini-*` classes itself.

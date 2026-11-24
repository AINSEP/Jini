---
"@jini-ai/core": patch
"@jini-ai/admin": patch
---

Move the admin Skills screen (page, row, remove and install confirmation dialogs, its translator and dialog-focus hooks) into `@jini-ai/admin/screens/skills`; the host injects its data, locale and theme hooks, shared install/file components and failure bindings. Add the `InstalledSkill` wire type at `@jini-ai/core/contracts/site/installed-skill`.

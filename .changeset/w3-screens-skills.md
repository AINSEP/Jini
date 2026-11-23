---
"@jini-ai/admin": patch
---

Add the first Skills screen modules: `@jini-ai/admin/screens/skills/skills-i18n` (the Skills translator, with shared words falling back to `ADMIN_COMMON_I18N`), `screens/skills/SkillInstallConfirmation.hooks` (`createSkillInstallConfirmationTranslator`), `screens/skills/Skills.hooks` (`useSkillsTranslator`), `screens/skills/skill-upload` (`prepareSkillUpload`, the base64 encoding shared by the picker and chat drops) and `screens/skills/api/skills-api.types` (`InstalledSkill`, `SkillInstallPayload`). None of them take injected props; the host keeps its HTTP client, error redaction options and stylesheets. Also `@jini-ai/admin/screens/skills/skill-drop` (`captureSkillDrop`, the bounded browser folder walk behind chat skill drops; the host passes `proposeFiles`, `fallback` and `onError` in the call) and `screens/skills/use-skills-tabs.hooks` (`useSkillsTabs`, the URL-backed `?tab=skills|add` tabs over the Jini router; no injected props).

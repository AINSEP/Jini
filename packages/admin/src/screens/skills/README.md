# screens/skills

Leaves of the host admin's Skills screen that carry no host transport: the page and
install-confirmation copy, the row chevron, the upload encoder and the failure formatter. The
screen itself (`Skills.tsx`), its row and remove/install dialogs, its translator and its dialog-focus
hooks live here too; the data hooks over the host's skills transport stay in the host.

## Wiring

- `skill-failure.ts` — `skillFailure` takes the host's transport error class (`ApiError`, read only
  for a body `errorId`), its `describeApiError`, and its product `redactionOptions` as required
  fields. In the reference host they are bound once in `apps/admin/src/features/skills/skill-failure-host.ts`.
- `skill-upload.ts` — returns `SkillInstallPayload` from `@jini-ai/core/contracts/site/skill-install`,
  the same type the host's install transport sends.
- `skills-i18n.ts` (+ `skills-page-dictionary.ts`) — falls back to `ADMIN_COMMON_I18N`; nothing injected.
- `skills-visuals.tsx` — draws through the injected kit `Icon`; class `jini-agent-plugin-chevron-glyph`.
- `Skills.tsx` — every collaborator is a required prop: `hooks` (`SkillsScreenHooks`: the host's
  `useSkills` controller, `useLocale`, `useAdminThemeBoundary`, `useSkillsTranslator` (this
  package's `Skills.hooks.ts`), `useSkillFilesModal`, and `useSkillInstallConfirmation`),
  `components` (`SkillsScreenComponents`: the host's `PlainTextBlocks`, `PackageFilesModal` and the
  install-tab `InstallTabCard`/`InstallTabOption`/`InstallTabFieldRow`) and `failureHost`
  (`SkillFailureHost`). Hooks are called as `hooks.useX(...)`, never imported. The reference host binds
  them in `apps/admin/src/features/skills/SkillsPage.tsx` (lazy-loaded from `panel-pages.ts`), which
  also loads `@jini-ai/ui/settings-dialog.css` and the host's `skills.css`.
- `SkillInstallConfirmation.tsx` — takes `hooks.useSkillInstallConfirmation` (this package's
  `use-skill-confirmation.hooks.ts`) and `failureHost` as required props; the reference host spreads
  `SKILL_INSTALL_CONFIRMATION_HOST` (`features/skills/skill-install-confirmation-host.ts`) from the
  Skills page and the chat dock (`components/AssistantDock/DockChatPane.tsx`).
- `SkillRow.tsx` — takes the host's `PlainTextBlocks` as a required prop. `SkillRemoveConfirmDialog.tsx`
  reads a `SkillsScreenController`; nothing injected.
- `skills-screen.types.ts` — view shapes (`SkillRowView`, `SkillsScreenController`, `SkillInstallView`)
  over `InstalledSkill` from `@jini-ai/core/contracts/site/installed-skill`, the type the host's
  transport returns.
- Classes: this screen's own classes are `jini-skills-*` (styled by the host's `skills.css`). Every
  shared host design-system class (page, section, card, notice, buttons, dialog, jini-plugin-row look) arrives
  through a REQUIRED `classNames` prop typed `SkillsScreenClassNames` (`skills-screen.types.ts`); `Skills`
  passes it to `SkillRow` (`SkillRowClassNames`) and both dialogs (`SkillDialogClassNames`). Nothing
  host-named is hard-coded here. The reference host binds the map once as `SKILLS_HOST_CLASSNAMES` in
  `apps/admin/src/features/skills/skill-install-confirmation-host.ts` (also carried by
  `SKILL_INSTALL_CONFIRMATION_HOST` into the chat dock).

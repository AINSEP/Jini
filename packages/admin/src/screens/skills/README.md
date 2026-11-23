# screens/skills

Leaves of the host admin's Skills screen that carry no host transport: the page and
install-confirmation copy, the row chevron, the upload encoder and the failure formatter. The
screen, its rows/dialogs and its data hooks still live in the host.

## Wiring

- `skill-failure.ts` — `skillFailure` takes the host's transport error class (`ApiError`, read only
  for a body `errorId`), its `describeApiError`, and its product `redactionOptions` as required
  fields. In the reference host they are bound once in `apps/admin/src/features/skills/skill-failure-host.ts`.
- `skill-upload.ts` — returns `SkillInstallPayload` from `@jini-ai/core/contracts/site/skill-install`,
  the same type the host's install transport sends.
- `skills-i18n.ts` (+ `skills-page-dictionary.ts`) — falls back to `ADMIN_COMMON_I18N`; nothing injected.
- `skills-visuals.tsx` — draws through the injected kit `Icon`; class `jini-agent-plugin-chevron-glyph`.

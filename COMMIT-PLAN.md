# admin ext-a Jini working-tree handoff

No commits, tests, builds, installs, typechecks, or linters run (dispatch instruction). `.git` remains unchanged. HEAD: 056d7f360 (matches Jini `origin/integ/w3-ext-a-2026-11-25`). Tovu source ref: `origin/integ/w3-ext-a-2026-11-25` = `codex/w3-ext-a-rev` = 1099eb856382c0d6c24ad380748e1cb021b8a977.

## Planned logical commits

1. J19 characterization first: `packages/chat/src/react/admin-execution/__tests__/ai-agent-presentation.scan-race.unit.test.tsx`.
   - M-older-scan-replaces-auth-state: remove `scan === latestScan` before `onAgents`; older missing-auth scan must not replace the newer ok rescan.
   - M-warn-when-auth-is-unknown: warn for unknown authentication; the unknown-auth assertion must fail.
   - Production/export/changeset work follows the test write.

## Stopped / dependent

- J16 STOP: approved FIX (3) explicitly requires a table naming every injected Deployment/OverviewTab/DockerfileTab prop before dispatch. No table or signatures are supplied. Cannot invent them under the owner no-redesign rule. Sources still match the named functions; no J16 changes made.
- J15 dependent: ProvidersTab requires J16 field helpers, which cannot be delivered while J16 is stopped. No J15 changes made.
- J04-panel, J09, J14, J20 untouched as directed (DOM tsconfig design pending). J10 out of scope.

## API baseline ownership

Generated baseline JSON updates remain Opus-owned. Exact leaf/symbol deltas are recorded below as production work completes.

## Scope cleanup

No existing code/tests deleted or weakened. No unrequested production additions retained.

## Completed logical commit: J19

Test written before production; not executed. Files: chat test above, `packages/chat/src/react/admin-execution/ai-agent-presentation.ts`, `packages/chat/src/react/admin-execution/hooks/use-ai-agent-presentation.hooks.ts`, `packages/chat/package.json`, `.changeset/admin-extraction-19.md`.

Baseline delta against `api-baseline/jini-ai__chat.json`: two new leaves listed in the changeset, with exactly the five listed exports. No generated JSON edit. The pure presentation rules leaf is universal; the React hook leaf is browser. Both are added to the existing chat isolation entry map; typesVersions mirrors exports. Host desktop detection, bridge keys, scope strings, translator and default agent remain injected.

T19 needs the two new subpaths, required `desktop`, `defaultLocalAgentId`, `translate`, and `scopeKeys: { desktopKey, serverKey }`; retain desktop detection locally. No manifest range change.

## Additional stops after source comparison

- J07 STOP (three hooks): G3 says these .ts hooks need no DOM lib because DOM is injected. Actual reviewed source `features/skills/use-skill-install.hooks.ts:17` takes `readonly File[]`; `use-skills.hooks.ts:149-150` stores `HTMLInputElement` refs, `:164-167` reads input event targets (`value`, `files`), and `:184-185` calls `.click()`. Injecting `subscribeChanged` removes window event I/O but does not supply those types. Existing `admin-extraction-07.md` already records the DOM-free hook block. There is no specified DOM-free input/ref/upload contract. Introducing one, importing admin DOM-owned contracts, adding a generic upload parameter, or altering tsconfig would exceed the sheet. No J07 edits/tests/exports added; existing API remains intact. Needed mutations remain M-install-before-confirm and M-allow-superseded-upload-read.
- J12 STOP: `features/posts/hooks/use-post-url-dialog.hooks.ts:2,37` imports/calls `getEmbedUrlFromYoutubeUrl` from `@tiptap/extension-youtube`. CMS's manifest declares no TipTap dependency. The sheet provides only `afterEditorFocus` as the URL hook collaborator, forbids TipTap runtime imports, and forbids unlisted dependencies/helpers/ports. The missing parser seam/dependency needs an explicit design choice; neither a replacement parser nor another injection was invented. No J12 edits/tests/exports added. J11's prerequisite core port is present. Needed mutations remain M-recompute-entry-id-from-new-slug, M-accept-refused-url-scheme, M-refocus-before-dialog-cleanup.

## Review / verification handoff

- J19 production bodies compared with the reviewed Tovu source. Existing why-comments retained; only named seams and package-relative import paths changed. Detection and rescan projection statements and order preserved, including `rescanLocalAgents.call(port)` and conditional property spread.
- Characterization file: 2 new tests; existing tests: unchanged. Mutations recorded but NOT executed. Tests/builds/typechecks/linters/runtime self-validation deliberately not run, per dispatch. Opus owns execution and generated baseline update.
- Static architecture audit: J19 imports only React, core execution contracts, and its relative rules module. No host imports, desktop detection, branded scope strings, default-agent literals in executable code, or server barrels moved. No new abstractions or dependencies. Other assigned sheets stopped/dependent for the reasons above; overall delivery PARTIAL.
- Scope cleanup deletions: removed JSON serializer's incidental Unicode escaping from unchanged manifest strings; no existing production/test code removed. No unlisted helpers, wrappers, types, or files retained.

## Function quality / completion review

| unit | static disposition | review |
| --- | --- | --- |
| localCliScopeCopy | no findings | Two supplied dictionary keys; no desktop detection or effect. |
| selectedAgentWarning | no findings | Same selected-agent lookup and confirmed-missing predicate; translator required. |
| normalizeAgentDescription | no findings | Original absent-description identity and whitespace normalization unchanged. |
| createAgentPresentationPort / project | no findings | Same per-instance generation; latest scan alone publishes; original source receiver retained. |
| useAiAgentPresentation / onAgents | no findings | Same live ref and equality check; host supplies default selection and copy. |

Static skepticism pass: `scan` is the captured request generation, `latestScan` is the current generation, and `live` means mounted. These names and their guards still match the values used. No empirical complexity, typecheck, coverage, mutation, or runtime claims are made. No new resource lifetime, cache, timer, or network request was introduced.

Requirements re-read and changed files reviewed. No certified tests changed. J19 is implemented pending Opus verification; J07/J12/J16 are STOP and J15 is dependent. COMMIT-PLAN.md itself must not be committed.

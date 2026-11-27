# Jini SOL handoff — r62t-rev-p1

Base: `codex/b-p1j`, `010c8cd874f709ffa2c61de0de4e1dde4f808aad`.
All three Jini SOL sheets were implemented in the specified order. Their source anchors matched the pinned tree. No sheets stopped. Changes remain in the working tree; no commits or Git metadata writes were made.

Tests were written before each sheet's production change. Per dispatch, no tests, mutations, builds, installs, type-checks, linters, or runtime validation were run. The mutation proofs below are reasoned, not executed. Cloud validation is required before claiming green.

## Ordered commits for the coordinator

1. **P1-J3.J — focus resource menu items and restore the current trigger on Escape**
   - `packages/ui/src/features/resource-dashboard/__tests__/ResourceCard.test.tsx`
   - `packages/ui/src/features/resource-dashboard/__tests__/ResourceBoard.test.tsx`
   - `packages/ui/src/features/resource-dashboard/react/components/ResourceCardParts.tsx`
   - `packages/ui/src/features/resource-dashboard/react/hooks/useResourceBoard.ts`
   - `.changeset/ui-resource-board-menu-focus.md` (`@jini-ai/ui`: patch)
2. **P1-T1.J — pass an ordinary form PUT's version basis to its definition writer**
   - `packages/cms/src/admin-http/routes/forms/__tests__/update.test.ts`
   - `packages/cms/src/admin-http/routes/forms/update.ts`
   - `.changeset/cms-versioned-form-put.md` (`@jini-ai/cms`: minor)
3. **P1-T4.J — identify the post conflict Load latest button for agents**
   - `packages/admin/src/posts/__tests__/post-editor-notices.test.tsx`
   - `packages/admin/src/posts/editor/notices/PostVersionConflictBanner.tsx`
   - `.changeset/admin-post-conflict-load-latest-handle.md` (`@jini-ai/admin`: patch)

Retain this handoff file with the coordinator's delivery record.

## Named tests and mutation proofs

| Sheet / test | Named mutation | Assertion that would fail |
| --- | --- | --- |
| J3 / `opening by click or keyboard focuses the first enabled item` | `skip-open-focus` | Removing the mount focus leaves the trigger active instead of Rename, for click, Enter and Space. |
| J3 / `opening with no enabled items leaves focus on the trigger` | `focus-disabled-menu-item` | Removing `:not(:disabled)` from the mount selector calls the button focus spy. The test also requires all items disabled and the `aria-haspopup="menu"` trigger to remain `document.activeElement`. The spy makes an attempted disabled focus observable even though native disabled buttons reject focus. |
| J3 / `Escape returns focus to the exact trigger after opening a second card's menu` | `skip-escape-focus-restore` | Without restoration, removal of the focused second menu item leaves focus off the second trigger. The menu must also close. |
| J3 / `outside click keeps focus on the clicked control` | `restore-focus-on-outside-click` | Adding trigger restoration to the outside mousedown calls the trigger spy. The clicked search control must retain final focus and the menu must close. The spy also catches premature restoration that native pointer focus would subsequently override. |
| T1 / `a versioned definition PUT forwards the basis separately from the patch` | `drop-writer-options` | The recorded options must be exactly `{ expectedVersion: 0 }`; the patch must contain only name, fields, notify and provider. |
| T1 / `a versioned PUT with any status key refuses before either write` | `allow-mixed-versioned-status` | Removing the own-status gate produces a write/success instead of the exact flat 400, including invalid and undefined status values. No lookup or write is allowed. |
| T1 / `a versioned PUT with no definition fields refuses before lookup or write` | `versioned-empty-is-legacy-read` | Removing the empty-definition gate reaches the lookup instead of refusing both empty and ignored/unrecognized definition bodies. |
| T1 / `malformed expectedVersion is a 400 without a write` | `coerce-version-string` | Coercing `"1"` permits a definition write instead of the flat 400. Null, negative, fractional and unsafe values also require refusal without reads/writes. |
| T1 / `a stale ordinary PUT uses the injected copy and keeps VERSION_CONFLICT details` | `use-unclassified-conflict-copy` | Falling through to the shared mapper loses `host stale copy`. The assertion pins the full flat 409, code and all four version-detail fields. |
| T1 / `unversioned empty, status-only and mixed requests keep their current behavior` | `require-version-for-all-puts` | Requiring a basis prevents the existing successful reads and writes. The test pins exact one-argument writer calls and definition-before-status order. |
| T4 / `Load latest carries the post conflict agent element, role and label` | `drop-post-load-latest-handle` | Removing the spread loses the three exact agent attributes. Lookup by the translated visible name also protects the existing accessible name. |

Static test declaration inventory (not execution results):

| Test file | Before | After |
| --- | ---: | ---: |
| ResourceCard.test.tsx | 27 | 29 |
| ResourceBoard.test.tsx | 33 | 35 |
| forms/update.test.ts | 6 | 12 |
| post-editor-notices.test.tsx | 4 | 5 |
| Total | 70 | 81 |

## Behavior and boundary review

- Only Escape restores focus: it dismisses the menu without a new pointer destination. Outside mousedown is close-only so the clicked control receives native focus. Focus restoration precedes menu removal. The mount effect has empty dependencies, not busy dependencies. Existing inside-mousedown and trigger-keydown why-comments remain verbatim.
- Form authorization remains before validation and the no-op read, so ignored/empty bodies cannot disclose a definition or its absence. A versioned definition write cannot be paired with a separately committed status update: the own-status check rejects before either write. The writer alone receives the basis; status calls remain one-argument calls. Legacy no-op reads and mixed writes retain their order. The existing whitelist, FormsUpdateInput, defineJsonRoute, write-error.ts and all export/classification entries remain unchanged.
- CAS stays authoritative in the service/repository. This route only parses, rejects unsupported combinations, forwards the basis and classifies a versioned conflict with injected copy; it adds no route pre-read for concurrency.
- The post banner changes only the Load latest agent metadata. Its visible translated label, action, injected conflict message and sibling handles remain intact.
- Reuse: J3 uses native focus and the existing card ref/menu keyboard utility; T1 uses the existing version parser, conflict formatter, refusal helpers and form patch whitelist; T4 uses the existing agentHandle composition.

Architecture audit: **PASS for static scope/boundary review only**. All changed production files are the sheet's named owners; no dependency, export, i18n, schema, wrapper, helper or unrelated source changes were added. Runtime correctness and mechanical metrics remain unverified by instruction.

| Assessed unit | Static disposition | Findings / bounds |
| --- | --- | --- |
| ResourceCardMenuItems | No recorded findings | Existing item scan; specified enabled selector used on mount and arrows; no new subscription. |
| useBoardMenu Escape handler | No recorded findings | Searches only the current card anchor; focuses before close; existing listener cleanup retained. |
| formsUpdateRoute.handle | No recorded findings | Fixed field checks; authorization first; parsed basis remains available to conflict catch. |
| resolveFormUpdateResult | No recorded findings | At most two legacy writes or one read; supplied basis goes only to the definition writer. |
| PostVersionConflictBanner | No recorded findings | Metadata spread only; no additional effect or API. |

Static skepticism pass checked omission versus zero basis, own status versus valid-status-only checks, ignored definition fields, versioned versus unversioned conflict copy, exact writer argument counts, current versus first menu trigger, and native focus overriding outside-mousedown restoration. Variable names retain their existing meanings. No tests or assertions were deleted or weakened; no coverage configuration was changed. ResourceBoard.test.tsx is exactly 500 lines; no file split or size-debt change was introduced.

Scope-pruning deletions: **none**; the final diff contained no out-of-sheet additions to remove. No why-comments were deleted. No production moves were needed.

## Combine and Tovu follow-through

- No new subpaths or exports are needed. Existing `@jini-ai/cms/admin-http/routes/forms/update` and `@jini-ai/admin/posts/editor/notices/PostVersionConflictBanner` remain the integration paths.
- Combine P1-T1.J with P1-T1.T: bind the host writer's second options object and supply required `versionedUpdateMessages.mixedStatus`, `.missingDefinition` and `.stale`. The Tovu sheet owns its HTTP/service-repo witnesses and OpenAPI changes. P1-J1.J supplies the editor refresh and locale work separately.
- Opus combine owns `pnpm api:update` for the widened FormsUpdateDefinitionFn and required injected copy; no API-baseline files were edited here. J3 and T4 need no API-baseline update.
- After consuming rebuilt Jini, P1-T4.T owns its page button and post DOM characterization. Opus combine re-records only the specified version-conflict snapshot and checks its delta is the three agent attributes. No Tovu files or snapshots were edited here.
- Cloud must execute the four changed test files and named mutation checks. No pass/fail count or coverage is claimed; self-validation was not run because dispatch expressly forbids execution here.

OPUS sheets left untouched: P1-J1.J, P1-J2.J, P1-T2.J, P1-T2.T, P1-T3.J, P1-T3.T. Tovu SOL sheets P1-T1.T and P1-T4.T are outside this Jini-only dispatch. No package-extraction work was started.

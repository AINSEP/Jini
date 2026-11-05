Software Architect(Direct): Loaded the requested Software Architect skills. Goal: new themes reuse Starter’s structure while receiving a fresh design and fresh CSS.

**Findings**

- A2 currently instructs agents to copy every file and restyle it; the same assumption appears in the introduction, tool overview and conversion bootstrap. These need one consistent rule. [SKILL.md:26](/Users/la/Programming/tovu-integration-clones/prov2-tovu/content/agent-plugins/tovu-theme/skills/tovu-theme/SKILL.md:26), [A2:356](/Users/la/Programming/tovu-integration-clones/prov2-tovu/content/agent-plugins/tovu-theme/skills/tovu-theme/SKILL.md:356), [bootstrap:562](/Users/la/Programming/tovu-integration-clones/prov2-tovu/content/agent-plugins/tovu-theme/skills/tovu-theme/SKILL.md:562).
- Reuse the existing duplication service: it already provides bounded traversal, staging, cleanup, identity assignment, asset-path rewriting, originals snapshots and rediscovery. Admin duplication and the agent tool share it. [duplicate-theme.ts:18](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/theme/duplicate-theme.ts:18), [implementation:320](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/theme/duplicate-theme.ts:320).
- **Identify CSS by files and markup, not a manifest stylesheet list.** The loader chooses `css/theme.css` for v2; `fontStylesheets` concerns fonts. Removing only the primary file misses inline styling and Starter’s lightbox script, which injects CSS. [loader:865](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/theme/theme.ts:865), [inline example:3](/Users/la/Programming/tovu-integration-clones/prov2-tovu/content/themes/static/tovu-starter/render/partials/footer-minimal.html:3), [lightbox:81](/Users/la/Programming/tovu-integration-clones/prov2-tovu/content/themes/static/tovu-starter/scripts/vendor/lightbox.js:81).
- **No CSS does not itself make an authored theme invalid.** Missing CSS loads as `""`; required static files exclude CSS. Keep the exact stylesheet sentinel for token injection and supply an empty stylesheet to avoid a broken URL. [theme.ts:865](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/theme/theme.ts:865), [required files:77](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/theme/theme-layout.ts:77), [sentinel:126](/Users/la/Programming/tovu-integration-clones/prov2-tovu/content/agent-plugins/tovu-theme/skills/tovu-theme/SKILL.md:126).
- The cited “Rule checks” are prose: line 80 requires screenshot QA; line 243 discusses asset URLs. Neither rejects empty CSS. Line 243 is also stale: duplication now rewrites those URLs automatically. Compiled themes have separate conformance/hash checks. [SKILL.md:79](/Users/la/Programming/tovu-integration-clones/prov2-tovu/content/agent-plugins/tovu-theme/skills/tovu-theme/SKILL.md:79), [rewrite:258](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/theme/duplicate-theme.ts:258).
- Preserve functional contracts: form classes/data attributes/`hidden`, consent attributes, menu/embed markers and scripts’ selector hooks. Forms already supply baseline CSS; consent owns its UI stylesheet. Preserve kUInetic’s complete vendor folder and licensing. [forms:33](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/public-http/http/site/form-render.ts:33), [consent:6](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/consent/html/render.ts:6), [motion:9](/Users/la/Programming/tovu-integration-clones/prov2-tovu/content/agent-plugins/tovu-theme/skills/tovu-theme/references/motion.md:9).
- Admin agents have `web_fetch_page`, including rendered HTML and screenshots, plus `web_screenshot_page` for public URLs and inactive theme previews. Both are registered in composition. No native general web-search tool was found; `search_tools` discovers tools, not websites. CLI/MCP search extras and actual browser availability are **UNVERIFIED**. [fetch catalog:27](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/web/agent-tools.ts:27), [registration:529](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/tool-catalog-manifest.ts:529).
- Both clones report branch `merge-1029`. The prescribed Tovu architecture chapters 13/14 and project-memory file were absent at their documented paths; compliance with their contents is **UNVERIFIED**. No files were changed and no tests, builds or servers were run.

**Ordered plan**

1. **Add Tovu’s design-selection rule to `content/agent-plugin-overlays/ui-ux-design/GUIDANCE.md`.** Approximately **+18/−0 lines**.
   - Before styling, identify the site’s purpose and choose a fitting visual direction.
   - Awwwards first: inspect candidate live sites. Dribbble and Pinterest provide additional image inspiration.
   - Combine ideas; reproduce one site’s design only when the owner supplied it as the reference.
   - Discover search/fetch/screenshot capabilities first. Without web search, fetch Awwwards and follow returned links to candidates.
   - If access, login or screenshot capability prevents inspection, use accessible references or existing owner assets. With none available, state “external inspiration unverified,” propose an original direction and continue the inactive draft. Never fall back to Starter CSS, shell commands or installation.
   - Preserve the approved chat-rules paragraph; add the new section separately.

2. **Make the theme procedures consistent.** Edit `content/agent-plugins/tovu-theme/skills/tovu-theme/SKILL.md`, its `references/motion.md`, and `content/agent-plugin-overlays/site-import/GUIDANCE.md`. Approximately **+40–55/−20–30 lines**.
   - Update lines 26, 64, A2, the Part B bootstrap at 562, and Part C’s duplication example at 727.
   - New designs use `theme_duplicate { …, mode: "structure-only", activate: false }`.
   - Starter supplies pages, shells and functional wiring. Author the new typography, spacing, colours, responsive rules and components from the selected direction.
   - Imported sites use their supplied design; they do not inherit Starter styling.
   - Explain `valid` versus `unstyled`; retain screenshot QA and owner approval before activation.
   - Correct Rule 5’s obsolete manual URL-replacement instruction.
   - Clarify motion’s “keep the source’s appearance”: it means the supplied conversion/reference design. Keep vendor runtime assets, never Starter’s appearance stylesheet.

3. **Put the reusable HTML transformation in Jini.** Add `packages/platform/src/web/strip-html-presentation.ts`, export through its existing `index.ts`, and add focused tests. Approximately **+70–110 production lines; +90–130 test lines**.
   - Reuse the existing parse5 dependency and source-location editing approach; avoid serializing the entire document, which could change the exact sentinel.
   - Public contract: `stripHtmlPresentation({ html }, { preservedStylesheetHrefs, removedScriptSrcs })`.
   - Remove `<style>`, inline `style` attributes and stylesheet links except explicitly retained links. Remove explicitly identified style-injecting scripts.
   - Preserve comments, classes, identifiers, form/consent attributes, scripts and embed markers otherwise.
   - This is a pure transformation with no I/O or vendor knowledge. Tovu supplies its paths and exceptions.
   - Existing parsing mechanisms checked: [platform HTML parser:1](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/platform/src/web/html-document.ts:1), [consent source-location edits:331](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/consent/html/gate.ts:331).

4. **Extend Tovu’s existing duplication path.** Edit `duplicate-theme.ts`, `duplicate-theme-tool.ts`; add a small theme-specific transformation helper. Approximately **+100–150/−10–20 production lines**.
   - Add `mode: "full" | "structure-only"`; omitted mode preserves existing full-copy behaviour.
   - Initially support **authored v2 static themes**, including Starter. Other formats receive an actionable unsupported-mode response before copying.
   - Filter non-vendor `.css` and `.css.map` files before copying. Preserve the complete `assets/vendor/kuinetic/` subtree.
   - Transform pages/partials through Jini; retain the exact primary stylesheet sentinel.
   - Omit Starter’s `scripts/vendor/lightbox.js` and its includes because it embeds appearance CSS. Report that omission explicitly.
   - Create `css/theme.css` containing only an “unstyled structure copy” comment.
   - Preserve token keys and mode contracts, but replace inherited appearance values with neutral system colours/fonts and neutral sizing. Regenerate light tokens consistently; disable inherited font stylesheet loading.
   - Run transformations before originals snapshotting. Reuse current path rewriting, containment, limits and cleanup.
   - Return `stylingStatus: "unstyled"`, `activated: false`, omission counts and an actionable next-step warning alongside load `status/errors`.
   - Reject `mode: "structure-only", activate: true` before writes.

5. **Keep marked copies inactive through existing activation mechanisms.** Edit `features/theme/active-theme.ts`, a small readiness helper, and the agent/admin activation adapters. Approximately **+35–55/−3–8 lines**.
   - Use the stylesheet’s unstyled marker as temporary state; no manifest field or database migration.
   - Exclude marked copies from `writableThemeIds`, while keeping them valid and previewable.
   - Both activation adapters explain: “This structure copy still needs styling. Ask the assistant to finish its design before activating it.”
   - Writing the replacement stylesheet removes the marker. This establishes readiness for review; screenshot QA and owner approval establish design completion.
   - Reuse the existing injected activation allowlist rather than adding a lifecycle subsystem. [allowlist:173](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/theme/active-theme.ts:173).

6. **Add failing regression tests first, then implement and verify.** Approximately **+180–260 test lines**, beyond Jini’s tests above.
   - Extend `features/theme/__tests__/duplicate-theme.test.ts`: real Starter fixture, absent inherited CSS/inline styles/lightbox injector, preserved hooks/vendor assets, neutral tokens, valid discovery, correct originals, unchanged source and rollback.
   - Extend `assistant/__tests__/tool-registrations.theme-duplicate.test.ts`: schema/default compatibility, unstyled result and conflicting activation rejected before writes.
   - Cover agent/admin activation before and after replacement CSS; confirm inactive previews remain available.
   - Add prose pins for inspiration order, missing-tool fallback and structure-only calls.
   - Bump local `tovu-theme` from `1.1.1` to `1.1.2` and update its existing version assertion. No shared-plugin version changes.

**Bundled-plugin/text pins to account for**

- [ui-ux-design-overlay.test.mjs:19](/Users/la/Programming/tovu-integration-clones/prov2-tovu/content/agent-plugin-overlays/ui-ux-design/__tests__/ui-ux-design-overlay.test.mjs:19): exact approved opening text; adjust section extraction without weakening that assertion.
- [site-import-overlay.test.mjs:44](/Users/la/Programming/tovu-integration-clones/prov2-tovu/content/agent-plugin-overlays/site-import/__tests__/site-import-overlay.test.mjs:44): real tool identifiers and plugin handoffs.
- [bundled-tovu-theme-package.unit.test.ts:88](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/__tests__/unit/bundled-tovu-theme-package.unit.test.ts:88): A2 text slicing, scaffold/rebuild instructions, screenshot loop, conversion bootstrap and version pin at 324.
- [tovu-theme bundled-package.test.mjs:7](/Users/la/Programming/tovu-integration-clones/prov2-tovu/content/agent-plugins/tovu-theme/__tests__/bundled-package.test.mjs:7): packaged references, motion file and tool-first instructions.
- The bundled UI/UX and site-import host tests cover packaging/seeding; their shared skill-text pins live in Jini and need no wording changes.

**Cost — frequency × payload**

| Added operation | Frequency × payload |
|---|---|
| Guidance delivery | Once per relevant plugin load × approximately 2–4 KB additional prose |
| Capability discovery | Up to two searches/descriptions per design × tool metadata; approximately 2–10 KB each, estimate |
| Inspiration fetches | Target budget: one listing plus two candidates per design × 12,000 content characters plus returned facts |
| Inspiration screenshots | Up to two captures per design × variable JPEG payload; each saved capture also writes those image bytes |
| Rendered-site resources | Only when rendering is necessary × page-dependent asset bytes; actual transfer size **UNVERIFIED** |
| Structure transformation | One existing text-read pass per duplicate; Starter has approximately 43 KB of template markup |
| Draft writes | Transformed markup/tokens plus approximately 80-byte stylesheet stub; originals snapshot writes a second copy |
| Omitted Starter stylesheet | Saves 68,731 bytes in both live copy and originals: approximately 137 KB total |
| Readiness checks/result | In-memory CSS inspection per activation; approximately ≤1 KB added tool-result metadata |
| Background polling | **Zero** |

Raw fetches already cap responses at 5 MiB; `maxChars` bounds content, not all metadata or rendered subresources. Existing final screenshot QA is unchanged. [fetch limits:19](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/platform/src/web/web-page.ts:19).

**What this will NOT do; CUT-CANDIDATES**

No AI-Dev-Shop/shared UI/UX skill edits, new browser/search provider, dependency installation, schema migration, background job, automatic activation or changes to existing installed themes.
**CUT-CANDIDATES:** compiled/templated theme stripping, arbitrary JavaScript CSS extraction, persistent styling workflow, new admin badges, automatic visual scoring and replacement lightbox design.

**Effort and dependencies**

**6–9 hours of Codex work**, including focused tests and package integration. Jini’s transformer release precedes Tovu consumption; duplication precedes readiness integration; final guidance examples depend on the settled tool schema. Keep new functions within complexity 10; desktop is untouched.

**Owner questions**

None required. Recommendation: preserve vendor animation infrastructure and host-owned form/consent styling, while removing Starter-authored appearance CSS, including its embedded lightbox styling.
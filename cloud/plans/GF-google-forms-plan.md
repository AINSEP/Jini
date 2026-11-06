Loaded both requested skills. Goal: make Google Forms another swappable collection provider, with provider choices shared by admin and the assistant.

Inspected `origin/cloud/combine`: Jini `7932eef2c`, Tovu `4c793bc5d`, plus both earlier plans. Graph tools were unavailable; evidence uses bounded `git show`/`git grep`. Nothing changed; no tests, project builds, installs or servers ran.

**Findings**

- The collection interface, registry and embed plan already exist. Reuse them. [Jini provider.ts:10](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/provider.ts:10)
- Formspree already has separate runtime and agent plugins. Its runtime validates a public destination without network calls. [provider.ts:7](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/provider-plugins/src/formspree/provider.ts:7), [agent manifest:5](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/formspree/plugin.json:5)
- Admin hardcodes both choices and Formspree’s input; the assistant hardcodes the same choices. [admin:73](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/admin/src/forms/react/components/FormEditorFieldsBody.tsx:73), [tool schema:202](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/agent-tools.ts:202)
- Tovu’s lease wrapper exposes only `plan` for collection providers. Simply adding settings metadata to a plugin would lose it. [wrapper:184](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/provider-plugins.ts:184)
- Embed rendering currently emits a live `src`. Existing consent code already activates inert frames, but the new declaration contract is unfinished. [renderer:209](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/html-render.ts:209), [consent DOM:45](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cookie-consent/src/client/dom.ts:45)
- External providers are already excluded generically from built-in receiver manifests. No Google branch is needed there. [manifest:26](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/form-destination-manifest.ts:26)
- **UNVERIFIED:** publication/deployment status, current test results and any particular form’s public accessibility. Google requires publication and suitable responder access. A valid-looking URL cannot prove those settings. [Google instructions](https://support.google.com/docs/answer/2839588?hl=en)

Paths below are relative to the named repository. Line estimates exclude generated output; tests are proposed, not executed.

1. **Add one small provider settings description.**

   Change Jini `packages/cms/src/forms/provider.ts` and `packages/provider-plugins/src/formspree/provider.ts`; Tovu `apps/website/src/server/runtime/composition/provider-plugins.ts`.

   Add an optional `describe()` method returning public label, text/URL config fields, help text, answer-location/validation explanations and required frame origins. Put the built-in description beside its existing registration. Add one shared registry-to-description projection; pass `describe()` through the existing lease gate. Missing or broken descriptions produce a plain unavailable-settings message and preserve stored selections.

   **Why no smaller:** registered IDs alone cannot describe each provider’s inputs; one shared description removes both vendor-specific editors. No changes to `@jini-ai/core`.

   Production **+80–130/−0–10**. Extend Jini `packages/cms/src/forms/__tests__/provider.test.ts` and Tovu `apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts`: descriptions, disabled leases, throwing plugins and independent registries.

2. **Feed that description to admin and the assistant.**

   Change these Jini files:

   - `packages/admin/src/core/ports/forms.ts`
   - `packages/admin/src/forms/adapters/http.ts`
   - `packages/admin/src/forms/adapters/memory.ts`
   - `packages/admin/src/forms/react/hooks/use-form-editor.hooks.ts`
   - `packages/admin/src/forms/react/pages/FormEditor.tsx`
   - `packages/admin/src/forms/react/components/FormEditorFieldsBody.tsx`

   Change these Tovu files:

   - New `apps/website/src/server/inbound/admin-http/routes/forms/providers.ts`
   - `apps/website/src/server/runtime/composition/modules/forms-admin.ts`
   - `apps/website/src/server/routes/types.ts`
   - `apps/website/src/server/runtime/composition/deps.ts`
   - `apps/website/src/features/forms/agent-tools.ts`
   - `apps/website/src/features/forms/tool-registrations.ts`

   Expose an authorized provider-list endpoint through the admin port. Render its choices and config fields generically. Add `forms_list_providers` using the same Jini projection; replace the mutation tool’s vendor enum with a provider ID and string-valued public config. The assistant lists providers before choosing one. Keep ordinary config validation and unavailable-provider behavior.

   **Why no smaller:** admin needs transport wiring; the assistant needs current discovery. A listing tool avoids rebuilding tool schemas whenever plugins change.

   Production **+150–230/−30–50**. Extend Jini’s `FormEditorFieldsBody.unit.test.tsx` and `use-form-editor.unit.test.tsx` under `packages/admin/src/forms/react/__tests__/`; Tovu `apps/website/src/features/forms/__tests__/agent-tools.unit.test.ts`; add `apps/website/src/server/inbound/admin-http/routes/forms/__tests__/providers.unit.test.ts`. Prove a dummy fourth provider appears without editing either client, and failed discovery preserves drafts.

3. **Add the two Google plugins.**

   Create exactly these Jini files:

   - `packages/provider-plugins/src/google-forms/provider.ts`
   - `packages/provider-plugins/src/google-forms/index.ts`
   - `packages/provider-plugins/src/google-forms/jini.plugin.json`
   - `packages/agent-plugins/google-forms/plugin.json`
   - `packages/agent-plugins/google-forms/skills/google-forms/SKILL.md`

   Runtime/package subpath: `@jini-ai/provider-plugins/google-forms`. Agent subpath: **`@jini-ai/agent-plugins/google-forms`**. Runtime manifest ID: `google-forms`; collection provider ID: `google_forms`, matching the registry’s underscore grammar.

   Store only `config.url`. Smallest initial allowlist: exactly HTTPS `docs.google.com`, path `/forms/d/e/<letters-digits-underscore-hyphen>/viewform`, optionally `?embedded=true`. Reject other hosts, short links, credentials, ports, fragments, edit links and other queries. Construct the embed URL with `embedded=true`.

   The agent skill teaches publication, public responder access, anonymous-browser verification and the existing authorized selection tools. Questions and new answers remain in Google; switching preserves local definitions/history.

   **Why no smaller:** runtime collection and agent setup are separate existing plugin responsibilities. Neither imports the other.

   Production/docs **+110–170/−0**. Add `packages/provider-plugins/src/google-forms/__tests__/provider.test.ts`, **+80–120 test lines**: allowlist attacks, canonical URL, description and pure embed output with no network dependencies.

4. **Connect embed consent and static output once.**

   Change Jini:

   - `packages/cms/src/forms/provider.ts`
   - `packages/cms/src/forms/html-render.ts`
   - `packages/cookie-consent/src/render/index.ts`
   - `packages/cookie-consent/src/client/dom.ts`
   - `packages/cookie-consent/src/client/index.ts`

   Wire through Tovu:

   - `apps/website/src/server/inbound/public-http/http/site/render.ts`
   - `apps/website/src/contracts/core/public-page-security-headers.ts`
   - `apps/website/src/features/theme/public-page-security-headers.ts`
   - `apps/website/src/server/inbound/public-http/middleware/public-page-security-headers.ts`
   - `apps/website/src/features/site-export/static-security-headers.ts`
   - `apps/website/src/features/site-export/site-exporter.ts`

   The embed plan declares **`consent: ["functional"]`**, proposed default. The consent job must normalize that into its shared all-of permission check: its current plan spells requirements `requires`. Settle that spelling once, with one evaluator. An iframe needs no Google script declaration.

   Jini renders an inert frame until effective permission allows it; withdrawal uses the shared cleanup/reload behavior. Explicit consent-off mode uses ordinary delivery. Missing consent infrastructure leaves the frame inert with a readable alternative. Google’s plugin declares only `https://docs.google.com` as its frame origin; Tovu passes that declaration into existing header formatting.

   Keep a visible message: **“If this form does not open, open it on Google or contact the site owner.”** Include the validated public link. Do not claim automatic private/closed-form detection: iframe load events cannot establish success. [Browser documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#error_and_load_event_behavior)

   **Why no smaller:** `loading="lazy"` does not enforce consent. Sharing the existing renderer/export path prevents a second implementation.

   **Ordering:** land the consent declaration/frame contract before enabling Google. Full-document theme runtime-slot support remains a dependency, currently **UNVERIFIED**.

   Incremental production **+90–160/−5–20**, excluding the separate consent replacement. Extend Jini `packages/cms/src/forms/__tests__/provider.test.ts`, `packages/cookie-consent/src/__tests__/client-dom.test.ts`; Tovu `apps/website/src/features/site-export/__tests__/static-copy-policy.unit.test.ts`, `static-security-headers.test.ts`, and `apps/website/src/features/forms/__tests__/form-destination-manifest.test.ts`. Cover zero pre-permission requests, withdrawal, consent-off, ZIP/static parity and no built-in receiver entry.

5. **Package and select the plugins.**

   Change Jini `packages/provider-plugins/package.json`, `packages/agent-plugins/package.json`, `scripts/lib/agent-plugin-packages.ts`, and generated `packages/plugin-catalog/catalog.json`; Tovu `apps/website/src/features/agent-plugins/bundled-catalog.ts`.

   Add the two exports/artifacts and generate their real integrity records. Existing builders already discover/build provider folders; do not add vendor branches.

   **Why no smaller:** source folders alone are not installable plugins.

   **+30–60/−0–5** handwritten lines, plus generated records. Extend `packages/plugin-catalog/__tests__/catalog.test.ts` and the existing Tovu provider lifecycle test. Release verification must include anonymous Google access and republishing affected static pages; retain pending built-in receiver data.

**Added I/O cost**

Let `P` be registered providers, `D` description bytes, `G` Google document/assets bytes and `S` answer bytes. Actual artifact/vendor sizes are **UNVERIFIED**.

| Trigger | Added reads/writes/polls |
|---|---|
| Plugin load/reapply | Once per selected version × runtime/agent artifact bytes; existing loader only. |
| Editor opening/manual refresh | 1 provider-list GET × `P × D`; propose ≤4 KiB per description. No DB/vendor read. |
| Assistant discovery | 1 listing invocation × `P × D`; in-memory registry reads only. |
| Provider save | Existing definition read/write gains ≤2 KiB public selection; no new write operation. |
| Page rendering/export | Zero new DB/vendor reads; roughly ≤1 KiB extra markup per embed. Existing output write gains that markup. |
| Permitted embed display | 1 iframe navigation × `G`, including Google’s subrequests; denied embeds make zero Google requests. |
| Google submission | Google-controlled browser traffic carrying `S` plus vendor overhead; zero local answer writes. |
| Consent changes | In-memory reconciliation; existing consent storage/context work is shared, not duplicated. **No new poll.** |

I will **not** add OAuth, credentials, Google API clients, form creation, answer import/sync, webhooks, availability probes, a scheduler, HTML scanning, cross-plugin imports or a new provider framework. No database/schema change is needed; any later schema work must use ADR-066 TS migrations. Plugin/config failures affect the form and show plain words; they never refuse boot.

Estimate: **12–18 Codex hours**, including focused tests and packaging, excluding the separate consent replacement and owner/account waiting.

Owner-only inputs: which public form to use for acceptance, and whether **functional** is the approved consent category for these embeds.
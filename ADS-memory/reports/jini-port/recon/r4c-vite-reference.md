# R4c — Jini Vite Reference App + Reusability Proof

Design for the Vite reference host and the zero-OD-import proof. Grounded in the
verified Next-coupling audit of `apps/web` (see §4). "Verified" = read/grepped
real code; "Design" = proposed for Jini.

**Key verified fact enabling all of this:** OD's chat surface has ZERO Next
imports. The only Next-isms in the whole chat/composer path are 8 `'use client'`
string directives (`ChatComposer.tsx:1`, `composer/LexicalComposerInput.tsx:1`,
`analytics/provider.tsx:1`, `i18n/index.tsx:1`, etc.) — which Vite simply ignores
(they're inert string literals to a non-Next bundler). All Next machinery lives
in the *shell*: `app/layout.tsx`, `app/[[...slug]]/page.tsx` (a catch-all that
just mounts `client-app.tsx`), `next.config.ts`, `next dev --turbopack`. So OD is
already a client SPA wearing a Next shell over a hand-rolled `src/router.ts`.

---

## 1. `examples/reference-web` — minimal Vite React host

Runs with **no daemon, no backend** — a fake in-memory `ChatTransport` scripts a
canned agent turn (text → tool_use → tool_result → artifact → usage → done). Its
job is to prove the engine mounts and streams end-to-end with stub adapters.

### Structure
```
examples/reference-web/
  index.html                      # <div id="root">, <script type=module src=/src/main.tsx>
  vite.config.ts                  # @vitejs/plugin-react; resolve.alias @jini/* -> ../../packages/*/src (dev transpile)
  package.json                    # deps: react, react-dom, @jini/chat-react, @jini/artifacts-react; devDeps: vite, @vitejs/plugin-react
  tsconfig.json
  src/
    main.tsx                      # createRoot(#root).render(<App/>)  — pure React 18, no Next
    App.tsx                       # <JiniChatProvider ...stubs><ReferenceLayout/></JiniChatProvider>
    ReferenceLayout.tsx           # 2-pane: <ChatColumn/> | <ArtifactColumn/>
    transport/fakeTransport.ts    # in-memory ChatTransport (canned SSE-like emission via setTimeout)
    adapters/
      stubProject.ts              # ProjectContextValue over an in-memory file map
      stubAnalytics.ts            # { track: (e,p)=>console.debug('[analytics]',e,p) }
      stubI18n.ts                 # { t:(k)=>k, locale:'en' }  (passthrough)
      registerReferenceTools.ts   # registerToolRenderer('Bash', ...) demo + default fallback
      referenceArtifacts.ts       # new RendererRegistry([Markdown, Html, Svg]) — built-ins only
    styles.css                    # imports @jini/chat-react tokens + a tiny layout shell
```

### What it renders
- Left column: `<MessageList>` fed by `useConversation()` + `useRunStream(fakeTransport)`; a `<Composer>` with an `AttachmentTray` and a **stubbed** `ModelAgentPickerSlot` (a plain `<select>` over two fake agents). Send → `fakeTransport.startRun` emits the canned event script → tool card + streamed text render live.
- Right column: `<ArtifactView>` from `@jini/artifacts-react` rendering the markdown/html artifact the canned turn "produces" (drives the srcDoc sandbox path with no OD bridges).
- A `<QuestionsPanel>`: the canned script includes one `<question-form>` so the Questions tab + answer-roundtrip (`formatFormAnswers` → next `startRun`) is exercised.

### How JiniChatProvider is wired (stub adapters)
```tsx
<JiniChatProvider
  transport={fakeTransport}                 // §1 in-memory, no network
  project={stubProject}                     // in-memory files, resolveFileUrl = blob: URLs
  analytics={stubAnalytics}                 // console.debug
  i18n={stubI18n}                           // key passthrough
  artifactRegistry={referenceArtifacts}     // built-in renderers only
  slots={{
    modelPicker: { value, onChange, render: ReferencePicker },
    composer: { plusMenuItems: [], mentionSources: [] },   // empty — proves optionality
    filePreview: { render: ({file}) => <ArtifactView file={file}/> },
    annotation: undefined,                   // proves comments/annotation is optional
  }}
  onFeedback={(c) => console.debug('[feedback]', c)}
/>
```
The reference app supplies **every port with a trivial stub**, which is exactly
the contract a real product must satisfy — so it doubles as living API docs.

### fakeTransport shape (Design)
```ts
export const fakeTransport: ChatTransport = {
  async startRun(input, h) {
    const runId = crypto.randomUUID();
    const script: AgentEvent[] = [
      { kind:'text', text:'Sure — building it now.' },
      { kind:'tool_use', id:'t1', name:'Write', input:{ path:'demo.md' } },
      { kind:'tool_result', toolUseId:'t1', content:'wrote demo.md', isError:false },
      { kind:'text', text:'Done. See the preview →' },
      { kind:'usage', outputTokens: 42, stopReason:'end_turn' },
    ];
    let i = 0;
    const tick = () => {
      if (input.signal.aborted) return;
      if (i < script.length) { h.onEvent(script[i++]); setTimeout(tick, 250); }
      else h.onDone(script);
    };
    setTimeout(tick, 100);
    return { runId };
  },
  async reattachRun() {}, async fetchRunStatus() { return null; },
  async stopRun() {}, async reportFeedback() {},
};
```

---

## 2. `examples/minimal-host` — zero-OD-import reusability proof

The smallest possible host that renders chat + artifacts. Its entire purpose is
to be the fixture the **engine-boundary lint** (r4b §5) points at: if this file
can only import `@jini/*` + `react` and still produce a working chat, the engine
is genuinely product-independent.

### Allowed imports (the ONLY ones)
```ts
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { JiniChatProvider, useRunStream, useConversation,
         MessageList, Composer } from '@jini/chat-react';
import { RendererRegistry, MarkdownRenderer, ArtifactView } from '@jini/artifacts-react';
import type { ChatTransport, AgentEvent } from '@jini/chat-core';
```

### What it stubs (inline, no adapter files)
- `transport`: a 6-line echo `ChatTransport` — `startRun` immediately emits one
  `{kind:'text'}` echoing the prompt, then `onDone`. No network, no timers even.
- `i18n`: omitted → provider default passthrough (`t:(k)=>k`).
- `analytics`: omitted → provider default no-op.
- `project`: a `{ projectId:null, files:[], resolveFileUrl:(p)=>p, resolveRawUrl:(p)=>p }`.
- `artifactRegistry`: `new RendererRegistry([MarkdownRenderer])`.
- No model picker, no composer slots, no annotation, no feedback — proving every
  slot beyond `transport` is optional.

### The forbidden set (what the lint fails on if present)
- ANY import from `apps/**`, `foundry/integrations/open-design/**`, `@open-design/*`.
- ANY `next/*`, `fetch`/`EventSource`/`window` at the host top level (transport is
  the host's business, but the *proof* deliberately uses none).
The file is ~35 lines. If it compiles and renders a streamed echo + a markdown
artifact using only `@jini/*` + `react`, reusability is proven mechanically, and
CI keeps it proven.

---

## 3. Consumer wiring template (Zana / Open-Marketing / Tovu-Runner)

Framework-honest: each product is its own Vite (or Next, or Remix) app; the
engine is framework-agnostic React, so the host chooses the framework. Mounting
the engine is "implement 2 required ports + 3 optional registries, get the rest
free."

### MUST implement (required)
| Port | What the product supplies | OD analogue it replaces |
|---|---|---|
| `ChatTransport` | `startRun/reattachRun/stopRun/fetchRunStatus` against the product's own backend (Zana's API, Tovu-Runner's daemon, Open-Marketing's job service) | `providers/daemon.ts` |
| `ProjectContextValue` | its notion of "workspace/files/urls" (or a null stub if fileless) | `Project`/`ProjectFile` + `providers/registry` url helpers |

### SHOULD implement (recommended, else defaults)
| Slot | Supply for | Default if omitted |
|---|---|---|
| `ModelAgentPickerSlot` | product's model/agent list | no picker (single implicit agent) |
| tool registry (`registerToolRenderer`) | product-specific tool cards | generic tool card ladder |
| `RendererRegistry` | product artifact kinds (e.g. Open-Marketing "campaign", Tovu "run-report") | markdown/html/svg/react built-ins |
| `AnalyticsAdapter` / `I18nAdapter` | product telemetry + strings | no-op / key passthrough |

### OPTIONAL
`ComposerSlots` (plus-menu items, @-mention sources, leading accessories),
`AnnotationAdapter`, `FilePreviewSlot`, `onFeedback`.

### What the product gets for FREE
Streaming run lifecycle + reconnection, message list with thinking/text/tool
grouping, tool lifecycle cards (AG-UI 4-state), the `<question-form>` clarifying
flow + answer roundtrip, pinned TodoWrite card, artifact parsing + streaming
partial render + srcDoc sandbox, attachment tray, copy/feedback affordances, and
the headless hooks (`useConversation`/`useRunStream`/`useComposer`) so it can
build a bespoke layout instead of accepting the default two-pane.

### Minimal mount (any Vite product)
```tsx
<JiniChatProvider transport={myTransport} project={myProject}
  slots={{ modelPicker: myPicker }}>
  <MyProductLayout>
    <MessageList/>  <Composer/>  <ArtifactView file={selected}/>
  </MyProductLayout>
</JiniChatProvider>
```

---

## 4. Migration note: Next host → Vite reference host

**Today:** OD ships a Next 16 App-Router host (`next dev --turbopack`, `next
build`); Tovu-Runner reuses OD by swapping `apps/web/src` under that same Next
shell. Verified Next-bound surfaces vs clean:

### Clean (moves to Vite with no code change)
- **The entire chat/artifact surface** — 0 Next imports (verified grep). The 8
  `'use client'` directives are inert strings under Vite.
- Client routing: OD already uses a **hand-rolled `src/router.ts`** (`navigate()`,
  9.6 KB) behind a Next catch-all `app/[[...slug]]/page.tsx` that only mounts
  `client-app.tsx`. The router is pure client logic → drop straight onto Vite +
  History API. No `next/navigation`/`next/link` in the app (verified: none).
- State/i18n/analytics: plain React context (`i18n/index.tsx`,
  `analytics/provider.tsx`) — framework-neutral.
- Data: everything is `fetch`/`EventSource` to `/api/*` — no Next server
  components, no server actions, no route handlers in the app path.

### Next-bound (shell only — the engine never touches these)
| Next surface | Where | Vite replacement |
|---|---|---|
| `app/layout.tsx` (HTML skeleton, `<html>/<body>`, metadata) | shell | `index.html` + a React root layout |
| `app/[[...slug]]/page.tsx` catch-all + `client-app.tsx` | shell | `main.tsx` → `createRoot` mount |
| `next.config.ts` | shell | `vite.config.ts` |
| Turbopack dev / `next build` | tooling | `vite` / `vite build` |
| `'use client'` directives | scattered | inert (ignored) — optionally stripped by a codemod |
| `next/font`, `next/image` | **not used in app path** (verified: no `next/font`/`next/image`/`next/link` imports found) | n/a — self-host fonts via CSS `@font-face`, plain `<img>` |
| SSR / RSC | **not used** — app is a client SPA behind a catch-all | n/a |

### What it takes (the actual work)
1. Add `examples/reference-web` as above (Vite shell: `index.html` + `main.tsx` +
   `vite.config.ts` with `@jini/*` src aliases).
2. Lift `src/router.ts` as-is behind a `<Router>` that reads
   `window.location`/`popstate` (already the router's model).
3. Move the `app/layout.tsx` `<head>` bits (fonts, metadata, theme
   data-attribute) into `index.html` + a mount-time effect.
4. Delete `app/`, `next.config.ts`; swap scripts to `vite`/`vite build`.
5. Nothing in the **engine** moves — because the engine has no Next coupling, the
   reference host is a *new thin shell around the same components*, not a port.

### Why the engine avoids Next by construction
The r4b engine-boundary lint forbids `next/*` in `@jini/*` (rule 2: no host/
product/framework imports beyond `react`/`react-dom`/peers). So the engine can
never regain Next coupling; each host — Next, Vite, Remix — supplies its own
shell (routing, document head, fonts) and mounts the same framework-neutral
components. Tovu-Runner stops swapping `apps/web/src` under a borrowed Next shell
and instead depends on published `@jini/*` from its own Vite app.

**Bottom line:** the migration is *additive* (a new Vite shell + a reference
fake transport), not a rewrite. The costly part people fear — decoupling chat
from Next — is already done in the codebase (verified zero coupling); only the
~5-file app shell is Next-bound, and the reference app replaces it with an
`index.html` + `main.tsx` + `vite.config.ts`.

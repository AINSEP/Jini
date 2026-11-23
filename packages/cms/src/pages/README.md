# `@jini-ai/cms/pages`

Pure page-authoring checks the page tools run on HTML an agent writes. String in, result out: no I/O,
no repository, no host state.

| Subpath | Provides |
|---|---|
| `@jini-ai/cms/pages/authoring-html` | `requirePageAuthoringHtml({ html })` — refuses a bare `{{media:slug}}` token (it only resolves inside Media widget HTML) with a `ToolInputError` naming the media-embed alternative; returns the HTML unchanged otherwise. |
| `@jini-ai/cms/pages/hidden-until-script` | `findScriptRevealedContent({ html })` / `describeScriptRevealedContent({ html })` / `MAX_REVEAL_FINDINGS` — finds markup hidden until a scroll-reveal script runs (inline `opacity:0`, AOS/SAL/WOW attributes and classes, reveal-named `<style>` rules) and builds the model-facing warning. |

## Wiring

Needs nothing injected: both modules are pure functions over a string. `authoring-html` uses
`ToolInputError` from `@jini-ai/core` and `parse5`; `hidden-until-script` uses this package's own
widget-marker mask (`../widgets/markers/marker.js`).

A host's page-tool registration calls them around its own store write:

```ts
import { requirePageAuthoringHtml } from "@jini-ai/cms/pages/authoring-html";
import { describeScriptRevealedContent } from "@jini-ai/cms/pages/hidden-until-script";

const html = requirePageAuthoringHtml({ html: input.html });   // throws ToolInputError on a bare media token
await store.write({ id, html });
const warning = describeScriptRevealedContent({ html });       // undefined when clean; a warning, never a refusal
return warning === undefined ? { written: true } : { written: true, warning };
```

Must never import: host application code, a page store or repository, or a server framework. The
page tools that call these (and their write-then-warn tests) stay in the host.

Why the boundary sits here: [DR-005 portable package boundaries](../../../../docs/decisions/DR-005-portable-package-boundaries.md).

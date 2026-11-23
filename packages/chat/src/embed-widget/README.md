# embed-widget

The packaged visitor embed: a React widget (`./react/embed`), a React-free vanilla widget
(`./vanilla`), the lazy loader and browser session store (`./browser/*`), and its transports.
Every browser effect (keyboard, frames, storage, markdown conversion) is a port the host injects.

## Wiring

- Escape-key port (`./react/embed`): hosts pass `keyboard: createViewEscapeKeyPort({ view: document.defaultView })`
  to `EmbedChatWidget`/`EmbedChatHeader`; the capture listener keeps a confirm-step Escape from also closing
  the host dialog (`useEmbedChatDialog` skips an Escape whose default is already prevented).
- Safe markdown (`./vanilla`): `renderMarkdown: createSafeMarkdownRenderer({ toHtml, document })`. `toHtml` is the host's
  trusted converter (e.g. micromark) and must escape raw HTML, reject unsafe protocols and never enable
  `allowDangerousHtml`; the renderer only removes off-origin, `data:` and unparsable images (resolved against
  `document.baseURI`, authorized against `document.location.origin` or an injected `origin`) and hardens links
  with `rel="noopener noreferrer"`.

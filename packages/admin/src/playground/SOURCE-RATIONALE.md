# Source rationale retained

## apps/admin/src/features/playground/Playground.tsx

/**
 * @file The Studio "Playground" screen — a whiteboard for the assistant.
 *
 * No manual component picker: the assistant already discovers every component itself
 * (`search_components`/`describe_component` against `DEFAULT_INTERACTIVE_UI_REGISTRY`, real
 * shadcn/recharts components alongside A2UI's basic primitives) and renders whatever it decides
 * to build via the `assistant_render_ui` tool. The workspace chat dock (open it from the "+"
 * button, top right of any admin page) is what you talk to; while THIS page is the active one,
 * whatever it draws lands below, on the canvas, instead of inline in the chat transcript — on any
 * other admin page the exact same ask still renders inline in the chat, unchanged.
 *
 * The routing itself lives entirely on the `AssistantDock` side
 * (`components/AssistantDock/RoutedA2uiSurfaceCard.tsx`) — this component's only job is to publish
 * its own canvas container to `lib/playground-render-target-bus.ts` while it is mounted, and
 * unpublish it on unmount so navigating away reverts every later ask to inline rendering. That
 * register/unregister ref callback lives in `hooks/use-playground-canvas.hooks.ts`, split out the
 * same way `RoutedA2uiSurfaceCard.tsx` splits its own reading half of this same bus into
 * `hooks/use-routed-a2ui-surface-card.hooks.ts` — this file stays props-and-JSX only and calls
 * {@link usePlaygroundCanvas} through the injectable `usePlaygroundCanvasHook` prop below, the same
 * seam shape this page's now-deleted `usePlaygroundHook` prop used to have.
 *
 * Deliberately no example output rendered here: anything shown on the canvas must come from a real
 * assistant turn, not from JSX written into this file — a static/hardcoded example was tried and
 * explicitly rejected (it defeats the entire point of dynamic, agent-driven rendering). The
 * "nothing drawn yet" placeholder below is CSS only (`playground.css`'s
 * `.playground-render-target:empty ~ .playground-empty-state`) for the same reason: the canvas div
 * itself must stay a pure portal target with no JSX children of its own, or a real surface
 * appended into it by `RoutedA2uiSurfaceCard`'s portal would be commingled with content this
 * component thinks it owns.
 */

/** Injectable seam for the canvas render-target-bus registration hook. Defaults to the real
   *  {@link usePlaygroundCanvas}; a test can pass a fake here to exercise `Playground`'s rendering
   *  without driving the real `playground-render-target-bus` module state. */

## apps/admin/src/features/playground/hooks/use-playground-canvas.hooks.ts

/**
 * @file `Playground`'s own half of the render-target-bus handshake — extracted out of
 * `Playground.tsx` so the component stays props-and-JSX only, the same split
 * `hooks/use-routed-a2ui-surface-card.hooks.ts` (`components/AssistantDock/`) uses for the reading
 * side of this same bus. See that file's own doc for the paradigm this follows.
 *
 * ## Why no `*Port`/`*Dependencies` pair
 *
 * `setPlaygroundRenderTarget` is `lib/playground-render-target-bus.ts`'s own already-a-plain-module
 * write, and that module ships its own direct test seam (`getPlaygroundRenderTarget`/
 * `resetPlaygroundRenderTargetBus`) — this hook's own test drives it directly, no mock needed.
 * Nothing here reaches an HTTP client, a subscription, or any dependency this hook doesn't already
 * own outright, so per this workspace's ratified rule ("a hook doing NO I/O gets NO port"), wrapping
 * this call in a manufactured port would add a seam with nothing real on the other side of it.
 */

/** What `usePlaygroundCanvas` hands back to `Playground.tsx`. */

/** Ref callback for the canvas `<div>` — registers it as the active render target on attach,
   *  clears it on detach. Pass directly as the element's `ref`. */

/**
 * Registers (and unregisters) `Playground`'s own canvas container as the active
 * render-target-bus target, so `RoutedA2uiSurfaceCard.tsx` knows where to portal a drawn surface
 * while this page is mounted.
 *
 * @returns {@link PlaygroundCanvasController}. `registerCanvas` is a stable ref callback: React
 *   invokes it with the real node on attach and with `null` on detach, which is exactly
 *   register/unregister with no extra render needed — a plain ref callback rather than a
 *   `useEffect` + ref for that reason.
 * @complexity Time/space: O(1) per call; unregistration fans out to the bus's subscriber count (see
 *   `setPlaygroundRenderTarget`'s own doc).
 * @example
 * const { registerCanvas } = usePlaygroundCanvas();
 * <div ref={registerCanvas} />
 */

## apps/admin/src/lib/playground-render-target-bus.ts

/**
 * @file The seam between "the assistant drew something via `assistant_render_ui`" and "the
 * Playground page wants it drawn ON THE PAGE instead of inline in the chat transcript" — the
 * whiteboard feature's whole host-side piece (Jini's A2UI transport and `render-ui-tool.ts` are
 * untouched; this is purely about where the browser puts what they already send).
 *
 * ## Why a bus rather than props
 *
 * Same shape as `assistant-dock-bus.ts`, and for the same structural reason: the two components
 * that need to agree — `components/AssistantDock/RoutedA2uiSurfaceCard.tsx` (rendered from
 * `AssistantDock.tsx`, mounted once in `App.tsx`'s `<aside>`) and `features/playground/Playground.tsx`
 * (rendered through `renderRoute(route)`, a plain function with no props bag) — are siblings under
 * `App.tsx` with no shared state between them and no path to thread a prop through. `App.tsx` never
 * needs to know this exists; unlike the dock-open bus, there is no third owner here at all.
 *
 * ## Why this one holds a DOM node, not a boolean or id
 *
 * The reader (`RoutedA2uiSurfaceCard`) needs something `ReactDOM.createPortal` can target directly.
 * A boolean ("is Playground mounted") would still leave the renderer with no container to portal
 * into; an id string would make the renderer respend a `document.getElementById` lookup for every
 * a2ui event, racing Playground's own mount/unmount. The node itself is the one value that answers
 * both "is there a target" and "where is it" in one read.
 *
 * ## Ownership
 *
 * Only `Playground.tsx` calls {@link setPlaygroundRenderTarget} — it owns the container div's
 * lifecycle (mount registers it, unmount clears it back to `null`) via a ref callback. Everything
 * else only ever reads.
 */

/**
 * Subscribes to changes in the registered render-target node (registered, swapped, or cleared).
 *
 * @returns A disposer; call it from the subscriber's effect cleanup (or let
 * `useSyncExternalStore` do it, as {@link getPlaygroundRenderTarget}'s doc recommends).
 * @complexity O(1).
 */

/**
 * The currently registered Playground render-target node, or `null` when Playground is not
 * mounted (or has not yet attached its ref). Shaped for `useSyncExternalStore` — see
 * `RoutedA2uiSurfaceCard.tsx` for the one live reader.
 *
 * @complexity O(1).
 */

/**
 * Registers (or clears) the Playground page's canvas container. **Only `Playground.tsx` should
 * call this** — it is the component whose ref callback owns the container's lifecycle, and a
 * second publisher would let this module disagree with the DOM node it is supposed to mirror.
 *
 * No-ops when the value is unchanged (matches `publishAssistantDockState`'s guard), so React
 * re-invoking a stable ref callback identity cannot turn into a notification storm.
 *
 * @complexity O(n) in the subscriber count, O(1) when unchanged.
 */

/** Test seam — drops every listener and resets the state. Not used in production code. */

## apps/admin/src/styles/playground.css

/*
 * Studio → Playground (`Playground.tsx`). A scoped partial self-imported by that component, the
 * `styles/select.css` / `styles/see-more.css` / `styles/assistant.css` precedent, rather than an
 * addition to `styles.css` or a `main.tsx` import.
 *
 * The screen's own shell (`.page`/`.page-header`), frame (`.card`), and `.notice` all come from
 * `styles.css` unchanged. There is no manual component-picker chrome anymore, and no rendered
 * example output on this page at all — see `Playground.tsx`'s own module doc for why. What's left
 * here is just the small bits `styles.css` doesn't already cover.
 */

/*
 * The canvas card — `Playground.tsx`'s portal target for a2ui surfaces the assistant draws while
 * this page is active (see that file's own doc, and `RoutedA2uiSurfaceCard.tsx` for the routing
 * that lands them here instead of inline in the chat transcript).
 */

/* Pure portal target — deliberately no JSX children of its own (see `Playground.tsx`'s doc for
 * why), so stacking multiple drawn surfaces is just flex/gap in arrival order: oldest first,
 * newest at the bottom, matching normal reading order. */

/* One drawn surface, plus its dismiss button — see `RoutedA2uiSurfaceCard.tsx` for why the button
 * lives here and not on `A2uiSurfaceCard` itself. Sized/positioned after `styles.css`'s
 * `.jini-toast-close`, the codebase's existing small icon-only dismiss control. */

/* Shown only while the render target has no real children — the moment a surface portals in, this
 * sibling combinator stops matching and the message disappears on its own, no JS required. */

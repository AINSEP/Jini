/**
 * @file Which admin screen the operator is on, for the assistant — read at send time by
 * `AssistantDock.hooks.tsx`'s `useRunContext` and carried in the run's `contextRef`
 * (`assistant-transport.ts`'s `buildLocalCliContextRef`), where the daemon renders it into the
 * prompt (the host website's assistant run-page-context module).
 *
 * Two publishers, because no single component knows both halves: `App.tsx` knows the route, and only
 * an editor knows what its route param resolved to (a page's title, kind and status). Module state
 * rather than React context because the reader is a send-time callback, not a render — the value has
 * to be current when the operator presses Send, and nothing should re-render when it changes.
 *
 * Added 2026-09-16 after the owner, in the page editor for "Landing sample — xai", asked "can you
 * see which page it is?" and the assistant could not.
 */

import { getPlaygroundRenderTarget } from "./playground-render-target-bus.js";

/** The open entry an editor reports — what "this page" refers to. */
export interface AgentScreenEntry {
  readonly kind: string;
  readonly id: string;
  readonly title: string;
  readonly slug?: string;
  readonly status?: string;
}

/** The route half, published by `App.tsx`. */
export interface AgentScreenRoute {
  /** The admin route path (base already stripped), e.g. `/pages/<id>`. */
  readonly path: string;
  /** `agentPageId(route)` — the id `page.navigate` accepts, e.g. `pages`. */
  readonly section: string;
  /** The panel's sub-view (`page-editor`), or `null` on a section's own index screen. */
  readonly view: string | null;
}

/**
 * Where an assistant drawing (`assistant_render_ui`) appears on this screen: a screen that registers
 * a canvas (Studio → Playground, via `playground-render-target-bus.ts`) gets it there, every other
 * screen shows it inline in the chat. The browser alone makes that routing call, so the model only
 * knows it if this says so — on the Playground it told the operator "the chart in the chat above"
 * while the chart sat on the canvas (demo V3, 2026-10-05).
 */
export type AgentDrawingSurface = "canvas" | "chat";

/** What `contextRef.pageContext` carries — the shape `run-page-context.ts` validates. */
export interface AgentScreenContext {
  readonly path: string;
  readonly section: string;
  readonly view?: string;
  readonly entry?: AgentScreenEntry;
  /** Always set by {@link readAgentScreenContext}; optional so hand-built contexts (tests) still type-check. */
  readonly drawingSurface?: AgentDrawingSurface;
}

/** Optional ports for {@link readAgentScreenContext}. */
export interface ReadAgentScreenContextOptions {
  /** Whether the open screen has registered a drawing canvas. Defaults to the Playground render target. */
  readonly hasCanvas?: () => boolean;
}

function hasPlaygroundCanvas(): boolean {
  return getPlaygroundRenderTarget() !== null;
}

let currentRoute: AgentScreenRoute | null = null;
let currentEntry: AgentScreenEntry | null = null;

/**
 * Records the operator's current route. Returns a release that clears it only if no newer route has
 * been published since, so an out-of-order cleanup cannot erase the screen the operator is on.
 */
export function publishAgentScreenRoute(route: AgentScreenRoute): () => void {
  currentRoute = route;
  return () => {
    if (currentRoute === route) currentRoute = null;
  };
}

/**
 * Records the entry an editor has open. Returns a release with the same "only if still mine" rule as
 * {@link publishAgentScreenRoute}: React runs the old editor's cleanup around the new one's effect,
 * and a stale release must not clear the entry that replaced it.
 */
export function publishAgentScreenEntry(entry: AgentScreenEntry): () => void {
  currentEntry = entry;
  return () => {
    if (currentEntry === entry) currentEntry = null;
  };
}

/**
 * The screen to send with a message, or `undefined` when no route has been published — an entry on
 * its own does not say where the operator is, and the daemon requires a path and section anyway.
 *
 * @complexity O(1).
 */
export function readAgentScreenContext({ hasCanvas = hasPlaygroundCanvas }: ReadAgentScreenContextOptions = {}): AgentScreenContext | undefined {
  if (currentRoute === null) return undefined;
  return {
    path: currentRoute.path,
    section: currentRoute.section,
    ...(currentRoute.view === null ? {} : { view: currentRoute.view }),
    ...(currentEntry === null ? {} : { entry: currentEntry }),
    drawingSurface: hasCanvas() ? "canvas" : "chat",
  };
}

/** Clears both halves — for tests, which share this module's state across cases. */
export function resetAgentScreenContext(): void {
  currentRoute = null;
  currentEntry = null;
}

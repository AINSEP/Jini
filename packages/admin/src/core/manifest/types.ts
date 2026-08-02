/**
 * @file What an admin panel *is* — the contract a panel author codes against.
 *
 * This is the smallest surface in the package on purpose. A panel package (Jini-shipped,
 * host-owned, third-party, or AI-generated) should need this module and nothing else: it has no
 * React, no DOM, no transport, and no knowledge of the shell that will mount it.
 *
 * ## The three-file problem this replaces
 *
 * The reference implementation defines a section in three places — `App.tsx`'s `SECTIONS` map
 * (routing allowlist + render dispatch), `nav.ts` (sidebar label/icon/group/order), and
 * `agent-pages.ts` (which pages an AI agent may navigate to). Its own internal docs are emphatic
 * that this is deliberate, and they are right about *why*:
 *
 * > "Do not derive this from `App.tsx`'s `SECTIONS` map. Doing so would make every new admin
 * > screen agent-reachable simply by existing, which is the opposite of an allowlist."
 *
 * That reasoning survives here intact. What changes is only that the three facts live in one
 * declaration instead of three files that must be kept in sync by hand — with `nav` optional
 * (so a panel can be routable without a sidebar row, which the reference implementation's
 * `appearance` and `settings-raw` panels both rely on) and `agentReachable` an explicit opt-in
 * that defaults to false.
 *
 * The security property is strictly better than the three-file version: a panel author who forgets
 * to think about agent reachability gets `false`, and an AI generating a panel manifest cannot
 * make itself agent-reachable by omission. Under the old shape, forgetting to edit
 * `agent-pages.ts` was also safe — but so was forgetting to edit `nav.ts`, and the two mistakes
 * were indistinguishable from reading any one file.
 */

/**
 * A detail-route pattern owned by a panel.
 *
 * The reference implementation's `parseRoute` hard-codes every detail route as a branch in one 30-line if-chain
 * (`/posts/:id`, `/menus/new`, `/widgets/regions/:key`, `/collections/:key/:entryId`, ...), so a
 * panel cannot add a route without editing the router. Declaring patterns on the panel inverts
 * that: the matcher is generic and the panel owns its own URL space.
 *
 * Patterns are matched segment-by-segment against the route path:
 * - a literal segment matches itself exactly
 * - `:name` captures one segment into `params.name`
 *
 * There is deliberately no wildcard/splat and no regex. Every route in the corpus this was ported
 * from is expressible without one, and both features make it possible for two panels to claim
 * overlapping URL space in ways that are hard to diagnose.
 */
export interface AdminRoutePattern {
  /** Pattern relative to the panel's own id segment: `/:postId`, `/regions/:regionKey`, `/new`. */
  readonly pattern: string;
  /** Discriminator the panel's renderer switches on. Panel-local; never globally unique. */
  readonly view: string;

  /**
   * The page id this route reports to an agent, when it differs from the panel's.
   *
   * Two distinct effects, split by whether the pattern captures params — and the split is what
   * the reference implementation actually needs, not a generalization:
   *
   * - **Param-free pattern** (`/regions`): the route becomes a published agent *destination* in
   *   its own right, reachable by `page.navigate('widget-regions')`.
   * - **Pattern with params** (`/regions/:regionKey`): the route is not a destination (an agent
   *   cannot supply the id), but it *reports* this page id, so an agent that navigated to
   *   `widget-regions` and landed on the editor is told it arrived where it asked.
   *
   * Omitted (the default) means the route reports its panel's id and publishes nothing — which is
   * right for the common case: `/posts/abc` reports `posts`, the nearest id an agent can act on.
   *
   * This exists because collapsing the two questions is a documented past bug in the reference
   * implementation's `App.tsx`: the sidebar wants a nav row to light up, an agent wants an id it can pass
   * back to `page.navigate`, and widget regions is where they genuinely diverge — the sidebar has
   * no regions row so it highlights `widgets`, while the agent must be told `widget-regions`.
   * Sharing one function meant `page.navigate("widget-regions")` landed correctly and then
   * reported `after: "widgets"`, telling the agent it had arrived somewhere it had not asked for.
   * An agent's only correction for that is to navigate again.
   */
  readonly agentPageId?: string;
}

/** Sidebar presence. Optional on a panel — absence means routable but not listed. */
export interface AdminNavEntry {
  readonly label: string;
  /** Inner SVG markup for an 18x18 stroked icon (`viewBox="0 0 18 18"`, `stroke="currentColor"`),
   *  matching the convention already used across the reference implementation's `nav.ts`. Optional so a panel can be
   *  listed before anyone has drawn it an icon. */
  readonly icon?: string;
  /** Group heading. Panels sharing a value are rendered together; omitted means the ungrouped
   *  top row. */
  readonly group?: string;
  /** Ascending sort within a group. Ties fall back to registration order, which is stable. */
  readonly order?: number;
  /** Renders as a disabled row — announced but not yet built. */
  readonly soon?: boolean;
}

/**
 * A panel: one admin section, its URL space, and the conditions under which it mounts.
 *
 * `TRender` is whatever the host's rendering layer needs — a React element thunk for
 * `@jini-ai/admin/react`, something else for another framework. Keeping it a type parameter is
 * what allows this module to stay free of any framework import.
 */
export interface AdminPanel<TRender = unknown> {
  /**
   * Stable identifier, and the first URL segment (`users` -> `/users`). Also the value the shell
   * reports as the current page, so it must be the vocabulary a human would guess — the reference
   * implementation's `agent-pages.ts` notes that a separate agent-facing naming scheme would mean an agent reading
   * the page could not act on it without a translation table.
   */
  readonly id: string;

  /** What the shell renders for this panel. */
  readonly render: TRender;

  /** Sidebar presence. Omit for a panel that is reachable by URL but not listed. */
  readonly nav?: AdminNavEntry;

  /**
   * Whether an AI agent may navigate here via a `page.navigate`-style capability.
   *
   * **Defaults to false, and must stay an explicit opt-in.** See the file header — this is the
   * allowlist property, and deriving it from anything else defeats the point.
   *
   * Detail routes are never agent-reachable regardless of this flag: they need an id the agent
   * has to look up first, and the tool for that is a content catalog, not a navigation allowlist
   * that would have to enumerate every row in the database (the reference implementation's
   * `agent-pages.ts` hits exactly this case).
   */
  readonly agentReachable?: boolean;

  /**
   * Capability keys this panel needs wired before it can mount.
   *
   * This is the composability lever: a host does not ship or omit panel *code*, it supplies or
   * withholds the *ports* a panel names here, and the registry drops any panel whose requirements
   * are unmet — no dead nav row, no route that renders an error. A build that includes the
   * payments panel but wires no payments port simply has no payments section.
   */
  readonly requires?: readonly string[];

  /** Detail routes below `/{id}`. See `AdminRoutePattern`. */
  readonly routes?: readonly AdminRoutePattern[];

  /**
   * Permission strings the operator must hold for this panel to appear.
   *
   * **Affordance only, never an authorization boundary** — carried over verbatim from the
   * reference implementation's `lib/permissions.ts`, whose header is unusually clear about this
   * and worth repeating: a bug
   * here "can only show or hide a control; it cannot grant or block the underlying operation,
   * because every mutation and tool call is independently re-checked server-side". Do not let a
   * passing check here stand in for server-side authorization.
   */
  readonly permissions?: readonly string[];
}

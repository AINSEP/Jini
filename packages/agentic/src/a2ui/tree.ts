/**
 * @module tree
 *
 * Flattens the component adjacency list (`id -> ComponentInstance`, each instance's `children`
 * being an array of other ids) into an ordered, depth-first render list — the two adversarial
 * cases this exists to answer sanely: **a child id that doesn't exist** in the map, and **a
 * circular reference** (A -> B -> A). Neither may crash or infinite-loop a renderer; both must
 * degrade to a visible, inert placeholder node instead.
 *
 * Scope: only the *static array* form of `ChildList` (`common_types.json#/$defs/ChildList`'s
 * first `oneOf` branch) is walked here. The *template* form (`{componentId, path}`, generating N
 * children from a data-model list) is accepted by the wire schema (`ChildListSchema`) but not
 * expanded by this port — see `../source-map.md` for why (a distinct, substantially larger
 * rendering feature: item-scoped relative-path resolution, `@index`, per-item React keys for one
 * shared component definition rendered N times). A `getChildIds` callback that always returns
 * `[]` for a template-shaped `children` value is a safe, honest way to consume this module without
 * pretending template lists render.
 */
export interface ComponentLike {
  readonly id: string;
}

export type RenderNodeStatus = 'ok' | 'missing' | 'cycle';

export interface RenderNode {
  readonly id: string;
  readonly depth: number;
  readonly status: RenderNodeStatus;
}

/**
 * @param components The full component map (id -> instance).
 * @param rootId The id to start walking from (typically `'root'`, but not assumed — a surface
 * with no `root` component yet is the caller's concern, not this function's; see
 * `interpreter.ts`'s `getRoot()`).
 * @param getChildIds Given a present component, returns its child ids in render order (`[]` for
 * a leaf, or a template-shaped `ChildList` this port doesn't expand — see module doc).
 * @returns A depth-first, pre-order flattening. A `missing` node is a leaf in the output (its own
 * children are never visited — there is nothing to look up). A `cycle` node is also a leaf: the
 * id is emitted once more so a renderer can show *where* the cycle closes, but its children are
 * not walked again (that walk already happened higher up the same path).
 */
export function flattenRenderTree<C extends ComponentLike>(
  components: ReadonlyMap<string, C>,
  rootId: string,
  getChildIds: (component: C) => readonly string[],
): RenderNode[] {
  const output: RenderNode[] = [];

  function visit(id: string, depth: number, ancestors: ReadonlySet<string>): void {
    if (ancestors.has(id)) {
      output.push({ id, depth, status: 'cycle' });
      return;
    }
    const component = components.get(id);
    if (!component) {
      output.push({ id, depth, status: 'missing' });
      return;
    }
    output.push({ id, depth, status: 'ok' });
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    for (const childId of getChildIds(component)) {
      visit(childId, depth + 1, nextAncestors);
    }
  }

  visit(rootId, 0, new Set());
  return output;
}

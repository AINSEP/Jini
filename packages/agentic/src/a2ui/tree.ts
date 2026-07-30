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

export type RenderNodeStatus = 'ok' | 'missing' | 'cycle' | 'truncated';

export interface RenderNode {
  readonly id: string;
  readonly depth: number;
  readonly status: RenderNodeStatus;
}

/**
 * Ceiling on how many nodes one flattening may produce.
 *
 * The cycle check bounds *repetition along one path*; it does not bound the tree's size, and a
 * component map is an adjacency list, so a valid acyclic message can name the same child twice per
 * level and double the output at every step. Measured before this cap existed: 24 components —
 * a few hundred bytes of wire data — expanded to 16,777,215 render nodes in ~15 seconds. Nothing
 * crashed; the renderer was simply consumed.
 *
 * Far above any real UI (the largest component tree a catalog of 18 types could sensibly produce
 * is orders of magnitude smaller), so this is a fail-safe, not a design budget.
 */
export const MAX_RENDER_NODES = 50_000;

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
 * not walked again (that walk already happened higher up the same path). A `truncated` node is the
 * third such marker and always the last entry: the tree exceeded {@link MAX_RENDER_NODES} and the
 * rest was not walked.
 *
 * The walk is iterative — an explicit stack rather than recursion — because the component map is
 * agent-authored: a straight chain of components is a legal, acyclic message, and a recursive walk
 * died on one with `RangeError: Maximum call stack size exceeded` somewhere past 6,000 links.
 * Degrading sanely on hostile input is this module's whole purpose, and "deep" belongs on that
 * list next to "missing" and "circular".
 *
 * The ancestor set is maintained by push/pop along the current path rather than copied per node,
 * which is both what makes the iterative form equivalent (an ancestor set IS the path from the
 * root) and what removes the old walk's quadratic set-copying cost.
 */
export function flattenRenderTree<C extends ComponentLike>(
  components: ReadonlyMap<string, C>,
  rootId: string,
  getChildIds: (component: C) => readonly string[],
): RenderNode[] {
  const output: RenderNode[] = [];
  /** Ids on the path from the root to the node being visited — the recursive walk's `ancestors`. */
  const ancestors = new Set<string>();
  /** A node still to visit, or the marker that closes one and leaves its subtree. */
  type Frame = { readonly id: string; readonly depth: number } | { readonly leave: string };
  const stack: Frame[] = [{ id: rootId, depth: 0 }];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if ('leave' in frame) {
      ancestors.delete(frame.leave);
      continue;
    }
    if (output.length >= MAX_RENDER_NODES) {
      output.push({ id: frame.id, depth: frame.depth, status: 'truncated' });
      return output;
    }
    const { id, depth } = frame;
    if (ancestors.has(id)) {
      output.push({ id, depth, status: 'cycle' });
      continue;
    }
    const component = components.get(id);
    if (!component) {
      output.push({ id, depth, status: 'missing' });
      continue;
    }
    output.push({ id, depth, status: 'ok' });
    ancestors.add(id);
    stack.push({ leave: id });
    // Pushed in reverse so the first child is popped first, preserving pre-order.
    const childIds = getChildIds(component);
    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      stack.push({ id: childIds[index]!, depth: depth + 1 });
    }
  }

  return output;
}

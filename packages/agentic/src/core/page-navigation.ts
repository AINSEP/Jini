/** Published navigation metadata. Hosts own routes and entity lookup; this module only projects
 * validated destinations. Entity navigation never executes a follow-up control. */
export interface AgentEntityTarget {
  readonly type: string;
  readonly routeTemplate: string;
}
export interface AgentNavigationScreen {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly path: string;
  readonly routeTemplates: readonly string[];
  readonly allowedQueryParams: Readonly<Record<string, readonly string[] | null>>;
  readonly entityTargets: readonly AgentEntityTarget[];
}
export interface PageNavigationInput {
  readonly entity?: { readonly type: string; readonly id: string };
  readonly query?: Readonly<Record<string, string>>;
}
export interface ResolvedPageEntity {
  readonly params: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
  /** Search the destination's published controls, then click the discovered handle separately. */
  readonly control?: { readonly query: string; readonly role: 'button'; readonly intent: string };
}
export type PageEntityLookup = (required: { page: string; type: string; id: string }, optional?: Record<string, never>) => Promise<ResolvedPageEntity | null>;
export interface PageNavigationResult {
  readonly path: string;
  readonly nextAction?: ResolvedPageEntity['control'];
}

/** Reject unknown keys/values instead of letting route state choose an arbitrary destination.
 * @complexity O(q) in the small host-declared query, with O(q) output. */
function validatedQuery({ screen, query }: { screen: AgentNavigationScreen; query: Readonly<Record<string, string>> }, _options = {}): string {
  const result = new URLSearchParams(screen.path.split('?')[1]);
  for (const [key, value] of Object.entries(query)) {
    if (!Object.hasOwn(screen.allowedQueryParams, key)) throw new Error(`Query parameter "${key}" is not allowed on ${screen.id}`);
    const allowed = screen.allowedQueryParams[key];
    if (typeof value !== 'string' || (allowed && !allowed.includes(value))) throw new Error(`Invalid value for "${key}"`);
    result.set(key, value);
  }
  const text = result.toString();
  return text ? `?${text}` : '';
}

/** Encode each resolved identifier as one segment; traversal and ambiguous dot segments fail closed. */
function expandRoute({ template, params }: { template: string; params: Readonly<Record<string, string>> }, _options = {}): string {
  if (!template.startsWith('/') || template.startsWith('//') || /[?#\\]/.test(template)) throw new Error('Invalid published route template');
  return template.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_match, name: string) => {
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (!value || value === '.' || value === '..') throw new Error(`Missing or invalid route parameter "${name}"`);
    return encodeURIComponent(value);
  });
}

/** Resolve only entities explicitly published by this screen, through the host's lookup port.
 * @throws Unknown entities, missing records, invalid queries and unpublished destinations.
 * @complexity O(t + q + s), t declared targets, q query entries, s route/identifier length. */
export async function resolvePageNavigation(
  { screen, input }: { screen: AgentNavigationScreen; input: PageNavigationInput },
  { lookupEntity }: { lookupEntity?: PageEntityLookup } = {},
): Promise<PageNavigationResult> {
  if (!input.entity) return { path: `${screen.path.split('?')[0]}${validatedQuery({ screen, query: input.query ?? {} })}` };
  const target = screen.entityTargets.find(candidate => candidate.type === input.entity!.type);
  if (!target || !screen.routeTemplates.includes(target.routeTemplate)) throw new Error('This entity is not a published destination');
  if (!lookupEntity) throw new Error('Entity lookup is unavailable');
  const entity = await lookupEntity({ page: screen.id, ...input.entity });
  if (!entity) throw new Error(`Entity "${input.entity.id}" was not found`);
  const path = expandRoute({ template: target.routeTemplate, params: entity.params });
  const query = validatedQuery({ screen, query: { ...input.query, ...entity.query } });
  return { path: `${path}${query}`, ...(entity.control ? { nextAction: entity.control } : {}) };
}

/** Verify an explicit link against the very same screen map. No origin, traversal, or free query.
 * Entity links must first be resolved through resolvePageNavigation; this fallback accepts screens.
 * @complexity O(s + q), s screens and q query entries. */
export function validatePageLink(
  { screens, path, query = {} }: { screens: readonly AgentNavigationScreen[]; path: string; query?: Readonly<Record<string, string>> },
  _options = {},
): string {
  const segment = path.trim().replace(/^\/+/, '');
  // An empty segment would match the dashboard's root path instead of an explicit destination.
  if (!segment) throw new Error('Path must name a published admin screen');
  const screen = screens.find(candidate => candidate.id === segment || candidate.path.split('?')[0] === `/${segment}`);
  if (!screen) throw new Error('Not a published admin screen');
  return `${screen.path.split('?')[0]}${validatedQuery({ screen, query })}`;
}

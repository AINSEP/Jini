import type { GuideCaller, GuideContribution, GuideFact, GuideResult, GuideTopic, GuideTopicView, SiteGuide, SiteGuidePorts } from './types.js';

const MINIMAL_TOPICS: readonly GuideTopic[] = [{
  id: 'site', title: 'How this site works', summary: 'Learn the available building blocks before planning or building.',
  explanation: 'Read the live facts, then consult the host topics and their tools. Missing or forbidden facts are unknown, not disabled capabilities.',
  permissions: [], pointers: [], workflows: [],
}];

export class SiteGuideInputError extends Error {
  constructor({ message }: { readonly message: string }, _options: Record<string, never> = {}) { super(message); this.name = 'SiteGuideInputError'; }
}

/** Bound an injected read so an unavailable extension cannot hang learning. Always clear timers.
 * @complexity O(1) beyond the supplied read; rejection text is kept internal to the shell.
 */
async function boundedRead<T>(read: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(read), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('site guide read timed out')), timeoutMs);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Compose by topic id. Core cards keep their owner; plugins add distinct, permission-gated topics.
 * @complexity O(t) in bounded built-in and contributed topic counts, O(t) lookup space.
 */
function combineTopics(builtIns: readonly GuideTopic[], contributions: readonly GuideContribution[]) {
  const topics = new Map(builtIns.map(topic => [topic.id, { topic, source: 'core' }]));
  const byId = new Map<string, { topic: GuideTopic; pluginId: string }[]>();
  for (const contribution of contributions) {
    for (const topic of contribution.topics) {
      const candidates = byId.get(topic.id) ?? [];
      candidates.push({ topic, pluginId: contribution.pluginId });
      byId.set(topic.id, candidates);
    }
  }
  let conflicts = false;
  for (const [id, candidates] of byId) {
    // A contribution cannot replace a host's prose, pointers, workflows or security gates.
    if (topics.has(id) || candidates.length !== 1) { conflicts = true; continue; }
    const candidate = candidates[0]!;
    topics.set(id, { topic: candidate.topic, source: candidate.pluginId });
  }
  return { topics: [...topics.values()], conflicts };
}

/** Build a neutral read-only guide over host ports. No product state or plugin loader is ambient.
 * Authorization and contributions are read fresh for each request. Errors from enrichment/facts
 * yield explicit unavailable status without copying arbitrary error messages into model context.
 * @param ports - Facts, authorization, optional enrichment, and host minimal capability cards.
 * @returns One overview/explain service. Invalid input and hidden topics throw SiteGuideInputError.
 * @complexity O(t + p) per request, topics plus distinct permissions; one bulk facts read.
 * @example createSiteGuide({ facts, authorize, builtInTopics: cards }).run({ caller, operation: 'overview' });
 */
export function createSiteGuide(ports: SiteGuidePorts, options: { readonly readTimeoutMs?: number } = {}): SiteGuide {
  const timeoutMs = options.readTimeoutMs ?? 5_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new SiteGuideInputError({ message: 'readTimeoutMs must be a positive finite number' });
  const builtIns = ports.builtInTopics ?? MINIMAL_TOPICS;
  if (builtIns.length > 256 || new Set(builtIns.map(topic => topic.id)).size !== builtIns.length) throw new SiteGuideInputError({ message: 'Built-in topics must have unique ids and contain at most 256 cards' });
  return { async run(input, _options = {}): Promise<GuideResult> {
    assertGuideInput(input);
    const loaded = await loadContributions({ ports, caller: input.caller, timeoutMs });
    const combined = combineTopics(builtIns, loaded.contributions);
    const enrichment = combined.conflicts ? 'partial' : loaded.enrichment;
    const gate = createPermissionGate({ ports, caller: input.caller, timeoutMs });
    const views = await buildViews({ topics: combined.topics, input, permitted: gate.permitted });
    if (input.operation === 'explain' && views.length === 0) throw new SiteGuideInputError({ message: 'Topic unavailable. Call site_guide with operation overview for topics you may read.' });
    // Overview is discovery only; read fresh domain facts when a visible topic is explained.
    const facts = input.operation === 'explain' ? await readFacts({ ports, caller: input.caller, topicIds: views.map(view => view.id), timeoutMs }) : {};
    return { operation: input.operation, topics: views, facts, callerPermissions: await gate.granted(), enrichment };
  } };
}

type GuideInput = Parameters<SiteGuide['run']>[0];
type Permitted = (permissions: readonly string[]) => Promise<boolean>;

/** Refuses unknown operations, a topic on overview, and explain without a well-formed topic id. */
function assertGuideInput(input: GuideInput): void {
  if (input.operation !== 'overview' && input.operation !== 'explain') throw new SiteGuideInputError({ message: 'operation must be overview or explain' });
  if (input.operation === 'overview' && input.topic !== undefined) throw new SiteGuideInputError({ message: 'topic is only accepted with operation explain' });
  if (input.operation === 'explain' && (typeof input.topic !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.topic))) {
    throw new SiteGuideInputError({ message: 'explain requires a topic id from overview' });
  }
}

/** Reads plugin contributions within the deadline; any failure or over-limit result degrades to none. */
async function loadContributions({ ports, caller, timeoutMs }: { ports: SiteGuidePorts; caller: GuideCaller; timeoutMs: number }): Promise<{ contributions: readonly GuideContribution[]; enrichment: GuideResult['enrichment'] }> {
  if (!ports.loadContributions) return { contributions: [], enrichment: 'ok' };
  try {
    const loaded = await boundedRead(() => ports.loadContributions!({ caller }), timeoutMs);
    if (loaded.items.reduce((count, item) => count + item.topics.length, 0) > 256) throw new SiteGuideInputError({ message: 'Too many contributed topics' });
    return { contributions: loaded.items, enrichment: loaded.refusals.length ? 'partial' : 'ok' };
  } catch { return { contributions: [], enrichment: 'unavailable' }; }
}

/** Per-request authorization cache: each permission is asked at most once, in first-use order. */
function createPermissionGate({ ports, caller, timeoutMs }: { ports: SiteGuidePorts; caller: GuideCaller; timeoutMs: number }): { permitted: Permitted; granted: () => Promise<string[]> } {
  const decisions = new Map<string, Promise<boolean>>();
  const allowed = (permission: string): Promise<boolean> => {
    let decision = decisions.get(permission);
    if (!decision) {
      // Failed authorization is denial, never an excuse to expose a card or run its read.
      decision = boundedRead(() => ports.authorize({ caller, permission }), timeoutMs).catch(() => false);
      decisions.set(permission, decision);
    }
    return decision;
  };
  return {
    permitted: async permissions => (await Promise.all(permissions.map(allowed))).every(Boolean),
    granted: async () => {
      const callerPermissions = [];
      for (const [permission, decision] of decisions) if (await decision) callerPermissions.push(permission);
      return callerPermissions;
    },
  };
}

/** Visible cards in topic order; explain narrows to the requested id and adds its permitted details. */
async function buildViews({ topics, input, permitted }: { topics: readonly { topic: GuideTopic; source: string }[]; input: GuideInput; permitted: Permitted }): Promise<GuideTopicView[]> {
  const views: GuideTopicView[] = [];
  for (const entry of topics) {
    if (input.operation === 'explain' && entry.topic.id !== input.topic) continue;
    if (!await permitted(entry.topic.permissions)) continue;
    const view: GuideTopicView = { id: entry.topic.id, title: entry.topic.title, summary: entry.topic.summary, source: entry.source };
    views.push(input.operation === 'explain' ? await explainView({ view, topic: entry.topic, permitted }) : view);
  }
  return views;
}

async function explainView({ view, topic, permitted }: { view: GuideTopicView; topic: GuideTopic; permitted: Permitted }): Promise<GuideTopicView> {
  const pointers = await withoutForbidden({ items: topic.pointers, permitted });
  const workflows = await withoutForbidden({ items: topic.workflows, permitted });
  return { ...view, explanation: topic.explanation, pointers, workflows };
}

/** Keeps items whose permissions are all granted, asked one item at a time, minus their gates. */
async function withoutForbidden<T extends { readonly permissions: readonly string[] }>({ items, permitted }: { items: readonly T[]; permitted: Permitted }): Promise<Omit<T, 'permissions'>[]> {
  const kept: Omit<T, 'permissions'>[] = [];
  for (const { permissions, ...item } of items) if (await permitted(permissions)) kept.push(item);
  return kept;
}

/** One bulk facts read for the visible topics; failure marks each of them unavailable. */
async function readFacts({ ports, caller, topicIds, timeoutMs }: { ports: SiteGuidePorts; caller: GuideCaller; topicIds: readonly string[]; timeoutMs: number }): Promise<Readonly<Record<string, GuideFact>>> {
  try {
    const read = await boundedRead(() => ports.facts.read({ caller, topics: topicIds }), timeoutMs);
    // A facts adapter returning an unrelated section cannot disclose it through this tool.
    return Object.fromEntries(topicIds.map(id => [id, read[id] ?? { status: 'unavailable' }]));
  } catch { return Object.fromEntries(topicIds.map(id => [id, { status: 'unavailable' }])); }
}

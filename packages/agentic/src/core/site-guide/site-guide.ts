import type { GuideContribution, GuideFact, GuideResult, GuideTopic, GuideTopicView, SiteGuide, SiteGuidePorts } from './types.js';

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
    if (input.operation !== 'overview' && input.operation !== 'explain') throw new SiteGuideInputError({ message: 'operation must be overview or explain' });
    if (input.operation === 'overview' && input.topic !== undefined) throw new SiteGuideInputError({ message: 'topic is only accepted with operation explain' });
    if (input.operation === 'explain' && (typeof input.topic !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.topic))) {
      throw new SiteGuideInputError({ message: 'explain requires a topic id from overview' });
    }
    let contributions: readonly GuideContribution[] = [];
    let enrichment: GuideResult['enrichment'] = 'ok';
    if (ports.loadContributions) {
      try {
        const loaded = await boundedRead(() => ports.loadContributions!({ caller: input.caller }), timeoutMs);
        if (loaded.items.reduce((count, item) => count + item.topics.length, 0) > 256) throw new SiteGuideInputError({ message: 'Too many contributed topics' });
        contributions = loaded.items;
        if (loaded.refusals.length) enrichment = 'partial';
      } catch { enrichment = 'unavailable'; }
    }
    const combined = combineTopics(builtIns, contributions);
    if (combined.conflicts) enrichment = 'partial';
    const decisions = new Map<string, Promise<boolean>>();
    const allowed = (permission: string): Promise<boolean> => {
      let decision = decisions.get(permission);
      if (!decision) {
        // Failed authorization is denial, never an excuse to expose a card or run its read.
        decision = boundedRead(() => ports.authorize({ caller: input.caller, permission }), timeoutMs).catch(() => false);
        decisions.set(permission, decision);
      }
      return decision;
    };
    const permitted = async (permissions: readonly string[]) => (await Promise.all(permissions.map(allowed))).every(Boolean);
    const views: GuideTopicView[] = [];
    for (const entry of combined.topics) {
      if (input.operation === 'explain' && entry.topic.id !== input.topic) continue;
      if (!await permitted(entry.topic.permissions)) continue;
      const view: GuideTopicView = { id: entry.topic.id, title: entry.topic.title, summary: entry.topic.summary, source: entry.source };
      if (input.operation === 'explain') {
        const pointers = [];
        for (const { permissions, ...pointer } of entry.topic.pointers) if (await permitted(permissions)) pointers.push(pointer);
        const workflows = [];
        for (const { permissions, ...workflow } of entry.topic.workflows) if (await permitted(permissions)) workflows.push(workflow);
        views.push({ ...view, explanation: entry.topic.explanation, pointers, workflows });
      } else views.push(view);
    }
    if (input.operation === 'explain' && views.length === 0) throw new SiteGuideInputError({ message: 'Topic unavailable. Call site_guide with operation overview for topics you may read.' });
    let facts: Readonly<Record<string, GuideFact>> = {};
    const topicIds = views.map(view => view.id);
    // Overview is discovery only; read fresh domain facts when a visible topic is explained.
    if (input.operation === 'explain') {
      try {
        const read = await boundedRead(() => ports.facts.read({ caller: input.caller, topics: topicIds }), timeoutMs);
        // A facts adapter returning an unrelated section cannot disclose it through this tool.
        facts = Object.fromEntries(topicIds.map(id => [id, read[id] ?? { status: 'unavailable' }]));
      } catch { facts = Object.fromEntries(topicIds.map(id => [id, { status: 'unavailable' }])); }
    }
    const callerPermissions = [];
    for (const [permission, decision] of decisions) if (await decision) callerPermissions.push(permission);
    return { operation: input.operation, topics: views, facts, callerPermissions, enrichment };
  } };
}

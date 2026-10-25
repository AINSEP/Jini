/** Read display context from a standalone form; its host may not have emitted a tool call. */
import { parseUIResource, readActionPlan, type UIResource } from '@jini-ai/ui/mcp-ui';
import { useMemo, useRef } from 'react';
import type { AgentEvent } from '../../core/events.js';
import type { AcceptedInputProjectionOptions } from '../../core/accepted-input.js';
import { useExtEventGroups } from '../hooks/useExtEventGroups.js';
import { useExtEventRendererRegistry } from '../hooks/context.js';

/** Feed recovered form context into the existing receipt projection, including after history reload.
 * Grouping owns tool/surface association; this hook only supplies missing presentation context.
 * @complexity O(e + h + c) for events, parsed HTML and controls; no mutation or I/O.
 */
export function useSurfaceAnswerContexts({ events }: { events: AgentEvent[] | undefined }, _options = {}): AcceptedInputProjectionOptions {
  const registry = useExtEventRendererRegistry();
  const groups = useExtEventGroups({ events }, { slotOf: (name, data) => registry.slot({ name, data }) });
  const cache = useRef(new Map<unknown, { sourceInput: unknown; context: { input: unknown; includeTitle: boolean } }>());
  return useMemo(() => ({ answerContexts: new Map(groups.flatMap(group => {
    if (group.name !== 'mcp-ui' || group.call?.id === undefined) return [];
    // Retain the question that offered the values, even when a later document shows its outcome.
    const data = group.events[0];
    let cached = cache.current.get(data);
    if (cached === undefined || cached.sourceInput !== group.call.input) {
      const input = surfaceQuestionInput({ resource: parseUIResource(data), input: group.call.input });
      cached = { sourceInput: group.call.input, context: { input, includeTitle: input !== group.call.input } };
      cache.current.set(data, cached);
    }
    return [[group.call.id, cached.context] as const];
  })) }), [groups]);
}

/** Parse inert markup only: never mount the document, execute scripts or read callback secrets.
 * @returns Title and offered labels in the existing question-answer input shape.
 * @complexity O(h + c) time/space for HTML length h and choice controls c; no I/O.
 */
export function surfaceQuestionInput(
  { resource, input }: { resource: UIResource | undefined; input: unknown }, _options = {},
): unknown {
  if (hasQuestionOptions({ input })) return input;
  if (resource === undefined || typeof DOMParser === 'undefined') return input;
  const { title, options } = markupQuestion({ resource });
  if (!title && options.length === 0) return input;
  // The call's explicit question remains authoritative. Markup fills the standalone form's gap.
  return { title, options, ...(typeof input === 'object' && input !== null ? input : {}) };
}

/** The title and offered choices an inert parse of the surface document shows. */
function markupQuestion({ resource }: { resource: UIResource }, _options = {}) {
  const document = new DOMParser().parseFromString(resource.resource.text, 'text/html');
  const title = readActionPlan(resource)?.title ?? document.querySelector('h1')?.textContent?.trim();
  const labels = new Map([...document.querySelectorAll('label')].map(label => [label.htmlFor, label.textContent?.trim() ?? '']));
  const options = [...document.querySelectorAll<HTMLInputElement | HTMLOptionElement>(
    'input[type="radio"], input[type="checkbox"], option',
  )].map(control => ({ value: control.value, label: optionText({ labels, control }) }));
  return { title, options };
}

/** Explicit question options already belong to the shared answer mapper; no markup fallback needed. */
function hasQuestionOptions({ input }: { input: unknown }, _options = {}): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const question = input as Record<string, unknown>;
  return [question, question.singleSelect, question.multiSelect].some(group =>
    typeof group === 'object' && group !== null && Array.isArray((group as Record<string, unknown>).options));
}

/** Resolve native label associations without interpolating caller-controlled ids into selectors. */
function optionText({ labels, control }: {
  labels: ReadonlyMap<string, string>; control: HTMLInputElement | HTMLOptionElement;
}, _options = {}): string {
  if (control.tagName === 'OPTION') return control.textContent?.trim() ?? '';
  return labels.get(control.id) ?? control.closest('label')?.textContent?.trim() ?? '';
}

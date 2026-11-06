import { useId } from 'react';
import type { AgentAttrsPort, AgentSpec, KitAttrs } from '../attrs.js';
import { secretControlAttrs } from '../attrs.js';
import { useKitContext } from './context.js';
import type { BaseProps } from './types.js';

/** Local identity encoding keeps the UI contract independent of any agent runtime.
 * Compatible with the agent handle segment grammar; opaque ids use a bounded fingerprint.
 * @complexity O(n) time in id length, O(1) auxiliary space. No effects. */
function handleSegment({ value }: { value: string }): string {
  if (value.length <= 40 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && !/^h-[0-9a-f]{16}$/.test(value)) return value;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * 0x100000001b3n);
  return `h-${hash.toString(16).padStart(16, '0')}`;
}
function ordinaryAttrs({ attrs = {} }: { attrs?: KitAttrs | undefined }): KitAttrs {
  return Object.fromEntries(Object.entries(attrs).filter(([key]) => !key.toLowerCase().startsWith('data-agent-')));
}
function definedAttrs({ attrs = {} }: { attrs?: KitAttrs | undefined }): KitAttrs {
  return Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== undefined));
}
function publishedAttrs({ handle, agent, role, label }: { handle: string; agent?: AgentAttrsPort | undefined; role?: AgentSpec['role'] | undefined; label?: string | undefined }): KitAttrs {
  return agent ? agent({ handle }, { ...(role === undefined ? {} : { role }), ...(label === undefined ? {} : { label }) }) : { 'data-agent-element': handle, 'data-agent-role': role, 'data-agent-label': label };
}
function controlHandle({ props, id, options }: { props: BaseProps; id: string; options: { enabled?: boolean; part: string } }): string | undefined {
  const supplied = props.attrs?.['data-agent-element'];
  if (typeof supplied === 'string') return supplied;
  if (typeof props.agentHandle === 'string') return props.agentHandle;
  return options.enabled === false ? undefined : `kit-${handleSegment({ value: id })}-${options.part}`;
}
/** Resolves one mounted control's metadata. Privacy and opt-out override caller addressing;
 * supplied handles are preserved, while defaults use React instance identity rather than labels.
 * @complexity O(p + i) in attribute count and React id length; no I/O or persistent state. */
export function useControlAttrs(required: BaseProps, optional: {
  part: string; role?: AgentSpec['role'] | undefined; label?: string | undefined; enabled?: boolean; secret?: boolean;
}): KitAttrs {
  const id = useId(), context = useKitContext({});
  if (optional.secret || required.attrs?.['data-agent-private'] !== undefined) return secretControlAttrs({ attrs: required.attrs ?? {} });
  if (required.agentHandle === false) return ordinaryAttrs({ attrs: required.attrs });
  const handle = controlHandle({ props: required, id, options: optional });
  if (handle === undefined) return required.attrs ?? {};
  return { ...publishedAttrs({ handle, agent: context?.agent, role: optional.role, label: optional.label }), ...definedAttrs({ attrs: required.attrs }) };
}
/** Derives one actual control from a composite base and stable item/action id, retaining page metadata.
 * Explicit item attributes remain authoritative; opt-out removes addressing at every leaf.
 * @complexity O(p + a) in attribute count and action id length, without I/O. */
export function childControlAttrs(required: { parent: BaseProps; attrs: KitAttrs; action: string }, optional: { attrs?: KitAttrs | undefined; label?: string | undefined; role?: AgentSpec['role'] | undefined } = {}): KitAttrs {
  const combined = { ...required.attrs, ...optional.attrs };
  if (required.attrs['data-agent-private'] !== undefined || optional.attrs?.['data-agent-private'] !== undefined) return secretControlAttrs({ attrs: combined });
  if (required.parent.agentHandle === false) return ordinaryAttrs({ attrs: combined });
  const base = required.attrs['data-agent-element'];
  if (typeof base !== 'string') return optional.attrs ?? {};
  const root = base.length > 80 ? handleSegment({ value: base }) : base;
  return { 'data-agent-element': `${root}-${handleSegment({ value: required.action })}`, 'data-agent-page': required.attrs['data-agent-page'],
    'data-agent-role': optional.role ?? 'button', 'data-agent-label': optional.label, ...definedAttrs({ attrs: optional.attrs }) };
}

/**
 * TEST-ONLY: a ChatKit made of plain elements, plus render helpers that mount it, so chat's own
 * output is tested without a UI library or an agent runtime behind it. What the REAL kit does (the
 * ui brand icons, the real tooltip bubble, the real model rules) is the host binding's to prove.
 */
import { createElement, useId, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { render as renderOriginal, renderHook as renderHookOriginal, type RenderOptions, type RenderResult } from '@testing-library/react';
import { agentHandleSegment } from '@jini-ai/core/agent-handles';
import type { RuntimeModelOption, RuntimeReasoningOption } from '@jini-ai/core/contracts/agents';
import type { ChatAgentPolicyPort } from '../../core/agents-port.js';
import { ChatKitProvider, type ChatFileDropTarget, type ChatInfoTipController, type ChatKit, type ChatKitComponents, type ChatKitHooks } from '../kit.js';
import { ChatSurfacesProvider, type ChatSurfaces } from '../surfaces.js';

export * from '@testing-library/react';

/** The alias / routing-mode vocabulary the real model rules use, restated as a table the fake owns. */
const ROUTING_MODE = /^(default|auto|adaptive|smart|deep|rush|ultimate|premium|balanced|fast|vercel-ai-gateway|grok-build)$/i;
const ALIAS = /^(opus|sonnet|haiku|fable|best|latest|claude|gemini|gpt|codex|swe)(?:\[.*\])?$/i;

/** A deterministic `ChatAgentPolicyPort`: same contract as the agent runtime's rules, none of its code. */
export function fakeAgentPolicy(_required = {}, _optional: Record<string, never> = {}): ChatAgentPolicyPort {
  const modelIdentityKind: ChatAgentPolicyPort['modelIdentityKind'] = ({ id }) => {
    const token = id.slice(id.lastIndexOf('/') + 1);
    if (ROUTING_MODE.test(token) || /(?:^|[-/])gateway$/i.test(id)) return 'routing-mode';
    return ALIAS.test(token) || /(?:^|[-/])latest$/i.test(id) ? 'alias' : 'concrete';
  };
  const concreteId = (row: RuntimeModelOption): string | undefined => {
    const id = row.resolvedId || (row.identityKind === 'routing-mode' || row.identityKind === 'alias' ? undefined : row.id);
    return id && modelIdentityKind({ id }) === 'concrete' ? id : undefined;
  };
  const concreteModelOptions: ChatAgentPolicyPort['concreteModelOptions'] = ({ models = [], supportsConcreteModelSelection, defaultModelResolution }) => {
    if (supportsConcreteModelSelection === false) return [];
    const choices = new Map<string, RuntimeModelOption>();
    for (const row of models) {
      const id = concreteId(row);
      if (!id) continue;
      // Older cached inventories attach a default-policy label to a resolved concrete id: the id is the label then.
      const label = row.id === 'default' || /^default\b/i.test(row.label) ? id : row.label;
      const kept = choices.get(id);
      if (!kept) choices.set(id, { ...row, id, label, identityKind: 'concrete' });
      else if (kept.label === id && label !== id) choices.set(id, { ...kept, label });
    }
    const options = [...choices.values()];
    const hidden = defaultModelResolution?.status === 'resolved' ? defaultModelResolution.id : undefined;
    if (hidden && !choices.has(hidden) && modelIdentityKind({ id: hidden }) === 'concrete') options.unshift({ id: hidden, label: hidden, identityKind: 'concrete' });
    return options;
  };
  const modelReasoningOptions: ChatAgentPolicyPort['modelReasoningOptions'] = ({ agent, model }) => {
    if (agent.reasoningInModelId) return [];
    const advertised = agent.reasoningOptions ?? [];
    const choices = new Map<string, RuntimeReasoningOption>();
    const fallback = advertised.find(option => option.id === 'default');
    if (fallback) choices.set(fallback.id, fallback);
    for (const level of model?.reasoning ?? advertised) if (!choices.has(level.id)) choices.set(level.id, level);
    return [...choices.values()];
  };
  // Refuses only an agent that declares it needs full CLI access while the policy asks for less.
  const assessNativeToolPolicy: ChatAgentPolicyPort['assessNativeToolPolicy'] = ({ def, policy }) =>
    def.fullCliAccessOnly && policy.nativeToolAccess === false ? `${def.name} needs full computer access.` : null;
  return { modelIdentityKind, concreteModelOptions, modelReasoningOptions, assessNativeToolPolicy };
}

/** Roving-tabindex keyboard contract of a tab strip: Left/Right move to the neighbour and select it. */
const FakeTabBar: ChatKitComponents['TabBar'] = ({ tabs, activeId, onChange, ariaLabel }) => {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (!step || !next) return;
    event.preventDefault();
    onChange(next.id);
    (event.currentTarget.parentElement?.querySelectorAll('button')[tabs.indexOf(next)] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => (
        <button key={tab.id} type="button" role="tab" aria-selected={tab.id === activeId} disabled={tab.disabled} onKeyDown={event => move(event, index)} onClick={() => onChange(tab.id)}>{tab.icon}{tab.label}</button>
      ))}
    </div>
  );
};

/** Reveals its label on hover, keyboard focus or press; named by `triggerLabel` (and described by `label`) when one is given. */
const FakeInfoTip: ChatKitComponents['InfoTip'] = ({ label, triggerLabel, descriptionId, icon }) => {
  const [open, setOpen] = useState(false);
  const pressing = useRef(false);
  const ownId = useId();
  const describedBy = descriptionId ?? (triggerLabel ? `${ownId}-description` : undefined);
  return (
    <>
      <button type="button" className="info-tip-icon" aria-label={triggerLabel ?? label} aria-describedby={describedBy} aria-expanded={open}
        onPointerDown={() => { pressing.current = true; }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => { if (!pressing.current) setOpen(true); }} onBlur={() => { pressing.current = false; setOpen(false); }}
        onClick={() => { pressing.current = false; setOpen(value => !value); }}>{icon}</button>
      {open ? <span className="info-tip-bubble" role="tooltip" aria-hidden="true">{label}</span> : null}
      {describedBy ? <span id={describedBy} hidden>{label}</span> : null}
    </>
  );
};

/** A masked field with the show/hide toggle the contract promises, named from `toggleLabels`. */
function FakeSecret({ label, toggleLabels, as: Tag, ...rest }: { label: string; toggleLabels?: { show: string; hide: string } | undefined; as: 'input' | 'textarea' } & Record<string, unknown>) {
  const [shown, setShown] = useState(false);
  const name = (rest['aria-label'] as string | undefined) ?? label;
  const field = Tag === 'input' ? <input {...rest} type={shown ? 'text' : 'password'} aria-label={name} /> : <textarea {...rest} aria-label={name} data-masked={!shown} />;
  return <>{field}<button type="button" aria-label={shown ? toggleLabels?.hide : toggleLabels?.show} onClick={() => setShown(value => !value)} /></>;
}

/** A trigger that opens a listbox of the models and reports the picked one. */
const FakeModelSelect: ChatKitComponents['SearchableModelSelect'] = ({ models, value, onChange, ariaLabel, menuClassName }) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)}>{models.find(model => model.id === value)?.label ?? value}</button>
      {open ? <ul role="listbox" aria-label={ariaLabel} className={menuClassName}>
        {models.map(model => <li key={model.id} role="option" aria-selected={model.id === value} onClick={() => { onChange(model.id); setOpen(false); }}>{model.label}</li>)}
      </ul> : null}
    </div>
  );
};

/** A trigger that opens a panel with "pick" and a recent-folders list, calling the host's callbacks as the contract says. */
const FakeWorkingDirPicker: ChatKitComponents['WorkingDirPicker'] = ({ workingDir, recentDirs, labels, onPickDirectory, onSelectRecent, onClear, onOpen, invalid }) => {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="working-dir-picker" data-invalid={invalid ? 'true' : undefined}>
      <button type="button" data-testid="working-dir-trigger" aria-label={labels?.trigger} aria-expanded={open}
        onClick={() => { if (!open) onOpen?.(); setOpen(value => !value); }}>{workingDir ?? labels?.trigger ?? 'Select working directory'}</button>
      {open ? <div role="menu">
        <button type="button" role="menuitem" data-testid="working-dir-pick" onClick={() => { onPickDirectory(); setOpen(false); }}>{labels?.pick ?? 'Choose folder'}</button>
        <div data-testid="working-dir-recent">{recentDirs.map(dir => <button key={dir} type="button" role="menuitem" title={dir} onClick={() => { onSelectRecent(dir); setOpen(false); }}>{dir}</button>)}</div>
        {workingDir && onClear ? <button type="button" role="menuitem" data-testid="working-dir-clear" onClick={() => { onClear(); setOpen(false); }}>{labels?.clear ?? 'Clear'}</button> : null}
      </div> : null}
    </div>
  );
};

const components: ChatKitComponents = {
  TabBar: FakeTabBar,
  InfoTip: FakeInfoTip,
  RemixIcon: ({ name, size, className }) => <i data-icon={name} data-size={size} className={className} />,
  AgentIcon: ({ id, size, className, basePath }) => <i data-agent-icon={id} data-size={size} data-base-path={basePath} className={className} />,
  SecretInput: props => <FakeSecret {...props} as="input" />,
  SecretTextarea: props => <FakeSecret {...props} as="textarea" />,
  SearchableModelSelect: FakeModelSelect,
  WorkingDirPicker: FakeWorkingDirPicker,
};

/** Drag state and drop reading by the contract: a file drag-over is accepted as a copy, enter/leave toggle
 * `draggingFiles`, and a drop hands over `dataTransfer.files` (folder expansion is the real hook's). */
function useFakeFileDropTarget(onUploadFiles: (files: File[]) => void): ChatFileDropTarget {
  const [draggingFiles, setDragging] = useState(false);
  return {
    draggingFiles, dropReadError: null, clearDropReadError: () => {},
    onDragEnter: event => { event.preventDefault(); setDragging(true); },
    onDragOver: event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: () => setDragging(false),
    onDrop: event => {
      event.preventDefault();
      setDragging(false);
      const files = Array.from((event.dataTransfer?.files ?? []) as ArrayLike<File>);
      if (files.length) onUploadFiles(files);
    },
  };
}

/** An info-tip controller whose open state follows show/hide; `placement` is where the caller asked for it. */
function useFakeInfoTip(_required = {}, { placement }: { placement?: 'top' | 'bottom' | undefined } = {}): ChatInfoTipController {
  const [open, setOpen] = useState(false);
  const iconRef = useRef<HTMLSpanElement | null>(null);
  return {
    open, placement: placement === 'bottom' ? 'below' : 'above', coords: { top: 0, left: 0 }, iconRef,
    show: () => setOpen(true), hide: () => setOpen(false), leave: () => setOpen(false), toggle: () => setOpen(value => !value),
    handleIconKeyDown: () => {},
  };
}

const hooks: ChatKitHooks = {
  useAgentHandle: ({ agentHandle }) => {
    const id = useId();
    return agentHandle === false ? undefined : agentHandle ?? `fake-${agentHandleSegment({ value: id })}`;
  },
  useOverlayContainer: () => document.body,
  useInfoTip: useFakeInfoTip,
  useFileDropTarget: useFakeFileDropTarget,
  useFocusTrap: () => {},
};

/** A complete fake kit; pass overrides to change one slot or the policy for a single test. */
export function fakeChatKit(overrides: Partial<ChatKit> = {}, _optional: Record<string, never> = {}): ChatKit {
  return { components: { ...components }, hooks: { ...hooks }, styles: { infoTipBubbleStyle: ({ top, left }) => ({ top, left }) }, agents: fakeAgentPolicy(), ...overrides };
}

interface KitRenderOptions { readonly kit?: ChatKit; readonly surfaces?: ChatSurfaces }
function scope({ kit, surfaces, wrapper }: { kit: ChatKit; surfaces?: ChatSurfaces | undefined; wrapper?: ComponentType<{ children: ReactNode }> | undefined }) {
  return function ChatKitScope({ children }: { children: ReactNode }) {
    const inner = wrapper ? createElement(wrapper, { children }) : children;
    return createElement(ChatKitProvider, { kit, children: surfaces ? createElement(ChatSurfacesProvider, { surfaces, children: inner }) : inner });
  };
}

/** `render` with the fake kit mounted (and `surfaces`, when given), as a host mounts its own at each root. */
export function render(ui: ReactNode, options: Omit<RenderOptions, 'queries'> & KitRenderOptions = {}): RenderResult {
  const { kit = fakeChatKit(), surfaces, wrapper, ...rest } = options;
  return renderOriginal(ui, { ...rest, wrapper: scope({ kit, surfaces, wrapper }) });
}
export const renderHook: typeof renderHookOriginal = (callback, options) => renderHookOriginal(callback, { ...options, wrapper: scope({ kit: fakeChatKit(), wrapper: options?.wrapper }) });

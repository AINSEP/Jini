/**
 * @module @jini/ui/features/agent-tools/types
 *
 * The declarative attribute convention `useDeclarativeAgentTargets` scans for. Deliberately an
 * explicit, author-opted-in allowlist — never a model-supplied CSS selector or `evalJavaScript` —
 * matching `ai-control-plane.md` §24's anti-pattern list and the prior-art precedent it cites
 * (`open-design-agentic`'s `ui.click`/`ui.fill` resolving only `data-agent-target=`/
 * `data-agent-field=`, never `document.querySelector(<model-supplied selector>)`).
 */

/** Marks a clickable/scrollable element the agent may target by name, e.g. `<button data-agent-target="submit">`. */
export const AGENT_TARGET_ATTR = 'data-agent-target';
/** Marks a form/text field the agent may read or set by name. */
export const AGENT_FIELD_ATTR = 'data-agent-field';
/** Marks the root of a declarative form scope; field/action names are only resolved within it. */
export const AGENT_FORM_ATTR = 'data-agent-form';
/** Marks a form's submit control, resolved relative to its enclosing `data-agent-form` root. */
export const AGENT_ACTION_ATTR = 'data-agent-action';

export interface AgentToolInputSchema {
  readonly type: 'object';
  readonly properties: Record<string, { type: string; description?: string }>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

/** One imperative or declarative-scan-derived tool registration, in the same shape `@jini/chat-react`'s chat capabilities use. */
export interface AgentToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: AgentToolInputSchema;
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/** @file Agent handles: the `data-agent-*` markup convention and the handle grammar. Pure data, no DOM. */
export { agentHandle, agentHandleSegment, agentSubHandle, agentHandleProps } from './handle.js';
export type { AgentHandleOptions, AgentHandleProps, AgentHandlePropsOptions } from './handle.js';
export { buildAgentListHandles } from './list-handles.js';
export { AGENT_ELEMENT_ATTRIBUTE, AGENT_ROLE_ATTRIBUTE, AGENT_LABEL_ATTRIBUTE, AGENT_PAGE_ATTRIBUTE, AGENT_PRIVATE_ATTRIBUTE, AGENT_ELEMENT_ROLES, isValidElementHandle, resolveHandleSelector } from './element-handles.js';
export type { AgentElementRole, AgentElementDescriptor, AgentElementState, AgentElementRawState } from './element-handles.js';
export type { FieldDescriptor } from './field-descriptor.js';
export { secretControlAttrs } from './secret-attrs.js';

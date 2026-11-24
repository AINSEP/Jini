import type { AdminAgentPluginDto, AdminAgentPluginRow } from '../contracts/site/cms-agent-plugins.js';

/** @file Compile-time proof: every key of the client row exists on the server DTO (drift fails `tsc`). */
type Missing = Exclude<keyof AdminAgentPluginRow, keyof AdminAgentPluginDto>;
export const rowKeysFitDto: [Missing] extends [never] ? true : never = true;

/** A host narrows the value sets without redefining the row. */
export const narrowed: AdminAgentPluginRow<'a' | 'b'>['maturity'] = 'a';

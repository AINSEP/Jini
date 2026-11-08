import { createMailSelection, type MailSelectionInput, type MailSelectionPorts } from "./selection.js";
/** Bind selection to the same live mailer instance that the host policy and operations use.
 * @agent-note The host supplies its resolved mailer and operations; this glue performs no I/O at boot.
 * @complexity O(1) construction, preserving the resolved instance's cache and readiness owner.
 */
export function createHostMailer<Resolved extends { ready: Promise<unknown>; invalidate(): void }, Operations, Input extends MailSelectionInput, Written extends { enabled: boolean }>(
 required: { resolved: Resolved; operations: Operations; selection: Omit<MailSelectionPorts<Input, Written>, "mailerReady" | "invalidate"> },
 _optional: Record<string,never> = {},
) {
 const selection = createMailSelection({ ...required.selection, mailerReady: required.resolved.ready, invalidate: required.resolved.invalidate });
 return { ...required.resolved, ...selection, operations: required.operations };
}

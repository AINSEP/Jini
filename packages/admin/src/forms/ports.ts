import { adminPort } from '../core/module/token.js';
import type { AdminFormsPort } from '../core/ports/forms.js';
import type { AdminShellNavigationPort } from '../core/ports/shell.js';
export type { AdminFormsPort } from '../core/ports/forms.js';
/** Reversible removal delegates to the host's existing generic Trash service.
 * This projection preserves the screens' generic POST for definitions and submissions; the
 * core API also exposes the form-scoped submission DELETE route with the same Trash semantics. */
export interface FormsTrashPort {
  trash(required: { type: 'form' | 'form_submission'; id: string }, optional?: Record<string, never>): Promise<{ ok: true; version: number | null }>;
}
export interface FormsEventsPort {
  subscribe(required: { onRefresh: () => void }, optional?: Record<string, never>): () => void;
}
export type FormsNavigationPort = Pick<AdminShellNavigationPort, 'navigate'>;
export const formsApiToken = adminPort<AdminFormsPort, 'admin.forms.api'>({ id: 'admin.forms.api' });
export const formsTrashToken = adminPort<FormsTrashPort, 'admin.forms.trash'>({ id: 'admin.forms.trash' });
export const formsEventsToken = adminPort<FormsEventsPort, 'admin.forms.events'>({ id: 'admin.forms.events' });
export const formsNavigationToken = adminPort<FormsNavigationPort, 'admin.forms.navigation'>({ id: 'admin.forms.navigation' });

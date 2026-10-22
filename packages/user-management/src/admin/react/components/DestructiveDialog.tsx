import { ConfirmDialog } from '@jini-ai/ui-kit/react';
import type { ConfirmDialogProps } from '@jini-ai/ui-kit/react';
/** Kept mounted on the shell: closing a row menu must not discard its pending confirmation.
 * Both the frame and its controls are host-overridable through ui-kit. */
export function DestructiveDialog(props: ConfirmDialogProps, _optional: Record<string, never> = {}) { return <ConfirmDialog {...props}/>; }

import { ConfirmDialog } from '@jini-ai/ui-kit/react';
import { useMembersConfirmation } from '../hooks/MembersPage.hooks.js';
export function MembersConfirmation(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const props = useMembersConfirmation({}); return <ConfirmDialog {...props}/>;
}

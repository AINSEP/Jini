import { ConfirmDialog } from '@jini-ai/ui-kit/react';
import { useMembersConfirmation } from '../hooks/MembersPage.hooks.js';
export function MembersConfirmation({ useMembersConfirmationHook = useMembersConfirmation }: { useMembersConfirmationHook?: typeof useMembersConfirmation } = {}, _optional: Record<string, never> = {}) {
  const props = useMembersConfirmationHook({}); return <ConfirmDialog {...props}/>;
}

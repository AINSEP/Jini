import { ConfirmDialog } from '@jini-ai/ui-kit/react';
import { useMembersConfirmation as useMembersConfirmation_ } from '../hooks/MembersPage.hooks.js';
export function MembersConfirmation({ useMembersConfirmation = useMembersConfirmation_ }: { useMembersConfirmation?: typeof useMembersConfirmation_ } = {}) {
  const props = useMembersConfirmation({}); return <ConfirmDialog {...props}/>;
}

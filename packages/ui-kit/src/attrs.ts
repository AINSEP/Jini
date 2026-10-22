/** Opaque host metadata. Implementations must spread it onto the documented focus target. */
export type KitAttrs = Readonly<{ id?: string; 'data-jini-part'?: string }> &
  Readonly<Partial<Record<`data-${string}` | `aria-${string}`, string | number | boolean | undefined>>>;
export interface AgentSpec { readonly handle: string; readonly role: 'button' | 'field' | 'select'; readonly label: string }
/** The host owns handle validation and its agent runtime; this package never imports one. */
export type AgentAttrsPort = (required: { handle: string }, optional?: { role?: AgentSpec['role']; label?: string }) => KitAttrs;

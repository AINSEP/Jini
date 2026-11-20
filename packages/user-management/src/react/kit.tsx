/**
 * @file The UI contract every @jini-ai/user-management React screen renders through. This package
 * imports no `ui` or `admin` component for these seams (owner 2026-11-15: everything injected): it
 * states the four components and five hooks it renders with, with only the props it passes, and the
 * host supplies them once via <UserManagementKitProvider kit={...}>. Shapes are local copies, so this
 * package's published types pin no UI library; the host proves compatibility with
 * `const kit = {...} satisfies UserManagementKit`, so a prop change in a UI library fails the host's
 * typecheck at that line.
 *
 * Hook slots are only legal because the provider keeps the FIRST kit it receives: a kit whose hooks
 * changed identity between renders would break React's hook order.
 */
import { createContext, forwardRef, useContext, useState } from 'react';
import type { ComponentType, Dispatch, InputHTMLAttributes, ReactElement, ReactNode, Ref, SetStateAction } from 'react';
import type { FetchQueryAdapter } from '@jini-ai/core/fetch';

/* ---------- component props: only what user-management passes ---------- */
/** Same three-tier vocabulary as the admin `ConfirmDialog`; an item or dialog without one is neutral. */
type ConfirmTone = 'default' | 'warning' | 'danger';
export type SecretInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'ref'> & {
  readonly label: string;
  readonly toggleLabels?: { readonly show: string; readonly hide: string };
  readonly toggleAttrs?: Readonly<Record<string, string | boolean | undefined>>;
  readonly revealed?: boolean;
  readonly onRevealedChange?: (revealed: boolean) => void;
  readonly ref?: Ref<HTMLInputElement>;
};
export interface RowMenuItem { key: string; label: string; onSelect: () => void; tone?: ConfirmTone }
export interface RowMenuProps { items: RowMenuItem[]; triggerLabel: string; agentHandle?: string }
export interface ConfirmDialogProps {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; cancelLabel?: string; tone?: ConfirmTone;
  pending?: boolean; onConfirm: () => void; onCancel: () => void; agentHandle?: string;
}
export interface InfoTipProps { label: string; triggerLabel?: string | undefined; agentHandle?: string | false | undefined }

/** What `useAsyncAction` returns: saving/error for the latest run, cancellations silent. */
export interface AsyncActionState {
  saving: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  run: (required: { action: () => Promise<void>; describeError: (e: unknown) => string }) => Promise<void>;
}

/* ---------- the kit ---------- */
export interface UserManagementKitComponents {
  SecretInput: ComponentType<SecretInputProps>;
  RowMenu: ComponentType<RowMenuProps>;
  ConfirmDialog: ComponentType<ConfirmDialogProps>;
  InfoTip: ComponentType<InfoTipProps>;
}
export interface UserManagementKitHooks {
  useFetchQuery: FetchQueryAdapter['useFetchQuery'];
  useFetchMutation: FetchQueryAdapter['useFetchMutation'];
  useAsyncAction: () => AsyncActionState;
  useCachedLoader: FetchQueryAdapter['useCachedLoader'];
  useInvalidate: FetchQueryAdapter['useInvalidate'];
}
export interface UserManagementKit { readonly components: UserManagementKitComponents; readonly hooks: UserManagementKitHooks }

/* ---------- provider ---------- */
/** Thrown when a screen renders without the provider, so the host sees which one to mount and where. */
export class UserManagementKitMissingError extends Error {
  constructor(_required: Record<string, never> = {}, optional: ErrorOptions = {}) {
    super('@jini-ai/user-management screens need <UserManagementKitProvider kit={...}> above them. '
      + 'The host builds the kit from its UI library and mounts it once at its root.', optional);
    this.name = 'UserManagementKitMissingError';
  }
}
const UserManagementKitContext = createContext<UserManagementKit | null>(null);

/** Mount once at the host root. The first kit is kept: hook slots must not change identity. */
export function UserManagementKitProvider(required: { kit: UserManagementKit; children: ReactNode }): ReactElement {
  const [kit] = useState(() => required.kit);
  return <UserManagementKitContext.Provider value={kit}>{required.children}</UserManagementKitContext.Provider>;
}

/** The decision half of every slot: a plain function, so a slot component never calls a custom hook. */
function requireUserManagementKit(kit: UserManagementKit | null): UserManagementKit {
  if (kit === null) throw new UserManagementKitMissingError({});
  return kit;
}
export function useUserManagementKit(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): UserManagementKit {
  return requireUserManagementKit(useContext(UserManagementKitContext));
}

/* ---------- same-name slot components: a screen changes only its import line ---------- */
// React's built-in useContext, not useUserManagementKit(): a component calling a custom hook is a check:hooks finding.
export const SecretInput = forwardRef<HTMLInputElement, Omit<SecretInputProps, 'ref'>>(function UserManagementSecretInput(props, ref) {
  const Impl = requireUserManagementKit(useContext(UserManagementKitContext)).components.SecretInput;
  return <Impl {...props} ref={ref} />;
});
export function RowMenu(props: RowMenuProps): ReactElement {
  const Impl = requireUserManagementKit(useContext(UserManagementKitContext)).components.RowMenu;
  return <Impl {...props} />;
}
export function ConfirmDialog(props: ConfirmDialogProps): ReactElement {
  const Impl = requireUserManagementKit(useContext(UserManagementKitContext)).components.ConfirmDialog;
  return <Impl {...props} />;
}
export function InfoTip(props: InfoTipProps): ReactElement {
  const Impl = requireUserManagementKit(useContext(UserManagementKitContext)).components.InfoTip;
  return <Impl {...props} />;
}

/* ---------- hook wrappers: a hook calling a hook, not a component finding ---------- */
export const useFetchQuery: UserManagementKitHooks['useFetchQuery'] = (r, o) => useUserManagementKit().hooks.useFetchQuery(r, o);
export const useFetchMutation: UserManagementKitHooks['useFetchMutation'] = (r, o) => useUserManagementKit().hooks.useFetchMutation(r, o);
export const useAsyncAction: UserManagementKitHooks['useAsyncAction'] = () => useUserManagementKit().hooks.useAsyncAction();
export const useCachedLoader: UserManagementKitHooks['useCachedLoader'] = (r, o) => useUserManagementKit().hooks.useCachedLoader(r, o);
export const useInvalidate: UserManagementKitHooks['useInvalidate'] = () => useUserManagementKit().hooks.useInvalidate();

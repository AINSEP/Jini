import type { ReactNode } from "react";
import type { UsersPort } from "@jini-ai/core/contracts/site/user-management-react";
import { createUsersControllerHook } from "./UsersPanel.hooks.js";
import { Users as JiniUsers } from "./Users.js";
import type { WiredUsersHook } from "./hooks/use-localized-users.hooks.js";

/**
 * @file The Users screen as a host mounts it: the host's wired controller hook adapted onto
 * {@link JiniUsers}' `useUsersHook` seam. Moved from the host's `features/users/UsersPanel.tsx`; the
 * host passes its live port, workspace scope and status-label renderer.
 */
export interface UsersPanelProps {
  /**
   * The host's wired controller hook (REQUIRED) — the host binds its live port, locale hook and
   * router (see `useLocalizedUsers`); a test passes a fake-port composition instead.
   */
  useUsersHook: WiredUsersHook;
  /** Password-banner plan (2026-09-24), Slice 3: set by `panels.tsx` when the route is
   *  `/users/change-password` (the dashboard nag's deep link). Forwarded to `useUsersHook` as-is —
   *  `Users` itself has no opinion on what it means, see `use-users.hooks.ts` for the behavior. */
  openOwnPasswordReset?: boolean | undefined;
  /** The host's live `UsersPort`. */
  port: UsersPort;
  /** The host's workspace query scope. */
  queryScope: string;
  /** The host owns localization of protocol status/role labels. */
  renderServerLabel: (required: { value: string }) => ReactNode;
}

/** Product composition only; Jini owns markup, hooks and account protections. */
export function UsersPanel({ useUsersHook, openOwnPasswordReset, port, queryScope, renderServerLabel }: UsersPanelProps) {
  const useController = createUsersControllerHook({ useUsersHook, openOwnPasswordReset });
  return <JiniUsers port={port} queryScope={queryScope}
    useUsersHook={useController} renderServerLabel={renderServerLabel} />;
}

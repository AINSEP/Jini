import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useFetchMutation, type Translate } from "@jini-ai/ui/panel-kit";
import type { AdminIdentityUser } from "../../models.js";
import type { UsersPort } from "../../ports.js";
import { describeApiError, KEYS } from "../rules.js";

export interface ChangeUsernameController {
  target: AdminIdentityUser | null;
  username: string;
  setUsername: Dispatch<SetStateAction<string>>;
  error: string | null;
  pending: boolean;
  open: (required: { user: AdminIdentityUser }, optional?: Record<string, never>) => void;
  cancel: (required?: Record<string, never>, optional?: Record<string, never>) => void;
  confirm: (required?: Record<string, never>, optional?: Record<string, never>) => Promise<void>;
}

/** Shared rename dialog lifecycle: guard, write through the existing user port, invalidate list.
 * Failures retain the target/draft and the server's actual reason; duplicate submits are refused.
 * @complexity O(1) client state and one PATCH per submission. No credential/session effects.
 */
export function useChangeUsername(required: {
  port: Pick<UsersPort, "updateUser">; queryScope: string; translate: Translate;
  canRename: (user: AdminIdentityUser) => boolean;
}, _optional: Record<string, never> = {}): ChangeUsernameController {
  const [target, setTarget] = useState<AdminIdentityUser | null>(null);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mutation = useFetchMutation({
    run: ({ input }: { input: { principalId: string; username: string } }) =>
      required.port.updateUser({ principalId: input.principalId }, { username: input.username }),
  }, { invalidates: [[required.queryScope, ...KEYS.list]] });

  function open({ user }: { user: AdminIdentityUser }, _options: Record<string, never> = {}) {
    if (busy.current || !required.canRename(user)) return;
    setTarget(user); setUsername(user.username); setError(null);
  }
  function cancel(_input: Record<string, never> = {}, _options: Record<string, never> = {}) {
    if (busy.current) return;
    setTarget(null); setUsername(""); setError(null);
  }
  async function confirm(_input: Record<string, never> = {}, _options: Record<string, never> = {}) {
    if (!target || busy.current || !required.canRename(target)) return;
    if (!username.trim()) { setError(required.translate("username must not be blank")); return; }
    busy.current = true; setError(null);
    try {
      await mutation.mutate({ input: { principalId: target.principalId, username } });
      setTarget(null); setUsername("");
    } catch (cause) {
      setError(describeApiError({ error: cause, fallback: required.translate("failed to change username"), translate: required.translate }));
    } finally { busy.current = false; }
  }
  return { target, username, setUsername, error, pending: mutation.status === "pending", open, cancel, confirm };
}

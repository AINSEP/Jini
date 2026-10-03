import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminShellContext, AdminShellSessionController, AdminShellSessionPort, AdminShellSessionState } from './types.js';

interface Owner { readonly context: AdminShellContext; readonly port: AdminShellSessionPort }
interface OwnedState extends Owner { readonly state: AdminShellSessionState }

/**
 * Own session reads and invalidation without any host API imports.
 * @param args Stable context and session port. Changing either starts a new session check.
 * @returns Gate state plus refresh/logout actions; adapter failures become an error state.
 */
export function useAdminShellSession(args: Owner): AdminShellSessionController {
  const { context, port } = args;
  const active = useRef<Owner | null>(null);
  const loggingOut = useRef<Owner | null>(null);
  const generation = useRef(0);
  const [owned, setOwned] = useState<OwnedState>({ context, port, state: { status: 'checking' } });

  const run = useCallback(async (operation: 'read' | 'logout'): Promise<void> => {
    const owner = active.current;
    if (!owner || owner.context !== context || owner.port !== port) return;
    // A refresh must not race a pending logout and restore a soon-to-be-revoked principal.
    if (loggingOut.current === owner) return;
    if (operation === 'logout') loggingOut.current = owner;
    const request = ++generation.current;
    const isCurrent = () => active.current === owner && generation.current === request;
    setOwned({ context, port, state: { status: 'checking' } });
    try {
      if (operation === 'logout') {
        await port.logout(context);
        if (isCurrent()) setOwned({ context, port, state: { status: 'anonymous' } });
        return;
      }
      const session = await port.read(context);
      if (!isCurrent()) return;
      const state: AdminShellSessionState = session === null
        ? { status: 'anonymous' }
        : { status: 'authenticated', session };
      setOwned({ context, port, state });
    } catch (error: unknown) {
      // Local sign-out must complete even when the server cannot revoke its cookie. A read
      // retry here would quietly restore that still-valid session instead of showing login.
      if (isCurrent()) setOwned({ context, port, state: operation === 'logout'
        ? { status: 'anonymous' }
        : { status: 'error', error } });
    } finally {
      if (operation === 'logout' && loggingOut.current === owner) loggingOut.current = null;
    }
  }, [context, port]);

  const refresh = useCallback(() => run('read'), [run]);
  const logout = useCallback(() => run('logout'), [run]);

  useEffect(() => {
    const owner = { context, port };
    active.current = owner;
    const unsubscribe = port.onUnauthenticated({
      ...context,
      onUnauthenticated: () => {
        if (active.current !== owner) return;
        // Retire all older reads before clearing the gate; none may restore the principal.
        generation.current += 1;
        setOwned({ context, port, state: { status: 'anonymous' } });
      },
    });
    void refresh();
    return () => {
      active.current = null;
      generation.current += 1;
      unsubscribe();
    };
  }, [context, port, refresh]);

  // Mask the old workspace synchronously, before effect cleanup/initialization executes.
  const state: AdminShellSessionState = owned.context === context && owned.port === port
    ? owned.state
    : { status: 'checking' };
  return { state, refresh, logout };
}

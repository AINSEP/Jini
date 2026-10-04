import type { AuthApiPort } from '../ports.js';
import type { AdminAccount, AuthState } from '../models.js';
import { createControllerStore } from './controller-store.js';
/** The host owns session cookies and shell switching; the form owns only credentials and errors. */
export function createAuthController({ api, onLogin }: { api: AuthApiPort; onLogin: (required: { user: AdminAccount }, optional?: Record<string, never>) => void }, { initialUsername = 'admin' }: { initialUsername?: string } = {}) {
  const store = createControllerStore<AuthState>({ initial: { username: initialUsername, password: '', error: null, busy: false } });
  const set = (patch: Partial<AuthState>) => store.set({ patch });
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe,
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { set({ password: '' }); store.dispose({}); },
    setDraft({ patch }: { patch: Pick<Partial<AuthState>, 'username' | 'password'> }, _optional: Record<string, never> = {}) { set(patch); },
    async submit(_required: Record<string, never>, _optional: Record<string, never> = {}) {
      const s = store.getSnapshot({}); if (!store.active({}) || s.busy) return false;
      set({ busy: true, error: null });
      try {
        const { user } = await api.login({ username: s.username, password: s.password }, store.call);
        if (!store.active({})) return false;
        set({ password: '' }); onLogin({ user }); return true;
      } catch (error) { set({ error: error instanceof Error ? error.message : 'login failed' }); return false; }
      finally { set({ busy: false }); }
    },
  };
}
export type AuthController = ReturnType<typeof createAuthController>;

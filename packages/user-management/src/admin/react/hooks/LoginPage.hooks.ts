import { createElement, createContext, useContext, useMemo } from 'react';
import type { FormEvent } from 'react';
import type { AuthState } from '../../models.js';
import { createAuthController } from '../../controllers/auth.controller.js';
import type { AuthController } from '../../controllers/auth.controller.js';
import { useAuthScope } from './AuthBinding.hooks.js';
import type { AuthPageProps } from './AuthBinding.hooks.js';
import { usePeopleController } from './PeopleController.hooks.js';
export interface AuthView { controller: AuthController; state: AuthState }
export const AuthViewContext = createContext<AuthView | null>(null);
export function useLoginPage(props: AuthPageProps, _optional: Record<string, never> = {}) {
  const { api } = useAuthScope({});
  const scope = useMemo(() => ({ api, onLogin: props.onLogin }), [api, props.onLogin]);
  const { controller, state } = usePeopleController<AuthState, AuthController>({ scope, key: props.initialUsername ?? 'admin',
    create: () => createAuthController({ api, onLogin: props.onLogin }, { ...(props.initialUsername !== undefined ? { initialUsername: props.initialUsername } : {}) }), start: () => {},
  });
  return { content: props.tabs.auth ? createElement(props.tabs.auth, {}) : null, visible: props.description.visible && props.description.tabs.some(t => t.visible), view: state && controller ? { state, controller } : null, title: props.title ?? 'Sign in to your workspace' };
}
export function useAuthTab(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const v = useContext(AuthViewContext); if (!v) throw new Error('Login controller unavailable.');
  const { state: s, controller: c } = v;
  return { s, username: ({ value }: { value: string }) => c.setDraft({ patch: { username: value } }), password: ({ value }: { value: string }) => c.setDraft({ patch: { password: value } }),
    submit: (e: FormEvent) => { e.preventDefault(); void c.submit({}); }, submitLabel: s.busy ? 'Signing in…' : 'Sign in',
    usernameAttrs: { autoComplete: 'username', 'data-jini-part': 'username' }, passwordAttrs: { autoComplete: 'current-password', 'data-jini-part': 'password' } };
}

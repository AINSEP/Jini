import { Suspense } from 'react';
import { Notice, Spinner } from '@jini-ai/ui-kit/react';
import { AuthViewContext, useLoginPage } from '../hooks/LoginPage.hooks.js';
import type { AuthPageProps } from '../hooks/AuthBinding.hooks.js';
export default function LoginPage(props: AuthPageProps, _optional: Record<string, never> = {}) {
  const v = useLoginPage(props);
  if (!v.visible) return <Notice>Login is unavailable.</Notice>;
  if (!v.view) return <Spinner label="Loading login…"/>;
  return <AuthViewContext.Provider value={v.view}><div className="login-screen"><h1>{v.title}</h1><Suspense fallback={<Spinner label="Loading login…"/>}>{v.content}</Suspense></div></AuthViewContext.Provider>;
}

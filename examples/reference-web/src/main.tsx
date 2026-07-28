import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentLab } from './AgentLab.js';
import { App } from './App.js';
import './remixicon.css';
import './styles.css';

/**
 * Hash routing, deliberately hand-rolled.
 *
 * The playground needs exactly two top-level pages — the app shell and the plain React page the
 * agent verbs are proven against — and a router dependency would be a real dependency in an
 * example whose whole job is to show what depending on `@injini/*` looks like.
 */
function currentRoute(): string {
  return globalThis.location.hash.replace(/^#\/?/, '');
}

function Playground() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    globalThis.addEventListener('hashchange', onHashChange);
    return () => globalThis.removeEventListener('hashchange', onHashChange);
  }, []);

  return route === 'agent-lab' ? <AgentLab /> : <App />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Jini Playground could not find #root');

createRoot(root).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);

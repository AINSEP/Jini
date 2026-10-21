import { Suspense } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { AdminConfigError, createAdmin, defineAdminModule } from '../../module/index.js';
import { adminPort } from '../../module/token.js';
import { bindReact, type ModulePageProps, type TabViewProps } from '../index.js';

afterEach(cleanup);

interface GreetingPort { greet(required: { name: string }): string }
const greetingToken = adminPort<GreetingPort, 'test.greeting'>({ id: 'test.greeting' });
const greetingModule = defineAdminModule({ id: 'greeting', requires: { greeting: greetingToken },
  pages: { hello: { path: '/hello', label: 'Hello', tabs: { first: { label: 'First' } } } } });

function bindGreeting() {
  let usePorts!: () => { greeting: GreetingPort };
  function HelloPage(props: ModulePageProps) { return <h1>{`${props.description.label}: ${usePorts().greeting.greet({ name: 'page' })}`}</h1>; }
  function FirstTab(props: TabViewProps) { return <p>{usePorts().greeting.greet({ name: String(props.params.who) })}</p>; }
  const react = bindReact({ module: greetingModule, views: { hello: { page: async () => ({ default: HelloPage }), tabs: { first: async () => ({ default: FirstTab }) } } } });
  usePorts = () => react.usePorts();
  return react;
}

it('binds lazy pages and tabs to a private per-binding port context when the host passes none', async () => {
  const react = bindGreeting();
  const admin = createAdmin({ modules: [greetingModule], ports: { greeting: { greet: ({ name }: { name: string }) => `hi ${name}` } } });
  const { Page, tabs } = react.pages.hello;
  render(<react.Provider admin={admin}><Suspense fallback="loading"><Page tabs={tabs} description={admin.describe().pages[0]!} /><tabs.first params={{ who: 'tab' }} /></Suspense></react.Provider>);
  expect(await screen.findByRole('heading', { name: 'Hello: hi page' })).toBeVisible();
  expect(await screen.findByText('hi tab')).toBeVisible();
  expect(react.module).toBe(greetingModule);
});

it('refuses port reads outside its own provider, naming the module', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const react = bindGreeting();
  expect(() => renderHook(() => react.usePorts())).toThrow(AdminConfigError);
  expect(() => renderHook(() => react.usePorts())).toThrow(/React scope unavailable: greeting/);
});

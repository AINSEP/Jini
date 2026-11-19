import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useBrowserTelemetryFeed } from '../../hooks/use-browser-telemetry-feed.js';

it('feeds sign-in and the template, resends on sign-in and route changes, and skips unrelated renders', () => {
  const calls: string[] = [];
  const telemetry = {
    setSignedIn: (value: boolean) => { calls.push(`signedIn:${value}`); },
    setRoute: (route: string) => { calls.push(route); },
  };
  const params = { recordId: 'p1' };
  const { rerender } = renderHook((props: { signedIn: boolean; routePath: string; unrelated: number }) =>
    useBrowserTelemetryFeed({ signedIn: props.signedIn, routePath: props.routePath, params, base: '/control', telemetry }),
  { initialProps: { signedIn: false, routePath: '/records/p1', unrelated: 0 } });
  rerender({ signedIn: true, routePath: '/records/p1', unrelated: 0 });
  expect(calls).toEqual(['signedIn:false', '/control/records/:recordId', 'signedIn:true', '/control/records/:recordId']);
  rerender({ signedIn: true, routePath: '/records/p1', unrelated: 1 });
  expect(calls).toHaveLength(4);
  rerender({ signedIn: true, routePath: '/settings', unrelated: 1 });
  expect(calls).toEqual(['signedIn:false', '/control/records/:recordId', 'signedIn:true', '/control/records/:recordId', 'signedIn:true', '/control/settings']);
});

it('uses updated bases and params but does not resend an unchanged template', () => {
  const calls: string[] = [];
  const telemetry = { setSignedIn: () => {}, setRoute: (route: string) => { calls.push(route); } };
  const { rerender } = renderHook((props: { base: string; params: Readonly<Record<string, string>> }) =>
    useBrowserTelemetryFeed({ ...props, signedIn: true, routePath: '/records/p1', telemetry }),
  { initialProps: { base: '/one', params: { recordId: 'p1' } } });
  rerender({ base: '/one', params: { recordId: 'p1' } });
  expect(calls).toEqual(['/one/records/:recordId']);
  rerender({ base: '/two', params: { recordId: 'p1' } });
  rerender({ base: '/two', params: { recordId: 'p2' } });
  expect(calls).toEqual(['/one/records/:recordId', '/two/records/:recordId', '/two/records/p1']);
});

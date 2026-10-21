import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { AdminConfigError } from '../../../core/module/index.js';
import { createMemoryPlaygroundTargets } from '../../adapters/memory.js';
import { Canvas } from '../components/Canvas.js';
import { PlaygroundPortsContext, usePlaygroundPorts } from '../hooks/PlaygroundPorts.hooks.js';

afterEach(cleanup);

it('denies a canvas mounted without grants and never publishes a target', () => {
  const targets = createMemoryPlaygroundTargets({});
  const register = vi.spyOn(targets, 'register');
  render(<PlaygroundPortsContext.Provider value={{ playgroundTargets: targets }}><Canvas params={{}} /></PlaygroundPortsContext.Provider>);
  expect(screen.getByText('Permission denied')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Canvas' })).toBeNull();
  expect(register).not.toHaveBeenCalled();
});

it('fails loudly when playground hooks run outside the bound provider', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => renderHook(() => usePlaygroundPorts())).toThrow(AdminConfigError);
  expect(() => renderHook(() => usePlaygroundPorts())).toThrow(/React scope unavailable: playground/);
});

import { createContext, useContext } from 'react';
import type { MediaApiPort, MediaProvidersPort, MediaEventsPort } from '../../ports.js';
import { AdminConfigError } from '../../../core/module/index.js';
export interface MediaPorts {
  readonly mediaApi: MediaApiPort;
  readonly mediaProviders?: MediaProvidersPort;
  readonly mediaEvents?: MediaEventsPort;
}
export const MediaPortsContext = createContext<MediaPorts | null>(null);
export function useMediaPorts(
  _required: Record<string, never> = {},
  _optional: Record<string, never> = {},
): MediaPorts {
  const ports = useContext(MediaPortsContext);
  if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: media'] });
  return ports;
}

import { createContext, useContext } from 'react';
import type { EmbedPolicyPort } from '../../../core/ports/embed-policy.js';
import type { MediaApiPort, MediaProvidersPort, MediaEventsPort } from '../../ports.js';
import { AdminConfigError } from '@jini-ai/core/admin-runtime';
import type { UseAdminController } from '@jini-ai/core/contracts/admin-module';
export interface MediaPorts {
  readonly mediaApi: MediaApiPort;
  readonly embedPolicy: EmbedPolicyPort;
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
/** The controller hook the host injects through the module factory (owner answer 2026-11-17, J4:
 * injected, never imported). The factory's Provider supplies it; outside it a hook fails loudly. */
export const MediaControllerContext = createContext<UseAdminController | null>(null);
function controllerMissing(): never {
  throw new AdminConfigError({ issues: ['Controller hook unavailable: media'] });
}
export const useMediaController: UseAdminController = (required, optional = {}) => {
  const useController = useContext(MediaControllerContext) ?? controllerMissing;
  return useController(required, optional);
};

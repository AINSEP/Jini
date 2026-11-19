import { MediaControllerContext } from '../hooks/MediaPorts.hooks.js';
import { useController } from '../../../core/react/use-controller.js';
import type { ReactNode } from 'react';
import { createMemoryMediaApi } from '../../adapters/memory.js';
import { realEmbedPolicy } from '../../__tests__/fakes/embed-policy.js';
import { MediaPortsContext } from '../hooks/MediaPorts.hooks.js';

/** Test wrapper that mounts the media ports scope an edit panel reads its embed policy from. */
export function EmbedPolicyScope({ children }: { children: ReactNode }) {
  return <MediaControllerContext.Provider value={useController}><MediaPortsContext.Provider value={{ mediaApi: createMemoryMediaApi({}), embedPolicy: realEmbedPolicy }}>{children}</MediaPortsContext.Provider></MediaControllerContext.Provider>;
}

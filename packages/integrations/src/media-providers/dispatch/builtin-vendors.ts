/** Built-in registration has one owner and runs on first registry use, never on import. */
import type { VendorAdapterRegistry } from './vendor-registry.js';
import { registerVendorAdapters as registerAihubmix } from './providers/aihubmix.js';
import { registerVendorAdapters as registerCustomImage } from './providers/custom-image.js';
import { registerVendorAdapters as registerElevenLabs } from './providers/elevenlabs.js';
import { registerVendorAdapters as registerFishAudio } from './providers/fishaudio.js';
import { registerVendorAdapters as registerGrok } from './providers/grok.js';
import { registerVendorAdapters as registerImageRouter } from './providers/imagerouter.js';
import { registerVendorAdapters as registerMiniMax } from './providers/minimax.js';
import { registerVendorAdapters as registerNanoBanana } from './providers/nanobanana.js';
import { registerVendorAdapters as registerOpenAI } from './providers/openai.js';
import { registerVendorAdapters as registerOpenRouter } from './providers/openrouter.js';
import { registerVendorAdapters as registerSenseAudio } from './providers/senseaudio.js';
import { registerVendorAdapters as registerVolcengine } from './providers/volcengine.js';

export function registerBuiltinVendorAdapters(
  { registry }: { registry: Pick<VendorAdapterRegistry, 'register'> },
  _optional: Record<string, never> = {},
): void {
  for (const register of [
    registerAihubmix,
    registerCustomImage,
    registerElevenLabs,
    registerFishAudio,
    registerGrok,
    registerImageRouter,
    registerMiniMax,
    registerNanoBanana,
    registerOpenAI,
    registerOpenRouter,
    registerSenseAudio,
    registerVolcengine,
  ]) register({ registry });
}

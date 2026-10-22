import { describe, expect, it } from 'vitest';
import * as providers from '../index.js';

describe('providers barrel', () => {
  it('re-exports the public surface of every provider module', () => {
    expect(typeof providers.buildOpenAIChatTokenParam).toBe('function');
    expect(typeof providers.googleGenerateContentUrl).toBe('function');
    expect(typeof providers.aihubmixHeaders).toBe('function');
    // PARITY: runtime still exposes its validation/transport boundary after classifiers move.
    expect(typeof providers.validateBaseUrl).toBe('function');
    expect(typeof providers.listProviderModels).toBe('function');
    expect(typeof providers.listElevenLabsVoiceOptions).toBe('function');
    expect(typeof providers.generateCodeVerifier).toBe('function');
    expect(typeof providers.beginOAuthPkce).toBe('function');
    expect(typeof providers.startOAuthCallbackListener).toBe('function');
    expect(typeof providers.getStoredOAuthToken).toBe('function');
    expect(typeof providers.resolveOAuthBearer).toBe('function');
  });
});

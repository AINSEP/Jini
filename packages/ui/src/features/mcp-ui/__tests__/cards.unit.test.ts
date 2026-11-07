import { describe, expect, it } from 'vitest';
import { mcpUiCards } from '../cards.js';
import { defineSecretCardTool } from '../secret-card.js';
import { buildSignInCard, waitAtSignInCard } from '../sign-in-card.js';
import { buildFormSurface } from '../surfaces/form.js';
import { buildOutcomeSurface } from '../surfaces/outcome.js';

describe('mcpUiCards', () => {
  it('passes the five builders through by reference, nothing more', () => {
    expect(mcpUiCards).toEqual({ defineSecretCardTool, buildSignInCard, waitAtSignInCard, buildFormSurface, buildOutcomeSurface });
    expect(mcpUiCards.buildFormSurface).toBe(buildFormSurface);
    expect(mcpUiCards.waitAtSignInCard).toBe(waitAtSignInCard);
  });
});

/** The card builders as one object, pinned to the core port so a signature change breaks this build. */
import type { SurfaceCardsPort } from '@jini-ai/core';
import type { UIResource } from './resource.js';
import { defineSecretCardTool } from './secret-card.js';
import { buildSignInCard, waitAtSignInCard } from './sign-in-card.js';
import { buildFormSurface } from './surfaces/form.js';
import { buildOutcomeSurface } from './surfaces/outcome.js';

export const mcpUiCards = {
  defineSecretCardTool, buildSignInCard, waitAtSignInCard, buildFormSurface, buildOutcomeSurface,
} satisfies SurfaceCardsPort<UIResource>;

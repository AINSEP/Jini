import type { CommentsProviderDefinition } from '@jini-ai/core/contracts/site/comments-providers';

/** Returns an immutable, isolated definition; malformed metadata is refused before registration. */
export function freezeCommentsDefinition({ definition }: { definition: CommentsProviderDefinition }, _options = {}): CommentsProviderDefinition {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(definition.id) || !definition.label.trim()) throw new Error('Invalid comments provider identity');
  if (!['stored', 'embedded'].includes(definition.kind) || !['functional', 'marketing'].includes(definition.consentCategory)
    || !['metadata-only', 'adapter'].includes(definition.implementation)) throw new Error('Invalid comments provider metadata');
  return Object.freeze({ ...definition,
    csp: Object.freeze({ scriptSrc: Object.freeze([...definition.csp.scriptSrc]), frameSrc: Object.freeze([...definition.csp.frameSrc]),
      connectSrc: Object.freeze([...definition.csp.connectSrc]), styleSrc: Object.freeze([...definition.csp.styleSrc]) }),
    settingsSchema: Object.freeze(definition.settingsSchema.map(field => Object.freeze({ ...field }))),
  });
}

export interface CommentsSettingField { readonly key: string; readonly label: string; readonly kind: 'public' | 'secret'; readonly required: boolean }
export interface CommentsProviderDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: 'stored' | 'embedded';
  readonly consentCategory: 'functional' | 'marketing';
  readonly csp: { readonly scriptSrc: readonly string[]; readonly frameSrc: readonly string[]; readonly connectSrc: readonly string[]; readonly styleSrc: readonly string[] };
  readonly settingsSchema: readonly CommentsSettingField[];
  readonly implementation: 'metadata-only' | 'adapter';
}
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

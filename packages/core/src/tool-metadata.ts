/** Domain registrations own these declarations; projections never infer risk or authorization. */
export interface ToolApprovalMetadata {
  readonly class: 'read' | 'edit' | 'trash' | 'delete' | 'restore-over-existing' | 'publish' | 'replace-secret' | 'escalation';
  readonly confirmation: 'direct' | 'policy' | 'plan';
  readonly input?: 'human-form';
  /** Host-owned input classification rule, separate from the declared side effects. */
  readonly rule?: string;
}

export interface ToolMetadata<A extends ToolApprovalMetadata = ToolApprovalMetadata> {
  readonly search?: { readonly keywords?: string; readonly queries?: readonly string[] };
  readonly approval?: A;
  readonly mcpUi?: { readonly redeemable?: boolean; readonly exchangeOnly?: boolean; readonly secretField?: { readonly secret: true } };
}

export type ToolMetadataById<A extends ToolApprovalMetadata = ToolApprovalMetadata> = Readonly<Record<string, ToolMetadata<A>>>;

/** Own-property lookup: inherited object keys can never declare a tool's approval or callback access. */
export function toolMetadataFor(
  { toolId, metadata }: { toolId: string; metadata: ToolMetadataById | undefined },
  _optional: Record<string, never> = {},
): ToolMetadata | undefined {
  return metadata && Object.hasOwn(metadata, toolId) ? metadata[toolId] : undefined;
}

/**
 * Bind host-owned metadata to registrations returned by a reusable domain package. Existing
 * catalog metadata wins; handlers, authorization and independently validated risk are preserved.
 * @returns New registrations for declared ids; undeclared registrations retain their identity.
 * @complexity O(t) time and space in registrations.
 * @example withToolMetadata({ registrations, metadata: notesMetadata });
 */
export function withToolMetadata(
  { registrations, metadata }: { registrations: readonly import('./tool-registry.js').ToolRegistration[]; metadata: ToolMetadataById },
  _optional: Record<string, never> = {},
): import('./tool-registry.js').ToolRegistration[] {
  return registrations.map(registration => {
    const declared = toolMetadataFor({ toolId: registration.descriptor.id, metadata });
    if (!declared || registration.descriptor.metadata) return registration;
    return { ...registration, descriptor: { ...registration.descriptor, metadata: declared } };
  });
}

/** Immutable domain declarations projected for discovery and human callback gates. */
export interface ToolMetadataProjections<A extends ToolApprovalMetadata = ToolApprovalMetadata> {
  readonly byId: ToolMetadataById<A>;
  readonly keywords: Readonly<Record<string, string>>;
  readonly queries: Readonly<Record<string, readonly string[]>>;
  readonly approvals: Readonly<Record<string, A>>;
  readonly policyConfirmationIds: ReadonlySet<string>;
  readonly secretFormIds: ReadonlySet<string>;
  readonly secretForms: Readonly<Record<string, { readonly secretField: { readonly secret: true } }>>;
  readonly redeemableIds: ReadonlySet<string>;
  readonly exchangeOnlyIds: ReadonlySet<string>;
}

/**
 * Generate projections from the same metadata domain registration consumes. Duplicate ownership
 * fails before any projection is returned. No handler, risk classification or permission is inferred.
 * @param required.domains Domain names and their independently authored declarations.
 * @returns Fresh maps and sets; inputs are never mutated.
 * @throws Error naming both domains claiming the same id.
 * @complexity O(t) time and space in declared tools, performed at composition time.
 * @example projectToolMetadata({ domains: [{ domain: 'notes', tools: notesMetadata }] });
 */
export function projectToolMetadata<A extends ToolApprovalMetadata>(
  { domains }: { domains: readonly { readonly domain: string; readonly tools: ToolMetadataById<A> }[] },
  _optional: Record<string, never> = {},
): ToolMetadataProjections<A> {
  const byId: Record<string, ToolMetadata<A>> = Object.create(null);
  const owners = new Map<string, string>();
  for (const { domain, tools } of domains) {
    for (const [id, metadata] of Object.entries(tools)) {
      const owner = owners.get(id);
      if (owner !== undefined) throw new Error(`tool-metadata: '${id}' is declared by both ${owner} and ${domain}`);
      owners.set(id, domain);
      byId[id] = metadata;
    }
  }
  const entries = Object.entries(byId);
  const approvals = Object.fromEntries(entries.filter(([, metadata]) => metadata.approval !== undefined).map(([id, metadata]) => [id, metadata.approval!])) as Record<string, A>;
  const policyConfirmationIds = new Set(Object.entries(approvals).filter(([, policy]) => policy.confirmation === 'policy' || policy.confirmation === 'plan' || !!policy.rule).map(([id]) => id));
  const secretEntries = entries.filter(([, metadata]) => metadata.mcpUi?.secretField?.secret === true);
  const secretFormIds = new Set(secretEntries.map(([id]) => id));
  return {
    byId,
    keywords: Object.fromEntries(entries.filter(([, metadata]) => metadata.search?.keywords !== undefined).map(([id, metadata]) => [id, metadata.search!.keywords!])),
    queries: Object.fromEntries(entries.filter(([, metadata]) => metadata.search?.queries !== undefined).map(([id, metadata]) => [id, metadata.search!.queries!])),
    approvals, policyConfirmationIds, secretFormIds,
    secretForms: Object.fromEntries(secretEntries.map(([id, metadata]) => [id, { secretField: metadata.mcpUi!.secretField! }])),
    redeemableIds: new Set([...policyConfirmationIds, ...secretFormIds, ...entries.filter(([, metadata]) => metadata.mcpUi?.redeemable === true).map(([id]) => id)]),
    exchangeOnlyIds: new Set([...policyConfirmationIds, ...secretFormIds, ...entries.filter(([, metadata]) => metadata.mcpUi?.exchangeOnly === true).map(([id]) => id)]),
  };
}

export type ArtifactKind =
  | 'html'
  | 'deck'
  | 'react-component'
  | 'markdown-document'
  | 'svg'
  | 'diagram'
  | 'code-snippet'
  | 'mini-app'
  | 'design-system';

export type ArtifactRendererId =
  | 'html'
  | 'deck-html'
  | 'react-component'
  | 'markdown'
  | 'svg'
  | 'diagram'
  | 'code'
  | 'mini-app'
  | 'design-system';

export type ArtifactExportKind = 'html' | 'pdf' | 'zip' | 'jsx' | 'md' | 'svg' | 'txt';

export type ArtifactStatus = 'streaming' | 'complete' | 'error';

/**
 * The sidecar manifest an artifact-producing turn writes alongside its
 * generated file, describing how to render/export it. Generic across
 * artifact kinds — a host's own artifact-file type carries this manifest,
 * not the other way around (see `ArtifactFile` in r4b §2, owned by
 * `@jini/artifacts-react`, not this package).
 */
export interface ArtifactManifest {
  version: 1;
  kind: ArtifactKind;
  title: string;
  entry: string;
  renderer: ArtifactRendererId;
  /** Optional for backward compatibility with older manifests; treat missing as `'complete'`. */
  status?: ArtifactStatus | undefined;
  exports: ArtifactExportKind[];
  /** Optional primary-entry hint for multi-file outputs; fall back to renderable-file heuristics when omitted. */
  primary?: string | boolean | undefined;
  /** Reserved for future multi-file artifact packaging; not yet populated by any known generator. */
  supportingFiles?: string[] | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  sourceSkillId?: string | undefined;
  designSystemId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

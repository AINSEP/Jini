/**
 * @module @jini-ai/core/text/masked-identifier-rows
 * Model-facing error texts that carry a name the caller is allowed to read and that the shape-based
 * redaction used to mask. Data only, shared by core's vocabulary tests, the MCP client's tests and any
 * host that checks its own error path against the same rows.
 */

export interface MaskedIdentifierRow {
  readonly row: number;
  readonly text: string;
  /** The words of `text` a correct error path keeps. */
  readonly keeps: readonly string[];
  /** Which trusted source (see `buildDiagnosticVocabulary`) must supply the exemption. */
  readonly source: 'registered-ids' | 'schema-names' | 'envelope-details' | 'echoed-arguments';
}

export const MASKED_IDENTIFIER_ROWS: readonly MaskedIdentifierRow[] = [
  { row: 1, text: 'Call publish_job_status_read with {}', keeps: ['publish_job_status_read'], source: 'registered-ids' },
  { row: 2, text: 'Declared inputs: viewport (optional), fullPage (optional), dismissCookieBanners (optional)', keeps: ['dismissCookieBanners'], source: 'schema-names' },
  { row: 3, text: "media_asset 'marquee-suit-2024-final-v2' was not found", keeps: ['marquee-suit-2024-final-v2'], source: 'echoed-arguments' },
  { row: 4, text: 'execution 3f2b8c1e-5d47-4a8e-9b1c-0d6e7f8a9b10 for theme_write_file is still pending', keeps: ['3f2b8c1e-5d47-4a8e-9b1c-0d6e7f8a9b10', 'theme_write_file'], source: 'envelope-details' },
  { row: 5, text: 'tool "agent_plugin_google-login__start_sign_in" timed out before it finished', keeps: ['agent_plugin_google-login__start_sign_in'], source: 'envelope-details' },
];

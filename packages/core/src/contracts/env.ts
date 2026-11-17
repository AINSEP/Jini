/** Environment-variable contract shared by every host: what a variable is, who may show its
 * value, and what a problem with it looks like. Types only; the pure parser lives in `src/env/`.
 * A host owns its schema (the list of specs); no engine package reads the ambient environment.
 */

export type EnvValueType = 'string' | 'int' | 'flag' | 'enum' | 'url' | 'origin' | 'path' | 'list' | 'json' | 'duration-ms';
/** The variable's role only. Confidentiality is its own axis (`secret`). */
export type EnvKind = 'config' | 'launch-binding' | 'dev-flag' | 'test-hook' | 'ambient' | 'vendor' | 'external' | 'build';
/** What a host hands to anything that needs environment data: a plain map, never the ambient object. */
export type HostEnvironment = Readonly<Record<string, string | undefined>>;

export interface EnvVarDoc { readonly section: string; readonly summary: string; readonly fix: string; readonly example?: string }

export interface EnvVarSpec<Field extends string = string> {
  readonly name: string;
  readonly field: Field;
  readonly kind: EnvKind;
  readonly secret: boolean;
  readonly type: EnvValueType;
  /** The words and ranges accepted today. `on`/`off` and `values` are compared with the raw text, exactly. */
  readonly accepts?: { readonly on?: readonly string[]; readonly off?: readonly string[]; readonly values?: readonly string[]; readonly min?: number; readonly max?: number };
  readonly default?: string;
  readonly readers: readonly string[];
  /** `import` = consumed while a module is being evaluated, before any entry statement runs. */
  readonly phase: 'build' | 'import' | 'boot' | 'live';
  readonly setBy: 'operator' | 'launcher' | 'platform' | 'ci';
  /** `owner` = an existing validator judges the value; the parser hands the raw text on, unjudged. */
  readonly validation: 'schema' | 'owner';
  /** File of the validator that owns the value (required for `owner`). */
  readonly owner?: string;
  /** The variable only matters while another one has one of these values. */
  readonly activeWhen?: { readonly name: string; readonly in: readonly string[] };
  /** A command-line flag that wins over the variable. Documentation only: precedence is the entry point's job. */
  readonly overriddenBy?: string;
  /** Never deleted, renamed, re-defaulted or given a new accepted word by a migration. */
  readonly security?: 'deny-switch' | 'trust-widening';
  /** Only `env` fields exist in the parsed config; the others stay behind their owner's accessor. */
  readonly delivery?: 'env' | 'startup-ipc' | 'consume-at-import';
  /** What a diagnostic may show. Absent means `presence`. */
  readonly display?: 'value' | 'presence';
  readonly deploy?: 'boot-blocking' | 'recommended';
  readonly locksSetting?: string;
  readonly doc: EnvVarDoc;
}

/** Names a schema cannot list in advance; each family has exactly one reader. */
export interface EnvFamily { readonly id: string; readonly source: 'pattern' | 'declaration' | 'saved-data'; readonly secret: boolean; readonly reader: string; readonly doc: EnvVarDoc }

export interface EnvSchema<Config> {
  readonly specs: readonly EnvVarSpec<Extract<keyof Config, string>>[];
  /** Name prefixes this host owns. A set name with one of them and no spec is reported as unknown. */
  readonly ownedPrefixes: readonly string[];
}

/** What a diagnostic may say about a value. It never holds a raw secret or an unlisted value. */
export type EnvValueEcho = { readonly kind: 'unset' } | { readonly kind: 'hidden'; readonly length: number } | { readonly kind: 'shown'; readonly text: string };

export interface EnvIssue {
  readonly name: string;
  readonly problem: 'missing' | 'invalid' | 'unknown-name';
  readonly received: EnvValueEcho;
  readonly expected: string;
  /** The default that is in use because the value was rejected. Absent for a secret or when there is none. */
  readonly usedInstead?: string;
  /** The nearest known name, for an unknown one. */
  readonly suggestion?: string;
  readonly fix: string;
}

export interface ParsedEnv<Config> {
  readonly config: Config;
  /** Config field → the variable that set it. Absent when the default is in use. */
  readonly sources: Readonly<Record<string, string>>;
  readonly issues: readonly EnvIssue[];
}

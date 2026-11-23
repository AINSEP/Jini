/** Structural Commander port: accepts a real Command tree without a runtime dependency. */
// Read the live registered tree: hand-maintained command documentation can drift when flags change.
export interface IntrospectionCommand {
  name(): string;
  description(): string;
  readonly commands: readonly IntrospectionCommand[];
  readonly registeredArguments: readonly {
    name(): string;
    required: boolean;
    description?: string;
  }[];
  readonly options: readonly {
    flags: string;
    attributeName(): string;
    description?: string;
    mandatory: boolean;
    defaultValue?: unknown;
  }[];
}

export interface IntrospectedArgument { name: string; required: boolean; description: string }
export interface IntrospectedOption {
  flags: string;
  attributeName: string;
  description: string;
  required: boolean;
  defaultValue?: unknown;
  takesValue: boolean;
}
export interface IntrospectedCommand {
  name: string;
  description: string;
  arguments: IntrospectedArgument[];
  options: IntrospectedOption[];
}
export interface CliManifest { name: string; description: string; commands: IntrospectedCommand[] }
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: "string"; description: string }>;
    required: string[];
  };
}

/**
 * Read invocable leaves from a live command tree, using full space-separated paths.
 * @param required Program port and the host's explicitly excluded command names.
 * @returns A plain manifest preserving command/argument/option order and defaults.
 * @complexity O(c + f), where c is the number of commands and f the total fields.
 */
export function introspectProgram({ program, excludedCommands }: {
  program: IntrospectionCommand;
  excludedCommands: readonly string[];
}): CliManifest {
  const excluded = new Set(excludedCommands);
  const commands: IntrospectedCommand[] = [];
  function visit(command: IntrospectionCommand, path: readonly string[]): void {
    // Root meta commands describe the CLI itself; nested namesakes remain invocable capabilities.
    if (path.length === 0 && excluded.has(command.name())) return;
    const fullPath = [...path, command.name()];
    // Group commands only print usage in this command model; expose their invocable leaves.
    // Full paths still fit the flat manifest consumed by callers written before nesting existed.
    if (command.commands.length > 0) {
      for (const child of command.commands) visit(child, fullPath);
      return;
    }
    commands.push({
      name: fullPath.join(" "), description: command.description(),
      arguments: command.registeredArguments.map((arg) => ({ name: arg.name(), required: arg.required, description: arg.description ?? "" })),
      options: command.options.map((opt) => ({
        flags: opt.flags, attributeName: opt.attributeName(), description: opt.description ?? "",
        required: opt.mandatory, defaultValue: opt.defaultValue,
        takesValue: opt.flags.includes("<") || opt.flags.includes("["),
      })),
    });
  }
  for (const command of program.commands) visit(command, []);
  return { name: program.name(), description: program.description(), commands };
}

/**
 * Project a CLI manifest into string-valued MCP input schemas; boolean switches are omitted.
 * @param required Manifest and caller-owned prefix (including any desired separator).
 * @returns One tool per leaf command, with spaces in invocation paths replaced by underscores.
 * @complexity O(c + f), for commands and argument/option fields.
 */
export function toMcpTools({ manifest, toolNamePrefix }: {
  manifest: CliManifest;
  toolNamePrefix: string;
}): McpToolDefinition[] {
  // argv supplies strings; numeric/enum validation belongs to command handlers, not this projection.
  // Invocation paths remain space-separated in the manifest, but tool names must be single tokens.
  return manifest.commands.map((command) => {
    const properties: McpToolDefinition["inputSchema"]["properties"] = {};
    const required: string[] = [];
    for (const arg of command.arguments) {
      Object.defineProperty(properties, arg.name, { value: { type: "string", description: arg.description }, enumerable: true, configurable: true, writable: true });
      if (arg.required) required.push(arg.name);
    }
    for (const option of command.options) {
      if (!option.takesValue) continue;
      Object.defineProperty(properties, option.attributeName, { value: { type: "string", description: option.description }, enumerable: true, configurable: true, writable: true });
      if (option.required) required.push(option.attributeName);
    }
    return { name: `${toolNamePrefix}${command.name.replace(/\s+/g, "_")}`, description: command.description, inputSchema: { type: "object", properties, required } };
  });
}

/** Output formats the `introspect` command body accepts. */
export const INTROSPECTION_FORMATS = ['commander', 'mcp'] as const;
export type IntrospectionFormat = (typeof INTROSPECTION_FORMATS)[number];

function isIntrospectionFormat(format: string): format is IntrospectionFormat {
  return (INTROSPECTION_FORMATS as readonly string[]).includes(format);
}

/**
 * The `introspect` command body: print the live manifest (`commander`) or its MCP projection (`mcp`).
 * Formats output only and never maps errors to exit codes itself — an unknown format throws the
 * host's own validation error (from `invalid`), which the host's outcome mapper classifies.
 * This entry is universal, so both I/O ports are required: there is no `process.stdout` default.
 * @param required.manifest - from {@link introspectProgram} over the host's live tree.
 * @param required.format - raw `--format` value; defaults to `commander`.
 * @param required.toolNamePrefix - the host's MCP tool-name prefix (including any separator).
 * @param required.output - receives the whole JSON text plus a trailing newline, once.
 * @param required.invalid - mints the error thrown for an unknown format.
 * @throws whatever `invalid` returns, before anything is printed.
 * @complexity O(c + f) for the MCP projection plus `JSON.stringify`.
 */
export function printIntrospection(
  { manifest, format = 'commander', toolNamePrefix, output, invalid }: {
    manifest: CliManifest;
    format?: string;
    toolNamePrefix: string;
    output: (required: { message: string }) => void;
    invalid: (required: { message: string }) => Error;
  },
  _optional: Record<string, never> = {},
): void {
  if (!isIntrospectionFormat(format)) {
    throw invalid({ message: `--format must be one of: ${INTROSPECTION_FORMATS.join(', ')} (got "${format}")` });
  }
  const printed = format === 'mcp' ? toMcpTools({ manifest, toolNamePrefix }) : manifest;
  output({ message: `${JSON.stringify(printed, null, 2)}\n` });
}

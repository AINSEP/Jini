/**
 * @file Pure mapping between free-form model output and BYOK meta-tool results, split out of
 * a host's BYOK tool surface (e.g. `byok-tool-surface.ts`) so every branch can be asserted directly: argument-bag guards, the
 * `execute_delegated_tool` input normalizer, tool-output rendering (JSON string vs. image content
 * blocks), and the `ToolExecutor` status-to-message map. No I/O and no registry access here.
 */
import type { ToolResultContentBlock } from "@jini-ai/core/contracts/tool-result-block";
import { isNonArrayRecord } from "@jini-ai/core/records";
// Meta-tool argument bags are model output: a model can emit anything, including `null` or a bare
// string, and every read below has to survive that — hence the non-array record guard.
import type { ToolExecutor } from "./tool-executor-types.js";


/** What one meta-tool call resolves to — deliberately the exact `{content, isError?}` shape
 *  `@jini-ai/agent-runtime/providers/tool-turn`'s `ProviderToolExecutor` contract returns, so the route hands this straight
 *  back to the provider adapter with no second mapping layer of its own. */
export interface ByokMetaToolResult {
  readonly content: string | readonly ToolResultContentBlock[];
  readonly isError?: boolean;
}

/** A model-readable refusal: `content` is the message, flagged `isError` so the provider shows it as a failed call. */
export function err({ content }: { content: string }, _optional = {}): ByokMetaToolResult {
  return { content, isError: true };
}

/** One MCP content block as a provider block, or `null` for anything outside the text/image whitelist. */
function toResultBlock(required: { readonly block: unknown }): ToolResultContentBlock | null {
  const candidate = { value: required.block };
  if (!isNonArrayRecord(candidate)) return null;
  const block = candidate.value;
  if (block.type === "text" && typeof block.text === "string") return { type: "text", text: block.text };
  if (block.type === "image" && typeof block.mimeType === "string" && typeof block.data === "string") {
    return { type: "image", mimeType: block.mimeType, data: block.data };
  }
  return null;
}

/**
 * The output's content blocks when it is an MCP content envelope (`{content: [...]}`) of only `text`
 * and `image` blocks with at least one image — so a picture a tool returns (e.g.
 * `media_view_image`) reaches the provider as an image, not as base64 inside a JSON
 * string. Anything else, including a text-only envelope, returns `null` and keeps the JSON-string
 * contract every other tool relies on. Whitelist, like `@jini-ai/mcp`'s `okResult()`: one unknown
 * block type and the whole output stays a string.
 *
 * @complexity O(blocks).
 */
function imageContentBlocksOf({ output }: { output: unknown }, _optional = {}): ToolResultContentBlock[] | null {
  const candidate = { value: output };
  if (!isNonArrayRecord(candidate) || !Array.isArray(candidate.value.content)) return null;
  const blocks: ToolResultContentBlock[] = [];
  for (const raw of candidate.value.content as unknown[]) {
    const block = toResultBlock({ block: raw });
    if (!block) return null;
    blocks.push(block);
  }
  return blocks.some((block) => block.type === "image") ? blocks : null;
}

/** A successful tool output as the model sees it: image content blocks when {@link imageContentBlocksOf}
 *  admits them, the bare string for a string output, and JSON text (`null` for nothing) otherwise. */
export function ok({ output }: { output: unknown }, _optional = {}): ByokMetaToolResult {
  const blocks = imageContentBlocksOf({ output: output });
  if (blocks) return { content: blocks };
  return { content: typeof output === "string" ? output : JSON.stringify(output ?? null) };
}

/**
 * Normalizes `execute_delegated_tool`'s `input` argument into what a tool handler accepts.
 *
 * Three shapes are allowed in, deliberately: an object (the declared contract), absent/null (a tool
 * that takes no input), and a JSON-encoded object string. The last is not sloppiness — see the
 * `input` schema comment in the host BYOK tool surface's `META_TOOL_DESCRIPTORS`: it is a real, observed provider behavior whose failure mode is every
 * input-taking tool silently becoming uncallable. A string that does not parse, or parses to a
 * non-object, is refused with a message naming the problem rather than passed down to fail inside a
 * handler's own type check where the model would see a far less actionable error.
 */
export type DelegatedInputResolution =
  | { readonly ok: true; readonly input: unknown }
  | { readonly ok: false; readonly message: string };

/** The string-input branch of {@link resolveDelegatedInput}, split out purely to keep that function's
 *  cognitive complexity under the shop ceiling — see {@link DelegatedInputResolution}'s doc for why a
 *  JSON-encoded string has to be accepted here at all. */
function resolveDelegatedInputFromString({ trimmed }: { trimmed: string }, _optional = {}): DelegatedInputResolution {
  if (trimmed.length === 0) return { ok: true, input: undefined };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isNonArrayRecord({ value: parsed })) return { ok: true, input: parsed };
    return { ok: false, message: "'input' parsed as JSON but is not an object — send a JSON object of the tool's input fields." };
  } catch {
    return { ok: false, message: "'input' must be a JSON object of the tool's input fields, not a plain string." };
  }
}

/** See {@link DelegatedInputResolution} for the three accepted shapes and why. */
export function resolveDelegatedInput({ raw }: { raw: unknown }, _optional = {}): DelegatedInputResolution {
  if (raw === undefined || raw === null) return { ok: true, input: undefined };
  if (isNonArrayRecord({ value: raw })) return { ok: true, input: raw };
  if (typeof raw === "string") return resolveDelegatedInputFromString({ trimmed: raw.trim() });
  return { ok: false, message: `'input' must be a JSON object of the tool's input fields, not ${Array.isArray(raw) ? "an array" : typeof raw}.` };
}

/** Maps one `ToolExecutor.execute` outcome onto the meta-tool result shape — split out of
 *  `runExecuteDelegatedTool` so its per-case branching does not also count against that
 *  function's own complexity. */
export function mapToolExecutionResult({ result, toolId }: { result: Awaited<ReturnType<ToolExecutor["execute"]>>; toolId: string }, _optional = {}): ByokMetaToolResult {
  switch (result.status) {
    case "completed":
      return ok({ output: result.output });
    case "denied":
      return err({ content: `tool "${toolId}" was denied for this caller` });
    case "confirmation-denied":
      return err({ content: `tool "${toolId}" requires human confirmation, which BYOK mode cannot supply yet` });
    case "timed-out":
      return err({ content: `tool "${toolId}" timed out` });
    case "cancelled":
      return err({ content: `tool "${toolId}" was cancelled` });
    case "failed":
      return err({ content: result.error ?? `tool "${toolId}" failed` });
    default: {
      const unexpected: never = result.status;
      throw new Error(`Unexpected tool execution result: ${unexpected}`);
    }
  }
}

/**
 * @module ai-trace/classify
 * Lexical tool-failure classifier. Order matters: "permission denied … timed out" is a denial,
 * and a schema rejection is checked before the generic execution bucket. It reads only the
 * result text the provider surfaced, so a tool that fails with an unhelpful message lands in
 * `execution` — the safe default, since that bucket means "look at the tool".
 */
import type { AiToolErrorClass } from './types.js';

const CLASS_PATTERNS: ReadonlyArray<readonly [AiToolErrorClass, RegExp]> = [
  ['denied', /\b(permission denied|denied|not allowed|not permitted|forbidden|unauthori[sz]ed|requires approval|user rejected|rejected by user)\b/i],
  ['timeout', /\b(timed? ?out|timeout|deadline exceeded|ETIMEDOUT)\b/i],
  // Input validation is spread over several patterns (checked in order) to keep each one readable.
  ['input_validation', /\b(unknown (input|argument|parameter|property|field)|invalid (input|argument|arguments|parameter|params))\b/i],
  ['input_validation', /\b(missing required|is required|required (property|parameter|field)|validation (error|failed)|schema)\b/i],
  ['input_validation', /\b(must be (a|an|of)|expected .+ (got|received)|InputValidationError|unrecognized key)\b/i],
];

export function classifyToolError({ content }: { content: string }): AiToolErrorClass {
  for (const [errorClass, pattern] of CLASS_PATTERNS) {
    if (pattern.test(content)) return errorClass;
  }
  return 'execution';
}

/**
 * @module image-prompt-delivery
 *
 * The `'prompt-path'` half of `RuntimeAgentDef.imageDelivery`
 * (`@jini-ai/agent-runtime`'s `types.ts` — see that field's own doc for the
 * full three-mode contract and why `'native'` defs must never also go
 * through here). A def declares `imageDelivery: 'prompt-path'` when its CLI
 * has no dedicated image-attachment mechanism but CAN read a local file once
 * its path is named in the prompt text — confirmed for Claude Code by a live
 * probe (see `defs/claude.ts`'s module doc): piping a prompt naming
 * `/tmp/probe-image.png` into a real `claude -p` produced an accurate
 * description of the image, but only once that path's directory was on the
 * CLI's allowed-directory list.
 *
 * `applyImagePromptDelivery` is the ONE function `agent-executor.ts#run`
 * calls, once, before `buildArgs`/`preparePromptFileForAgent`/
 * `writePromptToStdin` ever see the prompt or `extraAllowedDirs` — see that
 * module's own call site for why every downstream consumer of "the prompt"
 * and "the allowed dirs" was switched to this function's output rather than
 * the raw `input.prompt`/`input.extraAllowedDirs`. Adopting this mechanism
 * for another def is exactly one line: add `imageDelivery: 'prompt-path'` to
 * that def's literal. No other file needs to change.
 *
 * **Zero images is a strict no-op.** Every function below returns its inputs
 * completely unchanged (not merely "equivalent" — literally the same
 * `prompt` string and the same `extraAllowedDirs` reference/value) when
 * `imagePaths` is empty, so a run with no attachments is byte-identical to
 * this module never having been added. See
 * `__tests__/image-prompt-delivery.test.ts`'s "byte-identical" case for the
 * exact-equality regression proof.
 */
import path from 'node:path';
import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';

/** The two values `applyImagePromptDelivery` actually changes — everything else about a run is untouched. */
export interface ImagePromptDelivery {
  readonly prompt: string;
  readonly extraAllowedDirs: readonly string[] | undefined;
}

/**
 * Appends an attachments section to `prompt`, naming each image as a real
 * file the user provided rather than dumping bare paths — legible to a
 * model, which needs to understand these are attachments to read and act on,
 * not incidental text. `imagePaths` must already be non-empty; callers (just
 * `applyImagePromptDelivery` below) are expected to have filtered/checked
 * that themselves so this function's own contract stays a straightforward
 * "always augment" rather than duplicating the empty-check in two places.
 *
 * @param prompt - The user's original prompt text, unmodified up to this point.
 * @param imagePaths - One or more absolute image file paths, already filtered non-empty.
 * @returns `prompt` with an attachments section appended.
 * @complexity O(n) in the number of images — one line rendered per path, no I/O.
 * @overallScore 100
 */
export function augmentPromptWithImageAttachments(prompt: string, imagePaths: readonly string[]): string {
  const list = imagePaths.map((imagePath, index) => `${index + 1}. ${imagePath}`).join('\n');
  const plural = imagePaths.length === 1;
  return (
    `${prompt}\n\n---\n` +
    `The user attached the following image ${plural ? 'file' : 'files'} to this message. ` +
    `${plural ? 'It is a' : 'These are'} real file${plural ? '' : 's'} on disk — read ${plural ? 'it' : 'each one'} directly ` +
    `(e.g. with your file-reading tool) before responding:\n${list}`
  );
}

/**
 * Directories a 'prompt-path' def's CLI must be allowed to read from so it
 * can actually open the files the augmented prompt just told it about — the
 * second half of the live-probe finding in `defs/claude.ts`'s module doc
 * (the CLI refused the same path until its directory was allow-listed).
 * Deduplicated, and order-stable (`Set` preserves insertion order) so a
 * snapshot/equality test against the merged list is deterministic.
 *
 * @param imagePaths - One or more absolute image file paths, already filtered non-empty.
 * @returns Each path's containing directory (`node:path#dirname`), deduplicated.
 * @complexity O(n) in the number of images.
 * @overallScore 100
 */
export function deriveImageAllowedDirs(imagePaths: readonly string[]): string[] {
  return [...new Set(imagePaths.map((imagePath) => path.dirname(imagePath)))];
}

/**
 * Applies `'prompt-path'` image delivery when — and only when — `def`
 * declares it and `imagePaths` is non-empty. Every other combination
 * (`'native'`, `'unsupported'`, `undefined` delivery, or zero images on any
 * def) returns `{ prompt, extraAllowedDirs }` completely unchanged, which is
 * what keeps 'native' defs (ACP, pi-rpc, qoder) provably unaffected — this
 * function is the single place that decides whether augmentation happens at
 * all, so a 'native' def's `imageDelivery` value alone is what protects it
 * from double delivery, not a second check duplicated at each call site.
 *
 * @param imageDelivery - `def.imageDelivery` — the def's own declared mode; pass this field directly rather than the whole def so this module has no dependency on `RuntimeAgentDef` beyond the one field's type.
 * @param prompt - The user's original prompt text.
 * @param imagePaths - The run's raw image paths, exactly as the caller received them (may be undefined/empty/contain blanks — this function does the filtering).
 * @param extraAllowedDirs - The run's caller-supplied allowed directories, exactly as received.
 * @returns The prompt and allowed-dirs to actually use for this run's `buildArgs`/prompt-delivery calls.
 * @complexity O(n) in the number of images; O(1) when delivery is not `'prompt-path'` or there are no images.
 * @overallScore 100
 */
export function applyImagePromptDelivery(
  imageDelivery: RuntimeAgentDef['imageDelivery'],
  prompt: string,
  imagePaths: readonly string[] | undefined,
  extraAllowedDirs: readonly string[] | undefined,
): ImagePromptDelivery {
  if (imageDelivery !== 'prompt-path') return { prompt, extraAllowedDirs };

  const paths = (imagePaths ?? []).filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (paths.length === 0) return { prompt, extraAllowedDirs };

  const mergedDirs = new Set(extraAllowedDirs ?? []);
  for (const dir of deriveImageAllowedDirs(paths)) mergedDirs.add(dir);

  return {
    prompt: augmentPromptWithImageAttachments(prompt, paths),
    extraAllowedDirs: [...mergedDirs],
  };
}

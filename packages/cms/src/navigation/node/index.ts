/** Node navigation adapter: the public barrel stays compatible, while HTML writes receive
 * parse5 normalization. Item services and all persistence/permission policy stay universal.
 * @example import { createMenu } from "@jini-ai/cms/navigation/node";
 */
import { parseFragment, serialize } from "parse5";
import { mergeMenuHtml as mergeUniversalMenuHtml, type MenuHtmlOptions } from "../menu-html.js";
import {
  createMenu as createUniversalMenu, updateMenuTree as updateUniversalMenuTree,
  type CreateMenuRequired, type CreateMenuOptional, type UpdateMenuTreeRequired, type UpdateMenuTreeOptional,
} from "../menu-service.js";
import { buildMenusRegistrations as buildUniversalMenusRegistrations, type MenusToolDeps } from "../tool-registrations.js";

export * from "../index.js";

/** Balance the fragment; scripts and authored styling stay as written (trusted markup).
 * @param required Trusted authored markup; the service enforces the length cap before calling.
 * @returns Balanced fragment, without dangling outer closers.
 * @complexity O(h) time and space in submitted HTML length.
 */
export function normalizeMenuHtml({ html }: { html: string }, _optional: Record<string, never> = {}): string {
  return serialize(parseFragment(html));
}

/** Supply Node normalization to the universal create owner; validation, errors, writes and
 * outbox publication are unchanged. Caller-provided normalization takes precedence.
 * @complexity Same tree/slug scans as the universal owner, plus O(h) HTML time and space.
 */
export function createMenu(required: CreateMenuRequired, optional: CreateMenuOptional = {}): ReturnType<typeof createUniversalMenu> {
  return createUniversalMenu({ ...required, deps: { ...required.deps, normalizeMenuHtml: required.deps.normalizeMenuHtml ?? normalizeMenuHtml } }, optional);
}

/** Supply Node normalization to the universal update owner, retaining its OCC and event contract.
 * @complexity Same tree/slug scans as the universal owner, plus O(h) HTML time and space.
 */
export function updateMenuTree(required: UpdateMenuTreeRequired, optional: UpdateMenuTreeOptional = {}): ReturnType<typeof updateUniversalMenuTree> {
  return updateUniversalMenuTree({ ...required, deps: { ...required.deps, normalizeMenuHtml: required.deps.normalizeMenuHtml ?? normalizeMenuHtml } }, optional);
}

/** Preserve the merge API for Node consumers, balancing only submitted HTML.
 * @complexity O(h) time and space in submitted HTML length; omitted HTML is O(1).
 */
export function mergeMenuHtml(required: Parameters<typeof mergeUniversalMenuHtml>[0], optional: MenuHtmlOptions = {}): ReturnType<typeof mergeUniversalMenuHtml> {
  return mergeUniversalMenuHtml(required, { ...optional, normalizeHtml: optional.normalizeHtml ?? normalizeMenuHtml });
}

/** Bind Node normalization once for the existing tool builder; permission checks and saves
 * remain in their universal owners. Construction is O(1) time and space (fixed catalog).
 */
export function buildMenusRegistrations(required: MenusToolDeps, _optional: Record<string, never> = {}): ReturnType<typeof buildUniversalMenusRegistrations> {
  return buildUniversalMenusRegistrations({ ...required, normalizeMenuHtml: required.normalizeMenuHtml ?? normalizeMenuHtml });
}

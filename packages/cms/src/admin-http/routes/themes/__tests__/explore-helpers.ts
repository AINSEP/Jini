import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { ExploreTheme } from "../explore-shared.js";

/** @file Shared fakes for the theme Explore route-spec tests: a fixed theme, the host error classes, a recording authorizer. */

export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;
export const THEME_SET = { permission: "theme.set", entityType: "presentation" };

/** Stand-ins for the host's two theme file error classes; the specs only see them through predicates. */
export class FakeReadOnlyError extends Error {}
export class FakePathError extends Error {}

/** One discovered theme, with one inherited template source. */
export function fakeTheme(overrides: Partial<ExploreTheme> = {}): ExploreTheme {
  return { manifest: { id: "t1" }, inheritedTemplateSources: { "templates/base.liquid": "{{ x }}" }, ...overrides };
}

/** The lookup + error-predicate deps every file route shares; `log` records each injected call in order. */
export function baseDeps(theme: ExploreTheme | undefined = fakeTheme()) {
  const log: string[] = [];
  return {
    log,
    findTheme: ({ themeId }: { themeId: string }) => { log.push(`find:${themeId}`); return theme?.manifest.id === themeId ? theme : undefined; },
    isThemeFileReadOnlyError: ({ err }: { err: unknown }) => err instanceof FakeReadOnlyError,
    isThemePathError: ({ err }: { err: unknown }) => err instanceof FakePathError,
  };
}

/** A recording `authorize`; `deny` throws, as the host port's 403 refusal would. */
export function recordingAuthorize(deny = false): {
  authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    authorize: async (required, optional = {}) => {
      calls.push({ ...required, ...optional });
      if (deny) throw new Error("denied theme.set");
    },
  };
}

/** Run `fn` and return the refusal it throws (status + flat body); fails if it does not refuse. */
export async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RouteRefusalError) return error.response;
    throw error;
  }
  throw new Error("expected a route refusal");
}

/** The raw input a host adapter hands `parse`. */
export const raw = (params: Record<string, string>, body: unknown = {}, query: Record<string, unknown> = {}) => ({ body, query, params });

/** The two file-error mappings every file route shares, plus an unmapped error that must reach the host 500. */
export const FILE_ERROR_CASES = [
  [new FakeReadOnlyError("'x' is generated"), { status: 403, body: { error: "'x' is generated", code: "GENERATED_READONLY" } }],
  [new FakePathError("'../x' escapes the theme"), { status: 400, body: { error: "'../x' escapes the theme", code: "INVALID_THEME_PATH" } }],
] as const;

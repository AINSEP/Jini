import { createContext, createElement, useContext } from 'react';
import type { ReactNode } from 'react';
import type { RedirectsTranslate, RedirectsMessageKey } from '../../models.js';
import { translateRedirectsEn } from '../../messages.en.js';
/** Node messages retain the host's locale-specific fragment ordering and DOM wrappers. */
export interface RedirectsRenderMessageInput {
  key: RedirectsMessageKey;
  vars?: Record<string, string | number>;
  shapeCode?: ReactNode;
}
export interface RedirectsReactOptions {
  t?: RedirectsTranslate;
  locale?: string;
  headerActions?: ReactNode;
  slots?: { renderMessage?: (required: RedirectsRenderMessageInput, optional?: Record<string, never>) => ReactNode };
}
export const RedirectsOptionsContext = createContext<RedirectsReactOptions>({});
/** English fallback preserves original fragments and the delete body's paragraph wrapper. */
function renderEnglishMessage({ key, vars = {}, shapeCode }: RedirectsRenderMessageInput): ReactNode {
  if (key === 'importRulesLabel') return ['Paste a JSON array of ', shapeCode, ' rule objects (1-500 items)'];
  return createElement('p', null, 'Delete the redirect rule from "', vars.fromPattern, '"?');
}
export function useRedirectsOptions(_required: Record<string, never> = {}, _optional = {}) {
  const options = useContext(RedirectsOptionsContext);
  return { ...options, t: options.t ?? translateRedirectsEn, locale: options.locale ?? 'en',
    renderMessage: options.slots?.renderMessage ?? renderEnglishMessage };
}

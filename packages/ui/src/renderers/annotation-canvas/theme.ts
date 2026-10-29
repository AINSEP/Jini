import { defaultAdminTheme } from '../../theme/default.js';

/** Canvas requires resolved colors rather than var() strings. Its injected canvas owns the DOM. */
export function resolveAnnotationTheme({ canvas }: { readonly canvas?: HTMLCanvasElement },
  { getComputedStyle }: { readonly getComputedStyle?: (element: Element) => CSSStyleDeclaration } = {}) {
  const document = canvas?.ownerDocument;
  const view = document?.defaultView;
  const readStyle = getComputedStyle ?? view?.getComputedStyle.bind(view);
  let style: CSSStyleDeclaration | undefined;
  if (document && readStyle) style = readStyle(canvas?.isConnected ? canvas : document.documentElement);
  const read = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
  return {
    stroke: read('--jini-danger', defaultAdminTheme.light.danger),
    target: read('--jini-primary', defaultAdminTheme.light.primary),
    bg: read('--jini-bg', defaultAdminTheme.light.bg),
    ink: read('--jini-primary-ink', defaultAdminTheme.light.primaryInk),
    font: read('--jini-font-body', defaultAdminTheme.fonts.body),
  };
}

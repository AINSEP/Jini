import { defaultAdminTheme } from '../core/theme/default.js';
import { adminThemeColorKeys, validateAdminTheme } from '../core/theme/validation.js';
import type { AdminTheme, AdminThemeDocument, AdminThemeTarget } from '../core/theme/types.js';

type FontLease = { readonly link: HTMLLinkElement; readonly owned: boolean; users: number };
const fontLeases = new WeakMap<AdminThemeDocument, Map<string, FontLease>>();

function acquireFont(document: AdminThemeDocument, href: string): () => void {
  const leases = fontLeases.get(document) ?? new Map<string, FontLease>();
  fontLeases.set(document, leases);
  const absolute = new URL(href, document.baseURI).href;
  let lease = leases.get(absolute);
  if (!lease) {
    const existing = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).find((link) => link.href === absolute);
    const link = existing ?? document.createElement('link');
    if (!existing) { link.rel = 'stylesheet'; link.href = absolute; link.setAttribute('data-jini-theme-font', ''); document.head.appendChild(link); }
    lease = { link, owned: !existing, users: 0 }; leases.set(absolute, lease);
  }
  const held = lease;
  held.users++;
  return () => { if (--held.users === 0) { if (held.owned) held.link.remove(); leases.delete(absolute); } };
}

/** Install both palettes on the injected scope and load fonts. Cleanup restores the host. */
export function applyAdminTheme({ theme }: { readonly theme: AdminTheme },
  { target, document }: { readonly target: AdminThemeTarget; readonly document: AdminThemeDocument }): () => void {
  const checked = validateAdminTheme({ theme });
  if (!checked.valid) throw new TypeError(checked.errors.join('; '));
  const values: Record<string, string> = {};
  for (const scheme of ['light', 'dark'] as const) for (const key of adminThemeColorKeys) {
    values[`--jini-theme-${scheme}-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`] = theme[scheme][key];
  }
  values['--jini-font-body'] = theme.fonts.body;
  values['--jini-font-heading'] = theme.fonts.heading;
  values['--jini-font-mono'] = theme.fonts.mono ?? defaultAdminTheme.fonts.mono!;
  values['--jini-radius'] = theme.radius ?? defaultAdminTheme.radius!;
  values['--jini-density'] = String(theme.density ?? defaultAdminTheme.density);
  const before = Object.keys(values).map((key) => ({ key, value: target.style.getPropertyValue(key), priority: target.style.getPropertyPriority(key) }));
  const previousName = target.getAttribute('data-admin-theme');
  const releases: (() => void)[] = [];
  const restore = () => {
    for (const { key, value, priority } of before) { if (value) target.style.setProperty(key, value, priority); else target.style.removeProperty(key); }
    if (previousName === null) target.removeAttribute('data-admin-theme'); else target.setAttribute('data-admin-theme', previousName);
    releases.forEach((release) => release());
  };
  try {
    for (const [key, value] of Object.entries(values)) target.style.setProperty(key, value);
    target.setAttribute('data-admin-theme', theme.name);
    for (const href of new Set(theme.fonts.load ?? [])) releases.push(acquireFont(document, href));
  } catch (error) { restore(); throw error; }
  let active = true;
  return () => { if (active) { active = false; restore(); } };
}

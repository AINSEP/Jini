import { readAdminSurfaceTheme, type AdminSurfaceTheme, type AdminSurfaceThemeToken } from "@jini-ai/agent-plugins/admin-surfaces";

/**
 * @file The admin's design tokens for plugin surfaces: which admin custom property each shared
 * `--jini-*` token is read from, and a watcher that reports a new theme when the person switches
 * light/dark or the admin theme.
 *
 * Why a map: the admin draws with its own names (`--fg`, `--primary`, `--r-sm`…), and an admin
 * theme may set those without touching the `--jini-*` names, so reading the Jini names alone would
 * give a surface colours the admin does not show. Tokens the admin has no name for are read under
 * their Jini name.
 */
const ADMIN_TOKEN_SOURCES: Readonly<Partial<Record<AdminSurfaceThemeToken, string>>> = {
  "--jini-bg": "--surface",
  "--jini-surface": "--surface-2",
  "--jini-bg-subtle": "--surface-2",
  "--jini-text": "--fg",
  "--jini-text-muted": "--muted",
  "--jini-border": "--border",
  "--jini-border-strong": "--border-strong",
  "--jini-primary": "--primary",
  "--jini-primary-ink": "--primary-ink",
  "--jini-link": "--link",
  "--jini-danger": "--danger",
  "--jini-danger-bg": "--danger-bg",
  "--jini-warning": "--warning",
  "--jini-font-ui": "--font-ui",
  "--jini-font-mono": "--font-mono",
  "--jini-font-size-xs": "--text-xs",
  "--jini-font-size-sm": "--text-sm",
  "--jini-font-size-base": "--text-base",
  "--jini-font-size-md": "--text-md",
  "--jini-radius-sm": "--r-sm",
  "--jini-radius-md": "--r-md",
  "--jini-space-1": "--space-1",
  "--jini-space-2": "--space-2",
  "--jini-space-3": "--space-3",
  "--jini-space-4": "--space-4",
};

/** The admin's current tokens (read from `body`, where the admin theme's values resolve). @complexity O(t). */
export function readAdminTheme(): AdminSurfaceTheme {
  const scheme = getComputedStyle(document.documentElement).colorScheme.includes("dark") ? "dark" : "light";
  return readAdminSurfaceTheme({ style: getComputedStyle(document.body), scheme }, { sources: ADMIN_TOKEN_SOURCES });
}

/**
 * Calls `onChange` with the new tokens after the admin's theme attributes, its theme stylesheets or
 * the system colour scheme change (once per frame, and only when a value actually changed).
 * @returns The function that stops watching.
 */
export function watchAdminTheme(required: { readonly onChange: (required: { theme: AdminSurfaceTheme }, optional?: Record<string, never>) => void }, _optional: Record<string, never> = {}): () => void {
  let last = JSON.stringify(readAdminTheme());
  let scheduled = 0;
  const check = () => {
    scheduled = 0;
    const theme = readAdminTheme();
    const text = JSON.stringify(theme);
    if (text !== last) { last = text; required.onChange({ theme }); }
  };
  const schedule = () => { if (scheduled === 0) scheduled = requestAnimationFrame(check); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { attributes: true });
  observer.observe(document.body, { attributes: true });
  observer.observe(document.head, { childList: true });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", schedule);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", schedule);
    if (scheduled !== 0) cancelAnimationFrame(scheduled);
  };
}

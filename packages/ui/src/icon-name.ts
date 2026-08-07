/**
 * Every icon `@jini-ai/ui`'s `Icon` component can render.
 *
 * A plain string union — data, not a component — so it lives here rather than
 * beside the React component that consumes it. Feature modules in this package
 * (memory's entry types, for one) name icons in their own contracts, and doing
 * that must not drag a React import across the boundary. `Icon.tsx` re-exports
 * this type, so existing importers are unchanged.
 */
export type IconName =
  | 'alert-triangle'
  | 'arrow-left'
  | 'arrow-up'
  | 'attach'
  | 'bell'
  | 'blocks'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'close'
  | 'copy'
  | 'comment'
  | 'message-circle'
  | 'discord'
  | 'download'
  | 'draw'
  | 'edit'
  | 'external-link'
  | 'eye'
  | 'eye-off'
  | 'file'
  | 'file-code'
  | 'file-text'
  | 'folder'
  | 'folder-filled'
  | 'fork'
  | 'github'
  | 'github-filled'
  | 'grip-vertical'
  | 'grid'
  | 'globe'
  | 'hammer'
  | 'help-circle'
  | 'history'
  | 'home'
  | 'home-filled'
  | 'image'
  | 'import'
  | 'info'
  | 'kanban'
  | 'layers-filled'
  | 'languages'
  | 'layout'
  | 'lightbulb'
  | 'link'
  | 'lock'
  | 'log-out'
  | 'integrations-filled'
  | 'maximize'
  | 'mic'
  | 'minimize'
  | 'minus'
  | 'more-horizontal'
  | 'orbit'
  | 'paint-bucket'
  | 'panel-left'
  | 'palette'
  | 'palette-filled'
  | 'pencil'
  | 'plus'
  | 'plus-filled'
  | 'puzzle'
  | 'slides'
  | 'star'
  | 'swatchbook'
  | 'play'
  | 'present'
  | 'refresh'
  | 'reload'
  | 'search'
  | 'send'
  | 'settings'
  | 'share'
  | 'sliders'
  | 'smartphone'
  | 'spinner'
  | 'sparkles'
  | 'stop'
  | 'sun'
  | 'moon'
  | 'sun-moon'
  | 'terminal'
  | 'thumbs-down'
  | 'thumbs-up'
  | 'tweaks'
  | 'upload'
  | 'trash'
  | 'volume'
  | 'zoom-in'
  | 'zoom-out';

/**
 * Runtime enumeration of every {@link IconName}. A string union has no
 * runtime representation of its own, so this exists as the one place a
 * caller can enumerate/validate names at runtime — e.g. asserting a lookup
 * table (`Icon.tsx`'s `ICON_RENDERERS`) actually has an entry for every
 * name. Keep in sync with the union above; a mismatch here is a test-time
 * signal (see `Icon.test.tsx`'s key-set completeness check), not a
 * compile-time one, since TS can't derive a value from a type.
 */
export const ICON_NAMES: readonly IconName[] = [
  'alert-triangle', 'arrow-left', 'arrow-up', 'attach', 'bell', 'blocks', 'check',
  'chevron-down', 'chevron-left', 'chevron-right', 'close', 'copy', 'comment',
  'message-circle', 'discord', 'download', 'draw', 'edit', 'external-link', 'eye',
  'eye-off', 'file', 'file-code', 'file-text', 'folder', 'folder-filled', 'fork',
  'github', 'github-filled', 'grip-vertical', 'grid', 'globe', 'hammer', 'help-circle',
  'history', 'home', 'home-filled', 'image', 'import', 'info', 'kanban', 'layers-filled',
  'languages', 'layout', 'lightbulb', 'link', 'lock', 'log-out', 'integrations-filled',
  'maximize', 'mic', 'minimize', 'minus', 'more-horizontal', 'orbit', 'paint-bucket',
  'panel-left', 'palette', 'palette-filled', 'pencil', 'plus', 'plus-filled', 'puzzle',
  'slides', 'star', 'swatchbook', 'play', 'present', 'refresh', 'reload', 'search',
  'send', 'settings', 'share', 'sliders', 'smartphone', 'spinner', 'sparkles', 'stop',
  'sun', 'moon', 'sun-moon', 'terminal', 'thumbs-down', 'thumbs-up', 'tweaks', 'upload',
  'trash', 'volume', 'zoom-in', 'zoom-out',
];

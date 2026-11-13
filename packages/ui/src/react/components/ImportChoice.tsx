// Single tab/choice button for an import-source picker (e.g. "From GitHub"
// / "Upload zip" / "Upload folder"). Origin: `ImportChoice` in
// `PluginsView.tsx` (OD), verbatim structural port — all copy
// (title/body) is supplied by the caller as props, so there was nothing
// product-specific to strip. See archived UI source map.

import { Icon, type IconName } from './Icon.js';

export interface ImportChoiceProps {
  active: boolean;
  icon: IconName;
  title: string;
  body: string;
  onClick: () => void;
  className?: string;
}

export function ImportChoice({ active, icon, title, body, onClick, className }: ImportChoiceProps) {
  return (
    <button
      type="button"
      className={[
        'plugins-import-modal__choice',
        active ? 'is-active' : '',
        className,
      ].filter(Boolean).join(' ')}
      onClick={onClick}
    >
      <span className="plugins-import-modal__choice-icon" aria-hidden>
        <Icon name={icon} size={16} />
      </span>
      <span className="plugins-import-modal__choice-copy">
        <span>{title}</span>
        <span>{body}</span>
      </span>
    </button>
  );
}

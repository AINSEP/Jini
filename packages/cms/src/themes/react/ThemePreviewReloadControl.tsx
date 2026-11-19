import type { ReactNode } from 'react';
import { useThemePreviewReloadButton } from './use-theme-preview-reload-button.hooks.js';

export interface ThemePreviewReloadControlProps {
  label: string;
  failureLabel: string;
  reloadPreviews: () => Promise<void>;
  icon: ReactNode;
  disabled?: boolean;
  useReloadHook?: typeof useThemePreviewReloadButton;
}

export function ThemePreviewReloadControl({
  label,
  failureLabel,
  reloadPreviews,
  icon,
  disabled = false,
  useReloadHook = useThemePreviewReloadButton,
}: ThemePreviewReloadControlProps) {
  const { label: buttonLabel, reload, error } = useReloadHook({ label, failureLabel, reloadPreviews });
  return (
    <>
      <button
        type="button"
        className="theme-explore-fullscreen-trigger"
        aria-label={buttonLabel}
        title={buttonLabel}
        onClick={reload}
        disabled={disabled}
      >
        {icon}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </>
  );
}

import type { ComponentType } from "react";

/** `reloadPreviews` defaults inside the supplied hook to the real every-preview reload; a test passes its own. */
export function WiredThemePreviewReloadButton({ disabled, reloadPreviews, PreviewReloadControl,
  useThemePreviewReloadButtonHook }: { disabled?: boolean; reloadPreviews?: () => Promise<void>;
  PreviewReloadControl: ComponentType<{
    className: string;
    label: string;
    reload: () => void;
    disabled?: boolean;
  }>;
  useThemePreviewReloadButtonHook: (
    required: Record<string, never>,
    optional?: { reload?: () => Promise<void> },
  ) => { label: string; reload: () => void; error: string | null }; }) {
  const { label, reload, error } = useThemePreviewReloadButtonHook({}, reloadPreviews ? { reload: reloadPreviews } : {});
  return (
    <>
      <PreviewReloadControl className="theme-explore-fullscreen-trigger" label={label} reload={reload} {...(disabled === undefined ? {} : { disabled })} />
      {error ? <span role="alert">{error}</span> : null}
    </>
  );
}

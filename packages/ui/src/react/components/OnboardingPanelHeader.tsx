// Trivial title+body panel header, used above a form section. Origin:
// `OnboardingPanelHeader` in `EntryShell.tsx` (OD), verbatim
// structural port — title/body are caller-supplied props, so there was
// nothing product-specific to strip. See `070311a07^:packages/ui/source-map.md` (section "bucket-A flat atoms").

export interface OnboardingPanelHeaderProps {
  title: string;
  body: string;
  className?: string;
}

export function OnboardingPanelHeader({ title, body, className }: OnboardingPanelHeaderProps) {
  return (
    <div className={['onboarding-view__panel-head', className].filter(Boolean).join(' ')}>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

import { Button } from './button.js';

/**
 * Wire contract on top of the ported `Button` primitive — `label` becomes the button's text
 * child (A2UI wire props are plain data, not `children`). `onPress` is host-wired, not part of
 * the agent-facing wire schema — see action-button.manifest.ts.
 */
export interface ActionButtonProps {
  readonly label: string;
  readonly variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  readonly size?: 'default' | 'sm' | 'lg' | 'icon';
  readonly disabled?: boolean;
  readonly onPress?: () => void;
}

export function ActionButton({ label, variant, size, disabled, onPress }: ActionButtonProps) {
  return (
    <Button variant={variant} size={size} disabled={disabled} onClick={onPress}>
      {label}
    </Button>
  );
}

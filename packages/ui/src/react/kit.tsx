import { createContext, forwardRef, useContext, useState } from 'react';
import type { ComponentType, InputHTMLAttributes, ReactNode, Ref } from 'react';

/**
 * @file The component kit `@jini-ai/ui` renders its selects and secret inputs through. The host
 * builds one `UiKit` from whatever component library it uses and mounts `UiKitProvider` once at
 * each React root; this package never imports a component library itself.
 */

export interface SecretRevealRequired {
  /** The input's current value. A transition to `''` re-hides (the usual sign a save succeeded). */
  readonly value: unknown;
  /** The toggle's full accessible names, translated ("Show API key" / "Hide API key"). */
  readonly labels: { readonly show: string; readonly hide: string };
}

export interface SecretRevealOptional {
  /** Controlled mode: the host owns the shown/hidden state. */
  readonly revealed?: boolean;
  readonly onRevealedChange?: (revealed: boolean) => void;
}

/** What a kit's reveal hook returns: the show/hide state behind an eye toggle. */
export interface SecretReveal {
  readonly revealed: boolean;
  readonly inputType: 'password' | 'text';
  readonly toggleLabel: string;
  readonly toggle: () => void;
}

export interface KitSecretInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>, SecretRevealOptional {
  readonly label: string;
  readonly toggleLabels?: { readonly show: string; readonly hide: string };
  readonly toggleAttrs?: Readonly<Record<string, string | boolean | undefined>>;
  readonly ref?: Ref<HTMLInputElement>;
}

export interface UiKit {
  readonly components: { readonly SecretInput: ComponentType<KitSecretInputProps> };
  readonly hooks: {
    useOverlayContainer(required?: Record<string, never>, optional?: Record<string, never>): HTMLElement | null;
    useSecretReveal(required: SecretRevealRequired, optional?: SecretRevealOptional): SecretReveal;
  };
}

const UiKitContext = createContext<UiKit | null>(null);

/** Supplies the host's kit to every ui select and secret input below it. The first kit wins: a
 * later prop change is ignored so a re-render cannot swap components under mounted state.
 * @complexity O(1). */
export function UiKitProvider(required: { kit: UiKit; children: ReactNode }, _optional: Record<string, never> = {}) {
  const [kit] = useState(() => required.kit);
  return <UiKitContext.Provider value={kit}>{required.children}</UiKitContext.Provider>;
}

/** The mounted kit; throws in plain words when no `UiKitProvider` is above. @complexity O(1). */
export function useUiKit(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): UiKit {
  const kit = useContext(UiKitContext);
  if (!kit) {
    throw new Error('@jini-ai/ui selects and secret inputs need <UiKitProvider kit={...}> at the app root. '
      + 'Build the kit from your component library and mount the provider once per React root.');
  }
  return kit;
}

/** The kit's masked input, with `ref` forwarded to the underlying `<input>`. */
export const SecretInput = forwardRef<HTMLInputElement, KitSecretInputProps & { useUiKitHook?: typeof useUiKit }>(function UiKitSecretInput({ useUiKitHook = useUiKit, ...props }, ref) {
  const Impl = useUiKitHook().components.SecretInput;
  return <Impl {...props} ref={ref} />;
});

export const useOverlayContainer: UiKit['hooks']['useOverlayContainer'] = (required, optional) => useUiKit().hooks.useOverlayContainer(required, optional);
export const useSecretReveal: UiKit['hooks']['useSecretReveal'] = (required, optional) => useUiKit().hooks.useSecretReveal(required, optional);

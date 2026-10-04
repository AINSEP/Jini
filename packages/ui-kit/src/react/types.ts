import type { ComponentType, ReactNode, Ref, RefObject, HTMLAttributes } from 'react';
import type { KitAttrs, AgentAttrsPort } from '../attrs.js';
import type { ConfirmInput, DismissReason } from '../confirm.js';
import type { ImplementedComponentName } from '../kit.spec.js';
import type { KitNeeds } from '../needs.js';
import type { ToastService } from '../toast.js';
export interface BaseProps { readonly attrs?: KitAttrs; readonly className?: string }
export type ActionPort = (required: Record<string, never>, optional?: Record<string, never>) => void;
export type ValuePort<T> = (required: { value: T }, optional?: Record<string, never>) => void;
export interface ButtonProps extends BaseProps {
  readonly children?: ReactNode; readonly onPress?: ActionPort; readonly disabled?: boolean; readonly pending?: boolean;
  readonly variant?: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost'; readonly type?: 'button' | 'submit' | 'reset';
  readonly ref?: Ref<HTMLButtonElement>;
}
export interface IconButtonProps extends ButtonProps { readonly label: string }
export interface TextFieldProps extends BaseProps {
  readonly label: string; readonly value: string; readonly onValueChange: ValuePort<string>;
  readonly disabled?: boolean; readonly required?: boolean; readonly placeholder?: string;
  readonly type?: 'text' | 'password' | 'email' | 'search' | 'url' | 'tel' | 'number'; readonly ref?: Ref<HTMLInputElement>;
}
export interface TextAreaProps extends Omit<TextFieldProps, 'type' | 'ref'> { readonly rows?: number; readonly ref?: Ref<HTMLTextAreaElement> }
export interface SelectOption { readonly value: string; readonly label: string; readonly disabled?: boolean }
export interface SelectProps extends Omit<TextFieldProps, 'type' | 'placeholder' | 'ref'> { readonly options: readonly SelectOption[]; readonly ref?: Ref<HTMLSelectElement> }
export interface CheckboxProps extends BaseProps { readonly label: string; readonly checked: boolean; readonly onCheckedChange: (required: { checked: boolean }, optional?: Record<string, never>) => void; readonly disabled?: boolean; readonly ref?: Ref<HTMLInputElement> }
export interface SwitchProps extends CheckboxProps {}
export interface DialogProps extends BaseProps { readonly open: boolean; readonly title: string; readonly children?: ReactNode; readonly onClose: ActionPort; readonly pending?: boolean; readonly closeLabel?: string; readonly ref?: Ref<HTMLDialogElement> }
export interface ConfirmDialogProps extends ConfirmInput, BaseProps {
  readonly body?: ReactNode; readonly onConfirm: (required: Record<string, never>, optional?: Record<string, never>) => void | Promise<void>; readonly onCancel: ActionPort; readonly errorLabel?: string;
  /** Concise names opt in to describing the consequence separately, preserving agent labels. */
  readonly actionAccessibleNames?: { readonly cancel: string; readonly confirm: string };
}
export interface ConfirmController {
  readonly className?: string | undefined;
  readonly nativeActions?: boolean;
  readonly open: boolean; readonly pending: boolean; readonly title: string; readonly body: ReactNode;
  readonly consequence: string | undefined; readonly error: ReactNode; readonly titleAttrs: HTMLAttributes<HTMLHeadingElement>;
  readonly consequenceAttrs?: HTMLAttributes<HTMLParagraphElement>;
  readonly frameAttrs: KitAttrs & { readonly role: 'alertdialog'; readonly 'aria-labelledby': string };
  readonly cancel: ButtonProps; readonly confirm: ButtonProps;
  readonly boundaryRef: RefObject<HTMLSpanElement | null>; readonly overlayContainer: HTMLElement | null;
  readonly agentMayConfirm: boolean;
  requestDismiss(required: { reason: DismissReason }, optional?: Record<string, never>): boolean;
  focusInitial(required: Record<string, never>, optional?: Record<string, never>): void;
}
/** Overrides receive a view model only. Raw destructive callbacks are never provided. */
export interface ConfirmViewProps { readonly controller: ConfirmController }
export interface TabItem { readonly id: string; readonly label: string; readonly content: ReactNode; readonly disabled?: boolean; readonly attrs?: KitAttrs }
export interface TabsProps extends BaseProps { readonly label: string; readonly value: string; readonly items: readonly TabItem[]; readonly onValueChange: ValuePort<string> }
export interface MenuItem { readonly id: string; readonly label: string; readonly disabled?: boolean; readonly onPress: ActionPort; readonly attrs?: KitAttrs }
export interface MenuProps extends BaseProps { readonly label: string; readonly items: readonly MenuItem[]; readonly disabled?: boolean }
export interface ToastProps extends BaseProps { readonly message: string; readonly tone?: 'info' | 'success' | 'warning' | 'danger'; readonly onDismiss?: ActionPort; readonly dismissLabel?: string }
export interface TooltipProps extends BaseProps { readonly content: ReactNode; readonly children: ReactNode; readonly label?: string }
export interface NoticeProps extends BaseProps { readonly children: ReactNode; readonly tone?: 'info' | 'success' | 'warning' | 'danger' }
export interface SpinnerProps extends BaseProps { readonly label?: string }
export interface BadgeProps extends BaseProps { readonly children: ReactNode; readonly tone?: 'info' | 'success' | 'warning' | 'danger' }
export interface ReactKitProps {
  Button: ButtonProps; IconButton: IconButtonProps; TextField: TextFieldProps; TextArea: TextAreaProps;
  Select: SelectProps; Checkbox: CheckboxProps; Switch: SwitchProps; Dialog: DialogProps;
  ConfirmDialog: ConfirmViewProps; Tabs: TabsProps; Menu: MenuProps; Toast: ToastProps;
  Tooltip: TooltipProps; Notice: NoticeProps; Spinner: SpinnerProps; Badge: BadgeProps;
}
export type ReactKit = { readonly [K in ImplementedComponentName]: ComponentType<ReactKitProps[K]> };
export type GuardMode = 'fallback' | 'warn' | 'off';
export interface KitViolation { readonly component: ImplementedComponentName; readonly reasons: readonly string[] }
export interface ResolvedKit {
  readonly id: string; readonly contract: string; readonly components: ReactKit;
  readonly overrides: readonly ImplementedComponentName[]; readonly violations: KitViolation[];
  readonly failed: Set<ImplementedComponentName>; readonly guard: GuardMode;
}
export interface KitProviderProps {
  readonly kit?: ResolvedKit; readonly children: ReactNode; readonly agent?: AgentAttrsPort;
  readonly overlayContainer?: HTMLElement; readonly needs?: readonly KitNeeds[];
  readonly toast?: ToastService; readonly cancelLabel?: string; readonly guard?: GuardMode;
}
export interface KitContextValue {
  readonly kit: ResolvedKit; readonly agent: AgentAttrsPort | undefined; readonly overlayContainer: HTMLElement | null;
  readonly toast: ToastService | undefined; readonly cancelLabel: string; readonly guard: GuardMode;
}

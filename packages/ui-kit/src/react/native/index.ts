import { NativeButton, NativeIconButton, NativeTextField, NativeTextArea, NativeSelect, NativeCheckbox, NativeSwitch, NativeToast, NativeNotice, NativeSpinner, NativeBadge } from './Controls.js';
import { NativeDialog, NativeConfirmDialog } from './Dialog.js';
import { NativeTabs, NativeMenu, NativeTooltip } from './Navigation.js';
import type { ReactKit } from '../types.js';
export const nativeKit: ReactKit = Object.freeze({ Button: NativeButton, IconButton: NativeIconButton,
  TextField: NativeTextField, TextArea: NativeTextArea, Select: NativeSelect, Checkbox: NativeCheckbox,
  Switch: NativeSwitch, Dialog: NativeDialog, ConfirmDialog: NativeConfirmDialog, Tabs: NativeTabs,
  Menu: NativeMenu, Toast: NativeToast, Tooltip: NativeTooltip, Notice: NativeNotice, Spinner: NativeSpinner, Badge: NativeBadge });
// This is a concrete kit, rather than a forwarding subpath to another package's implementation.

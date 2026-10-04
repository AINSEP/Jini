import type { ReactKit, ReactKitProps, ConfirmDialogProps } from '../types.js';
import { createStrictKit, createKit } from '../kit.js';
import { nativeKit } from '../native/index.js';
import { kitSpec, type ImplementedComponentName } from '../../kit.spec.js';
createStrictKit({ components: nativeKit });
createKit({ components: { Button: nativeKit.Button } });
// @ts-expect-error A strict kit must supply every implemented component.
createStrictKit({ components: { Button: nativeKit.Button } });
// @ts-expect-error Misspelled components cannot silently become ignored overrides.
createKit({ components: { Buton: nativeKit.Button } });
const { ConfirmDialog: _confirm, ...missingConfirm } = nativeKit;
// @ts-expect-error ConfirmDialog is overridable and required in strict mode, just like all other slots.
createStrictKit({ components: missingConfirm });
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const namesMatch: Equal<keyof ReactKit, ImplementedComponentName> = true;
const propNamesMatch: Equal<keyof ReactKitProps, ImplementedComponentName> = true;
void namesMatch; void propNamesMatch;
type PublicProps<K extends ImplementedComponentName> = K extends 'ConfirmDialog' ? ConfirmDialogProps : ReactKitProps[K];
type SpecPropsMatch = { [K in ImplementedComponentName]: Equal<keyof PublicProps<K>, typeof kitSpec[K]['props'][number]> };
const specsMatch: SpecPropsMatch = {
  Button: true, IconButton: true, TextField: true, TextArea: true, Select: true, Checkbox: true, Switch: true,
  Dialog: true, ConfirmDialog: true, Tabs: true, Menu: true, Toast: true, Tooltip: true, Notice: true, Spinner: true, Badge: true,
};
void specsMatch;

import { Component, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShowMoreImports, type ShowMoreImportsButton } from './ShowMoreImports.js';

type KitAction = (required: Record<string, never>, optional?: Record<string, never>) => void;
/** Shaped like an admin kit button: a class whose defaultProps declare the two-object action. */
class KitButton extends Component<{ readonly children?: ReactNode; readonly onPress?: KitAction; readonly disabled?: boolean; readonly pending?: boolean }> {
  static defaultProps: Partial<{ onPress: KitAction }> = {};
  render() { return <button>{this.props.children}</button>; }
}
// Compile-time pin: a kit button with a two-object `onPress` fills the slot unchanged.
const kitSlot: ShowMoreImportsButton = KitButton;

describe('ShowMoreImports', () => {
  it('the supplied button renders only with a cursor and invokes the supplied loader once per press', () => {
    const loader = vi.fn();
    const Button = vi.fn(({ children }: { readonly children?: ReactNode; readonly onPress?: KitAction; readonly disabled?: boolean; readonly pending?: boolean }) => <button>{children}</button>);
    const props = { loading: false, onLoadMore: loader, Button, label: 'Show more imports' };
    expect(ShowMoreImports(props)).toBeNull();
    expect(Button).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<ShowMoreImports {...props} nextCursor="cursor" />)).toBe('<button>Show more imports</button>');
    const buttonProps = Button.mock.calls[0]![0];
    buttonProps.onPress?.({}, {});
    expect(kitSlot).toBe(KitButton);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith({}, {});
  });
});

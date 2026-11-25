import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShowMoreImports } from './ShowMoreImports.js';

describe('ShowMoreImports', () => {
  it('the supplied button renders only with a cursor and invokes the supplied loader once per press', () => {
    const loader = vi.fn();
    const Button = vi.fn(({ children }: { children: ReactNode; onPress: () => void | Promise<void>; disabled?: boolean; pending?: boolean }) => <button>{children}</button>);
    const props = { loading: false, onLoadMore: loader, Button, label: 'Show more imports' };
    expect(ShowMoreImports(props)).toBeNull();
    expect(Button).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<ShowMoreImports {...props} nextCursor="cursor" />)).toBe('<button>Show more imports</button>');
    const buttonProps = Button.mock.calls[0]![0];
    buttonProps.onPress();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith({}, {});
  });
});

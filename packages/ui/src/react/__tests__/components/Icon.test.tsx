// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Icon, ICON_RENDERERS, type IconName } from '../../components/Icon.js';
import { ICON_NAMES } from '../../../icon-name.js';

describe('Icon', () => {
  it('renders an svg with the requested size for a known name', () => {
    const { container } = render(<Icon name="check" size={20} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
  });

  it('applies the icon-spin class for the spinner icon', () => {
    const { container } = render(<Icon name="spinner" className="extra" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toBe('icon-spin extra');
  });

  it('defaults to a 14px stroke icon', () => {
    const { container } = render(<Icon name="close" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('14');
    expect(svg?.getAttribute('stroke-width')).toBe('1.6');
  });

  // The full, runtime-enumerable icon set (see `icon-name.ts`'s `ICON_NAMES`)
  // — every one of these must render an svg.
  it('renders an svg for every icon name', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  // Characterization pin for the name -> SVG mapping. The "renders an svg"
  // test above only checks *that* something rendered; it would not notice a
  // lookup-table rewrite that accidentally swapped two icons' markup (both
  // still render *an* svg). This snapshots the exact rendered markup per
  // name so a name -> wrong-content regression fails loudly.
  it('renders the exact, unchanged markup for every icon name', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.innerHTML).toMatchSnapshot(name);
      unmount();
    }
  });

  it('renders nothing for an unhandled name', () => {
    const { container } = render(<Icon name={'not-a-real-icon' as IconName} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('honors an explicit strokeWidth', () => {
    const { container } = render(<Icon name="check" strokeWidth={3} />);
    expect(container.querySelector('svg')?.getAttribute('stroke-width')).toBe('3');
  });
});

// `ICON_RENDERERS` exercised directly — a test seam exported from Icon.tsx
// (not the package's public API; see the comment at its declaration and the
// explicit named export in `packages/ui/src/index.ts`). These assertions
// are the ones the rendered-markup snapshots above cannot make: they don't
// prove the *key set* is complete, and they wouldn't catch an entry that
// silently became `undefined` or a non-function after a future edit.
describe('ICON_RENDERERS', () => {
  it('has exactly one entry per IconName, no more, no fewer', () => {
    // Catches both directions of drift: a name added to the `IconName`
    // union with no matching table entry (already a TS compile error today,
    // but this also guards a future non-Record refactor), and an entry
    // keyed by a string that isn't a valid IconName at all (a `Record<IconName,
    // ...>` doesn't prevent excess keys via the object literal itself, so
    // that direction is untyped and only this runtime check catches it).
    expect(Object.keys(ICON_RENDERERS).sort()).toEqual([...ICON_NAMES].sort());
  });

  it('is a function for every icon name that returns a renderable element', () => {
    for (const name of ICON_NAMES) {
      const render = ICON_RENDERERS[name];
      expect(typeof render).toBe('function');
      expect(isValidElement(render({}))).toBe(true);
    }
  });
});

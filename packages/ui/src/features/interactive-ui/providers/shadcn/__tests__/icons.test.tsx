/**
 * Pins the vendored icons in `../icons.tsx` to the exact markup Lucide v1.32.0's React package
 * renders. Each `expected` string below was captured from that package rendering the same props,
 * and a second `it.each` rendered the upstream icons against these same strings and passed (15/15,
 * 2026-09-12) before the dependency was removed, so the strings are upstream output, not a
 * restatement of the local implementation. The cases are the props the shadcn call sites pass
 * (Radix's `Select.Icon asChild` merges `aria-hidden` into `ChevronDown`), plus no props and an
 * accessibility label, which turns off the automatic `aria-hidden`.
 */
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Check, ChevronDown, ChevronUp, Circle } from '../icons.js';

const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const CASES = [
  {
    name: 'Check',
    props: { className: 'h-4 w-4' },
    expected: `${SVG_OPEN} class="lucide lucide-check h-4 w-4" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>`,
  },
  {
    name: 'ChevronDown',
    props: { className: 'h-4 w-4 opacity-50', 'aria-hidden': true },
    expected: `${SVG_OPEN} class="lucide lucide-chevron-down h-4 w-4 opacity-50" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`,
  },
  {
    name: 'ChevronDown',
    props: { className: 'h-4 w-4' },
    expected: `${SVG_OPEN} class="lucide lucide-chevron-down h-4 w-4" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`,
  },
  {
    name: 'ChevronUp',
    props: { className: 'h-4 w-4' },
    expected: `${SVG_OPEN} class="lucide lucide-chevron-up h-4 w-4" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg>`,
  },
  {
    name: 'Circle',
    props: { className: 'h-3.5 w-3.5 fill-primary' },
    expected: `${SVG_OPEN} class="lucide lucide-circle h-3.5 w-3.5 fill-primary" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle></svg>`,
  },
  {
    name: 'Check',
    props: {},
    expected: `${SVG_OPEN} class="lucide lucide-check" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>`,
  },
  {
    name: 'Check',
    props: { 'aria-label': 'Selected' },
    expected: `${SVG_OPEN} class="lucide lucide-check" aria-label="Selected"><path d="M20 6 9 17l-5-5"></path></svg>`,
  },
] as const;

const LOCAL = { Check, ChevronDown, ChevronUp, Circle };

describe('shadcn provider icons', () => {
  it.each(CASES)('$name with $props renders the expected markup', ({ name, props, expected }) => {
    const Icon = LOCAL[name];
    const { container } = render(<Icon {...props} />);
    expect(container.innerHTML).toBe(expected);
  });

  it('forwards a ref to the rendered svg element', () => {
    const ref = createRef<SVGSVGElement>();
    const { container } = render(<ChevronDown ref={ref} />);
    expect(ref.current).toBeInstanceOf(SVGSVGElement);
    expect(ref.current).toBe(container.firstChild);
  });
});

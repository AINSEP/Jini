/**
 * Local copies of the only four Lucide icons this package renders, used by the shadcn `checkbox`,
 * `radio-group` and `select` primitives. Vendored so `@jini-ai/ui` no longer installs the whole
 * Lucide React package for them.
 *
 * Source: Lucide v1.32.0, React package. Each icon's node data is copied verbatim from that
 * package's `dist/esm/icons/{check,chevron-down,chevron-up,circle}.mjs`. `createIcon` reproduces the
 * markup of its `dist/esm/createLucideIcon.mjs`, `dist/esm/Icon.mjs` and
 * `dist/esm/defaultAttributes.mjs`: default attributes, `lucide lucide-<name>` class names,
 * `aria-hidden="true"` unless an accessibility prop is passed, and a forwarded ref. It omits the
 * `size`, `color`, `absoluteStrokeWidth` and `children` handling and the context provider, which no
 * call site uses. `__tests__/icons.test.tsx` pins the rendered markup to that package's output.
 *
 * ISC License
 *
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Lucide's LICENSE lists all four icons (check, chevron-down, chevron-up, circle) as derived from
 * the Feather project, under this notice:
 *
 * The MIT License (MIT) (for the icons listed above)
 *
 * Copyright (c) 2013-present Cole Bemis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { forwardRef, type SVGAttributes, type SVGProps } from 'react';

type IconNode = ReadonlyArray<readonly [tag: 'path' | 'circle', attrs: SVGAttributes<SVGElement> & { key: string }]>;

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref' | 'children'>;

const DEFAULT_ATTRIBUTES = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** True when the caller labelled the icon itself, so it must stay visible to assistive tech. */
function hasA11yProp(props: object): boolean {
  return Object.keys(props).some((prop) => prop.startsWith('aria-') || prop === 'role' || prop === 'title');
}

/**
 * Builds one icon component.
 *
 * @param name - Lucide's kebab-case icon name, used for the `lucide-<name>` class.
 * @param displayName - React DevTools name, matching Lucide's.
 * @param node - The icon's child elements.
 * @returns A ref-forwarding component rendering `<svg>` with `node` as its children.
 * @complexity O(n) per render in the number of child elements (1 for all four icons).
 */
function createIcon(name: string, displayName: string, node: IconNode) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(({ className, ...rest }, ref) => (
    <svg
      ref={ref}
      {...DEFAULT_ATTRIBUTES}
      className={['lucide', `lucide-${name}`, className].filter((value) => value && value.trim() !== '').join(' ')}
      {...(hasA11yProp(rest) ? {} : { 'aria-hidden': 'true' as const })}
      {...rest}
    >
      {node.map(([Tag, { key, ...attrs }]) => (
        <Tag key={key} {...attrs} />
      ))}
    </svg>
  ));
  Icon.displayName = displayName;
  return Icon;
}

export const Check = createIcon('check', 'Check', [['path', { d: 'M20 6 9 17l-5-5', key: '1gmf2c' }]]);
export const ChevronDown = createIcon('chevron-down', 'ChevronDown', [['path', { d: 'm6 9 6 6 6-6', key: 'qrunsl' }]]);
export const ChevronUp = createIcon('chevron-up', 'ChevronUp', [['path', { d: 'm18 15-6-6-6 6', key: '153udz' }]]);
export const Circle = createIcon('circle', 'Circle', [['circle', { cx: '12', cy: '12', r: '10', key: '1mglay' }]]);

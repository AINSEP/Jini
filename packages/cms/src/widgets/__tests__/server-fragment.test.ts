import { expect, it } from 'vitest';
import { validateServerWidgetFragment } from '../html/server-fragment.js';
it('admits native server-rendered HTML and rejects same-origin executable markup and excess bytes', () => {
  expect(validateServerWidgetFragment({ html: '<form action="/api/p/example/book" method="post"><button>Book</button></form>' })).toContain('Book');
  for (const html of ['<script>alert(1)</script>','<img src="/x" onerror="alert(1)">','<a href="java&#x73;cript:alert(1)">x</a>','<svg><a>bad</a></svg>','<iframe src="/admin"></iframe>','<div style="color:red">x</div>']) expect(() => validateServerWidgetFragment({ html })).toThrow();
  expect(() => validateServerWidgetFragment({ html: 'éé' }, { maxBytes: 3 })).toThrow(/size cap/);
});

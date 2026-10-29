import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { purgeStorage } from '../client/index.js';

it('purges only declared cookie and local-storage prefixes through the public client API', () => {
  const dom = new JSDOM('', { url: 'https://site.example/' });
  try {
    const { document, localStorage } = dom.window;
    document.cookie = 'vendor_id=secret; Path=/';
    document.cookie = 'keep_id=retained; Path=/';
    localStorage.setItem('vendor_id', 'secret');
    localStorage.setItem('vendor_queue', 'queued');
    localStorage.setItem('keep_id', 'retained');
    purgeStorage({ doc: document, storage: { cookies: ['vendor_'], local: ['vendor_'] } });
    expect(document.cookie).toBe('keep_id=retained');
    expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index))).toEqual(['keep_id']);
    expect(localStorage.getItem('keep_id')).toBe('retained');
  } finally { dom.window.close(); }
});

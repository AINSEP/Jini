import { expect, test } from 'vitest';
import { redactOAuthUrls } from '../src/index.js';

test('redacts every URL the provider-owned pattern matches and leaves every other byte intact', () => {
    const text = 'open https://auth.example.com/authorize?code=abc then https://auth.example.com/token\n(done)';
    expect(redactOAuthUrls({ text, pattern: /https:\/\/auth\.example\.com\/\S+/g, replacement: '[redacted]' }))
        .toBe('open [redacted] then [redacted]\n(done)');
});

test('a non-global pattern redacts only its first match, exactly as the provider wrote it', () => {
    expect(redactOAuthUrls({ text: 'a=1 a=2', pattern: /a=\d/, replacement: 'a=*' })).toBe('a=* a=2');
});

test('text without a match is returned unchanged', () => {
    expect(redactOAuthUrls({ text: 'nothing to see', pattern: /https?:\/\/\S+/g, replacement: '[redacted]' })).toBe('nothing to see');
});

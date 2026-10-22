import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAdminTheme } from '../apply.js';
import { defaultAdminTheme } from '../../core/theme/default.js';
import type { AdminTheme } from '../../core/theme/types.js';

afterEach(() => vi.restoreAllMocks());

describe('applyAdminTheme characterization', () => {
  it('rejects invalid data before changing host styles, attributes or fonts', () => {
    const hostDocument = document.implementation.createHTMLDocument();
    const target = hostDocument.createElement('div');
    target.style.setProperty('--jini-theme-light-primary', 'pink');
    target.setAttribute('data-admin-theme', 'host');
    const before = target.outerHTML;
    const headBefore = hostDocument.head.innerHTML;
    const theme = { ...defaultAdminTheme, density: 0, fonts: {
      ...defaultAdminTheme.fonts, load: ['https://example.com/rejected.css'],
    } };

    expect(() => applyAdminTheme({ theme }, { target, document: hostDocument }))
      .toThrow(new TypeError('density must be between 0.5 and 2'));
    expect(target.outerHTML).toBe(before);
    expect(hostDocument.head.innerHTML).toBe(headBefore);
  });

  it('installs every palette key in both schemes and preserves explicit font and spacing values', () => {
    const hostDocument = document.implementation.createHTMLDocument();
    const target = hostDocument.createElement('div');
    const theme: AdminTheme = { ...defaultAdminTheme, name: 'custom', fonts: {
      body: 'Example Body', heading: 'Example Heading', mono: 'Example Mono', load: [],
    }, radius: '0', density: 0.5 };
    const release = applyAdminTheme({ theme }, { target, document: hostDocument });

    for (const [key, suffix] of [
      ['primary', 'primary'], ['primaryInk', 'primary-ink'], ['bg', 'bg'],
      ['surface', 'surface'], ['text', 'text'], ['muted', 'muted'],
      ['border', 'border'], ['danger', 'danger'], ['success', 'success'], ['warning', 'warning'],
    ] as const) {
      expect(target.style.getPropertyValue(`--jini-theme-light-${suffix}`)).toBe(theme.light[key]);
      expect(target.style.getPropertyValue(`--jini-theme-dark-${suffix}`)).toBe(theme.dark[key]);
    }
    expect(target.style.getPropertyValue('--jini-font-body')).toBe('Example Body');
    expect(target.style.getPropertyValue('--jini-font-heading')).toBe('Example Heading');
    expect(target.style.getPropertyValue('--jini-font-mono')).toBe('Example Mono');
    expect(target.style.getPropertyValue('--jini-radius')).toBe('0');
    expect(target.style.getPropertyValue('--jini-density')).toBe('0.5');
    expect(target.getAttribute('data-admin-theme')).toBe('custom');
    expect(hostDocument.head.querySelectorAll('link')).toHaveLength(0);
    release();
  });

  it('uses neutral defaults when mono, radius, density and font loads are omitted', () => {
    const hostDocument = document.implementation.createHTMLDocument();
    const target = hostDocument.createElement('div');
    const theme: AdminTheme = { name: 'minimal', light: defaultAdminTheme.light,
      dark: defaultAdminTheme.dark, fonts: { body: 'Example Body', heading: 'Example Heading' } };
    const release = applyAdminTheme({ theme }, { target, document: hostDocument });

    expect(target.style.getPropertyValue('--jini-font-mono')).toBe('ui-monospace, monospace');
    expect(target.style.getPropertyValue('--jini-radius')).toBe('8px');
    expect(target.style.getPropertyValue('--jini-density')).toBe('1');
    expect(hostDocument.head.querySelectorAll('link')).toHaveLength(0);
    release();
  });

  it.each([null, '', 'host'])('restores the previous theme name %j and makes cleanup idempotent', (previousName) => {
    const hostDocument = document.implementation.createHTMLDocument();
    const target = hostDocument.createElement('div');
    target.style.setProperty('--jini-theme-light-primary', 'pink');
    target.style.setProperty('--host-only', 'keep');
    if (previousName !== null) target.setAttribute('data-admin-theme', previousName);
    const release = applyAdminTheme({ theme: defaultAdminTheme }, { target, document: hostDocument });

    release();
    expect(target.style.getPropertyValue('--jini-theme-light-primary')).toBe('pink');
    expect(target.style.getPropertyValue('--jini-theme-dark-bg')).toBe('');
    expect(target.style.getPropertyValue('--jini-font-body')).toBe('');
    expect(target.style.getPropertyValue('--host-only')).toBe('keep');
    expect(target.getAttribute('data-admin-theme')).toBe(previousName);
    target.style.setProperty('--jini-theme-light-primary', 'blue');
    target.setAttribute('data-admin-theme', 'later');
    release();
    expect(target.style.getPropertyValue('--jini-theme-light-primary')).toBe('blue');
    expect(target.getAttribute('data-admin-theme')).toBe('later');
  });

  it('deduplicates font URLs, shares leases and removes only the last owned lease', () => {
    const hostDocument = document.implementation.createHTMLDocument();
    const first = hostDocument.createElement('div');
    const second = hostDocument.createElement('div');
    const href = 'https://example.com/shared.css';
    const theme = { ...defaultAdminTheme, fonts: { ...defaultAdminTheme.fonts, load: [href, href] } };
    const releaseFirst = applyAdminTheme({ theme }, { target: first, document: hostDocument });
    const releaseSecond = applyAdminTheme({ theme }, { target: second, document: hostDocument });

    expect(hostDocument.head.querySelectorAll('link[data-jini-theme-font]')).toHaveLength(1);
    expect(hostDocument.head.querySelector('link')?.getAttribute('href')).toBe(href);
    releaseFirst();
    releaseFirst();
    expect(hostDocument.head.querySelectorAll('link')).toHaveLength(1);
    releaseSecond();
    expect(hostDocument.head.querySelectorAll('link')).toHaveLength(0);
    const releaseAgain = applyAdminTheme({ theme }, { target: first, document: hostDocument });
    expect(hostDocument.head.querySelectorAll('link')).toHaveLength(1);
    releaseAgain();
    expect(hostDocument.head.querySelectorAll('link')).toHaveLength(0);
  });

  it('reuses host font links without marking or removing them', () => {
    const hostDocument = document.implementation.createHTMLDocument();
    const target = hostDocument.createElement('div');
    const link = hostDocument.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://example.com/host.css';
    hostDocument.head.appendChild(link);
    const theme = { ...defaultAdminTheme, fonts: { ...defaultAdminTheme.fonts, load: [link.href] } };
    const release = applyAdminTheme({ theme }, { target, document: hostDocument });

    expect(hostDocument.head.querySelectorAll('link')).toHaveLength(1);
    expect(link.hasAttribute('data-jini-theme-font')).toBe(false);
    release();
    expect(hostDocument.head.querySelector('link')).toBe(link);
  });

  it('rolls back styles, name and acquired fonts and rethrows when a later font fails', () => {
    const hostDocument = document.implementation.createHTMLDocument();
    const target = hostDocument.createElement('div');
    target.style.setProperty('--jini-theme-light-primary', 'pink');
    target.setAttribute('data-admin-theme', 'host');
    const theme = { ...defaultAdminTheme, fonts: { ...defaultAdminTheme.fonts,
      load: ['https://example.com/first.css', 'https://example.com/second.css'],
    } };
    const failure = new Error('font append failed');
    const append = hostDocument.head.appendChild.bind(hostDocument.head);
    vi.spyOn(hostDocument.head, 'appendChild').mockImplementationOnce(append)
      .mockImplementationOnce(() => { throw failure; });

    expect(() => applyAdminTheme({ theme }, { target, document: hostDocument })).toThrow(failure);
    expect(target.style.getPropertyValue('--jini-theme-light-primary')).toBe('pink');
    expect(target.style.getPropertyValue('--jini-theme-dark-bg')).toBe('');
    expect(target.getAttribute('data-admin-theme')).toBe('host');
    expect(hostDocument.head.querySelectorAll('link')).toHaveLength(0);
    const release = applyAdminTheme({ theme }, { target, document: hostDocument });
    expect(hostDocument.head.querySelectorAll('link')).toHaveLength(2);
    release();
    expect(hostDocument.head.querySelectorAll('link')).toHaveLength(0);
  });

  it('restores earlier writes when a target style write throws', () => {
    const hostDocument = document.implementation.createHTMLDocument();
    const target = hostDocument.createElement('div');
    target.style.setProperty('--jini-theme-light-primary', 'pink');
    const failure = new Error('style write failed');
    const setProperty = target.style.setProperty.bind(target.style);
    vi.spyOn(target.style, 'setProperty').mockImplementationOnce(setProperty)
      .mockImplementationOnce(() => { throw failure; });

    expect(() => applyAdminTheme({ theme: defaultAdminTheme }, { target, document: hostDocument })).toThrow(failure);
    expect(target.style.getPropertyValue('--jini-theme-light-primary')).toBe('pink');
    expect(target.style.getPropertyValue('--jini-theme-light-primary-ink')).toBe('');
    expect(target.getAttribute('data-admin-theme')).toBeNull();
    expect(hostDocument.head.querySelectorAll('link')).toHaveLength(0);
  });
});

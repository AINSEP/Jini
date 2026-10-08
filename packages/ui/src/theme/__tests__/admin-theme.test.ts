import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAdminTheme, defaultAdminTheme, resolveColorScheme, validateAdminTheme } from '../index.js';

afterEach(() => { document.head.querySelectorAll('[data-jini-theme-font]').forEach((link) => link.remove()); });

describe('admin theme data', () => {
  it('accepts complete palettes and rejects incomplete, unsafe or unknown values', () => {
    expect(validateAdminTheme({ theme: defaultAdminTheme }).valid).toBe(true);
    for (const theme of [null, {}, { ...defaultAdminTheme, light: {} },
      { ...defaultAdminTheme, fonts: { body: 'x; color:red', heading: 'system-ui' } },
      { ...defaultAdminTheme, fonts: { ...defaultAdminTheme.fonts, load: ['javascript:alert(1)'] } },
      { ...defaultAdminTheme, light: { ...defaultAdminTheme.light, primary: 'url(https://example.com)' } },
      { ...defaultAdminTheme, light: { ...defaultAdminTheme.light, primary: 'rgb(invalid)' } },
      { ...defaultAdminTheme, density: 0 }, { ...defaultAdminTheme, radius: '-1px' },
      { ...defaultAdminTheme, light: { ...defaultAdminTheme.light, productColor: 'red' } }]) {
      expect(validateAdminTheme({ theme }).valid).toBe(false);
    }
  });

  it('validates before changing the target or loading fonts', () => {
    const target = document.createElement('div');
    expect(() => applyAdminTheme({ theme: { ...defaultAdminTheme, light: {} } as never }, { target, document })).toThrow(TypeError);
    expect(target.attributes.length).toBe(0);
    expect(document.head.querySelector('[data-jini-theme-font]')).toBeNull();
  });

  it('writes both palettes, fonts, radius and density, and restores host values', () => {
    const target = document.createElement('div');
    target.style.setProperty('--jini-theme-light-primary', 'pink');
    target.setAttribute('data-admin-theme', 'host');
    const cleanup = applyAdminTheme({ theme: { ...defaultAdminTheme, radius: '12px', density: 1.2 } }, { target, document });
    expect(target.style.getPropertyValue('--jini-theme-light-primary')).toBe(defaultAdminTheme.light.primary);
    expect(target.style.getPropertyValue('--jini-theme-dark-bg')).toBe(defaultAdminTheme.dark.bg);
    expect(target.style.getPropertyValue('--jini-font-body')).toBe(defaultAdminTheme.fonts.body);
    expect(target.style.getPropertyValue('--jini-radius')).toBe('12px');
    expect(target.style.getPropertyValue('--jini-density')).toBe('1.2');
    cleanup();
    expect(target.style.getPropertyValue('--jini-theme-light-primary')).toBe('pink');
    expect(target.hasAttribute('style') && target.style.getPropertyValue('--jini-theme-dark-bg')).toBe('');
    expect(target.getAttribute('data-admin-theme')).toBe('host');
  });

  it('restores the host value and important priority through the injected style target', () => {
    // jsdom's cssstyle 4.6.0 drops priority for custom properties even when
    // seeding the fixture. Keep the exact priority contract on a stateful
    // style fake; the test above still exercises real DOM value restoration.
    const declarations = new Map<string, { value: string; priority: string }>();
    const style = {
      getPropertyValue: (key: string) => declarations.get(key)?.value ?? '',
      getPropertyPriority: (key: string) => declarations.get(key)?.priority ?? '',
      setProperty: (key: string, value: string, priority = '') => {
        if (value === '') declarations.delete(key);
        else declarations.set(key, { value, priority });
      },
      removeProperty: (key: string) => {
        const value = declarations.get(key)?.value ?? '';
        declarations.delete(key);
        return value;
      },
    } as CSSStyleDeclaration;
    const element = document.createElement('div');
    const target = {
      style,
      getAttribute: element.getAttribute.bind(element),
      setAttribute: element.setAttribute.bind(element),
      removeAttribute: element.removeAttribute.bind(element),
    };
    style.setProperty('--jini-theme-light-primary', 'pink', 'important');
    expect(style.getPropertyPriority('--jini-theme-light-primary')).toBe('important');
    const cleanup = applyAdminTheme({ theme: defaultAdminTheme }, { target, document });
    expect(style.getPropertyValue('--jini-theme-light-primary')).toBe(defaultAdminTheme.light.primary);
    expect(style.getPropertyPriority('--jini-theme-light-primary')).toBe('');
    cleanup();
    expect(style.getPropertyValue('--jini-theme-light-primary')).toBe('pink');
    expect(style.getPropertyPriority('--jini-theme-light-primary')).toBe('important');
    expect(style.getPropertyValue('--jini-theme-dark-bg')).toBe('');
  });

  it('shares font stylesheets and releases only links it owns', () => {
    const theme = { ...defaultAdminTheme, fonts: { ...defaultAdminTheme.fonts, load: ['https://example.com/fonts.css'] } };
    const a = applyAdminTheme({ theme }, { target: document.createElement('div'), document });
    const b = applyAdminTheme({ theme }, { target: document.createElement('div'), document });
    expect(document.head.querySelectorAll('[data-jini-theme-font]')).toHaveLength(1);
    a(); a();
    expect(document.head.querySelectorAll('[data-jini-theme-font]')).toHaveLength(1);
    b();
    expect(document.head.querySelectorAll('[data-jini-theme-font]')).toHaveLength(0);
    const hostLink = document.createElement('link'); hostLink.rel = 'stylesheet'; hostLink.href = theme.fonts.load[0]!;
    document.head.append(hostLink);
    const release = applyAdminTheme({ theme }, { target: document.createElement('div'), document });
    release();
    expect(hostLink.isConnected).toBe(true); hostLink.remove();
  });

  it('uses only the injected media query for system and leaves explicit preferences alone', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    expect(resolveColorScheme({ preference: 'light' }, { matchMedia })).toBe('light');
    expect(resolveColorScheme({ preference: 'dark' }, { matchMedia })).toBe('dark');
    expect(matchMedia).not.toHaveBeenCalled();
    expect(resolveColorScheme({ preference: 'system' }, { matchMedia })).toBe('dark');
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    expect(() => resolveColorScheme({ preference: 'system' })).toThrow(TypeError);
  });
});

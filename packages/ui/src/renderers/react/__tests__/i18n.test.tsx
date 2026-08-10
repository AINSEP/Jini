import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider, useT } from '../i18n.js';

function Greeting() {
  const t = useT();
  return <p>{t('Hello, {name}!', { name: 'Ada' })}</p>;
}

describe('I18nProvider / useT', () => {
  it('passes the key straight through with no provider mounted', () => {
    render(<Greeting />);
    expect(screen.getByText('Hello, Ada!')).toBeInTheDocument();
  });

  it('passes the key straight through with an empty provider', () => {
    render(
      <I18nProvider>
        <Greeting />
      </I18nProvider>,
    );
    expect(screen.getByText('Hello, Ada!')).toBeInTheDocument();
  });

  it('renders the translated string from a mounted dictionary', () => {
    render(
      <I18nProvider dictionary={{ 'Hello, {name}!': 'Bonjour, {name} !' }}>
        <Greeting />
      </I18nProvider>,
    );
    expect(screen.getByText('Bonjour, Ada !')).toBeInTheDocument();
  });

  it('falls back to the key for a translation missing from the dictionary', () => {
    render(
      <I18nProvider dictionary={{ 'Some other key': 'x' }}>
        <Greeting />
      </I18nProvider>,
    );
    expect(screen.getByText('Hello, Ada!')).toBeInTheDocument();
  });

  it('leaves a placeholder literally in place when the vars map does not supply that name', () => {
    function Incomplete() {
      const t = useT();
      return <p>{t('Hi {name}, you have {count} new messages', { name: 'Ada' })}</p>;
    }
    render(<Incomplete />);
    expect(screen.getByText('Hi Ada, you have {count} new messages')).toBeInTheDocument();
  });
});

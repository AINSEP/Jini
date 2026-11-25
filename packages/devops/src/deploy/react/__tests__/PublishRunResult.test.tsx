import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublishRunResult, type PublishRunResultProps } from '../index.js';

const presentation = {
  classes: { success: "save-ok", error: "save-error" },
  publishedLabel: 'Live:',
  linkLabel: 'Open published fixture',
  linkHandle: 'fixture-published-site',
};

describe('PublishRunResult', () => {
  it('prefers a structured failure on an errored run over its fallback error', () => {
    const run: PublishRunResultProps['run'] = {
      status: 'errored',
      result: { ok: false, message: 'Structured failure' },
      error: 'Route fallback',
    };
    expect(renderToStaticMarkup(<PublishRunResult run={run} {...presentation} />))
      .toBe('<p class="save-error" role="alert">Structured failure</p>');
  });

  it.each(['completed', 'errored'] as const)('renders a successful result at %s with supplied link presentation', status => {
    const run: PublishRunResultProps['run'] = {
      status,
      result: { ok: true, url: 'https://published.example/site?version=3#home' },
    };
    expect(renderToStaticMarkup(<PublishRunResult run={run} {...presentation} />)).toBe(
      '<p class="save-ok">Live: <a href="https://published.example/site?version=3#home"'
      + ' target="_blank" rel="noreferrer" translate="no" data-agent-element="fixture-published-site"'
      + ' data-agent-role="link" data-agent-label="Open published fixture">'
      + 'https://published.example/site?version=3#home</a></p>',
    );
  });

  it('renders the fallback alert for a terminal failure without a result', () => {
    const run: PublishRunResultProps['run'] = { status: 'errored', error: 'Route fallback' };
    expect(renderToStaticMarkup(<PublishRunResult run={run} {...presentation} />))
      .toBe('<p class="save-error" role="alert">Route fallback</p>');
  });

  it.each(['idle', 'running'] as const)('renders nothing while %s even with a populated result and error', status => {
    const run: PublishRunResultProps['run'] = {
      status,
      result: { ok: true, url: 'https://published.example/' },
      error: 'Stale failure',
    };
    expect(renderToStaticMarkup(<PublishRunResult run={run} {...presentation} />)).toBe('');
  });

  it.each(['completed', 'errored'] as const)('renders nothing at %s without a result or error', status => {
    expect(renderToStaticMarkup(<PublishRunResult run={{ status }} {...presentation} />)).toBe('');
  });
});

it('history, success and a failed run use the bound layout roles', () => {
  for (const host of ['host-a', 'host-b']) {
    const classes = { success: `${host}-success`, error: `${host}-error` };
    expect(renderToStaticMarkup(<PublishRunResult {...presentation} classes={classes} run={{ status: 'completed', result: { ok: true, url: 'https://site.example/' } }} />)).toContain(`<p class="${host}-success">Live:`);
    expect(renderToStaticMarkup(<PublishRunResult {...presentation} classes={classes} run={{ status: 'errored', result: { ok: false, message: 'Refused' } }} />)).toBe(`<p class="${host}-error" role="alert">Refused</p>`);
    expect(renderToStaticMarkup(<PublishRunResult {...presentation} classes={classes} run={{ status: 'errored', error: 'Failed' }} />)).toBe(`<p class="${host}-error" role="alert">Failed</p>`);
  }
});

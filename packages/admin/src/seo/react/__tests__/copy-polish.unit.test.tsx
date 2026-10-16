import { render, screen, waitFor, within } from '../../../__tests__/fetch-query-support.js';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Dialog } from '@jini-ai/ui-kit/react';
import { createMemorySeoApi } from '../../adapters/memory.js';
import type { SeoEntryMeta, SeoSettings } from '../../models.js';
import type { SeoMediaPickerSlotProps } from '../options.js';
import { Seo } from '../pages/SeoPage.js';
import { SeoOptionsContext, SeoPortsContext } from '../hooks/SeoPorts.hooks.js';

const reference = 'b4879dd4-1be6-4a51-b1a9-1446ec2dc144:public';
const settings: SeoSettings = {
  titleTemplate: '%s | Site', defaultDescription: 'Site description',
  defaultOgImage: reference, twitterSite: '@site',
  defaultRobots: { noindex: false, nofollow: false }, sitemapEnabled: true, robotsRules: [],
};
const meta: SeoEntryMeta = {
  title: 'Sample page', description: 'Page description', canonical: 'https://example.com/sample',
  robots: { noindex: false, nofollow: false },
  openGraph: { title: 'Sample page', type: 'article', url: 'https://example.com/sample', image: 'https://images.example/og.jpg' },
  twitter: { title: 'Sample page', card: 'summary', image: 'https://images.example/twitter.jpg' }, jsonLd: [],
};

/** Host selection is injected through the existing slot; the real field owns save/clear state. */
function Picker({ onSelect, onCancel }: SeoMediaPickerSlotProps) {
  return <Dialog open title="Choose an image" onClose={onCancel}>
    <button type="button" onClick={() => onSelect({ id: 'sunset-id', slug: 'sunset', title: 'Sunset', alt: 'Sunset over water', contentType: 'image/jpeg', publicUrl: null })}>Sunset</button>
    <button type="button" onClick={onCancel}>Cancel</button>
  </Dialog>;
}

function renderSeo(tabId: string = 'defaults') {
  const api = createMemorySeoApi({ settings, posts: [{ id: 'page-1', title: 'Sample page', status: 'published' }],
    entries: { 'page-1': { meta, analysis: { entryId: 'page-1', score: 100, issues: [], resolved: meta } } },
    mediaOriginalUrl: ({ id }) => `/media/${id}/original`,
  });
  const result = render(<SeoPortsContext.Provider value={{ seoApi: api }}>
    <SeoOptionsContext.Provider value={{ siteUrl: () => 'https://example.com', slots: { MediaPickerDialog: Picker } }}>
      <Seo tabId={tabId} />
    </SeoOptionsContext.Provider>
  </SeoPortsContext.Provider>);
  return { ...result, api };
}

describe('SEO copy polish through the injected ports', () => {
  it('keeps the lowercase title token and saves a selected library image without exposing its stored reference', async () => {
    const user = userEvent.setup();
    const { api } = renderSeo();
    const title = await screen.findByLabelText('Title template (must contain %s)');
    expect(title).toHaveValue('%s | Site');
    expect(screen.queryByText('Title template (must contain %S)')).not.toBeInTheDocument();
    // No read-only "Selected image" box any more: the row names the file (an opaque id with no
    // media listing falls back to "Image") beside its thumbnail.
    const image = screen.getByRole('group', { name: 'Default preview image' });
    expect(within(image).getByText('Image')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Default preview image' })).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/media/b4879dd4-1be6-4a51-b1a9-1446ec2dc144/original');
    await user.clear(title);
    await user.type(title, '%s — Updated');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await screen.findByText('Saved.');
    expect(await api.getSeoSettings({})).toEqual({ ...settings, titleTemplate: '%s — Updated' });
    expect(screen.queryByText(reference)).not.toBeInTheDocument();
  });

  it('uses plain image labels for entry overrides and preserves picker selection and removal', async () => {
    const user = userEvent.setup();
    const { api } = renderSeo('entries');
    await user.click(await screen.findByRole('combobox', { name: 'Entry' }));
    await user.click(await screen.findByRole('option', { name: 'Sample page' }));
    const image = await screen.findByRole('group', { name: 'Preview image' });
    expect(within(image).getByText('og.jpg')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'X/Twitter image' })).getByText('twitter.jpg')).toBeInTheDocument();
    // X inherits the preview title here, so its box stays empty and the placeholder shows it.
    expect(screen.getByLabelText('X/Twitter title')).toHaveValue('');
    expect(screen.getByLabelText('X/Twitter title')).toHaveAttribute('placeholder', 'Sample page');
    expect(screen.queryByText('OG image (media ref or URL)')).not.toBeInTheDocument();
    const field = within(image);
    await user.click(field.getByRole('button', { name: 'Choose image' }));
    await user.click(screen.getByRole('button', { name: 'Sunset' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field.getByText('sunset')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(async () => expect((await api.getSeoEntry({ entryId: 'page-1' })).openGraph.image).toBe('sunset:public'));
    await user.click(field.getByRole('button', { name: 'Remove' }));
    expect(field.queryByText('sunset')).not.toBeInTheDocument();
    expect(field.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(async () => expect((await api.getSeoEntry({ entryId: 'page-1' })).openGraph.image).toBe('https://images.example/og.jpg'));
  });

  it('shows an image only inherited from the site default as muted "Using site default" until one is chosen', async () => {
    const user = userEvent.setup();
    const inherited: SeoEntryMeta = { ...meta, openGraph: { ...meta.openGraph, imageRef: reference } };
    const api = createMemorySeoApi({ settings, posts: [{ id: 'page-2', title: 'Landing', status: 'published' }],
      entries: { 'page-2': { meta: inherited, analysis: { entryId: 'page-2', score: 100, issues: [], resolved: inherited } } },
      mediaOriginalUrl: ({ id }) => `/media/${id}/original`,
    });
    render(<SeoPortsContext.Provider value={{ seoApi: api }}>
      <SeoOptionsContext.Provider value={{ siteUrl: () => 'https://example.com', slots: { MediaPickerDialog: Picker } }}>
        <Seo tabId="entries" />
      </SeoOptionsContext.Provider>
    </SeoPortsContext.Provider>);
    await user.click(await screen.findByRole('combobox', { name: 'Entry' }));
    await user.click(await screen.findByRole('option', { name: 'Landing' }));
    const field = within(await screen.findByRole('group', { name: 'Preview image' }));
    expect(await field.findByText('Using site default: Image')).toBeInTheDocument();
    expect(field.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    await user.click(field.getByRole('button', { name: 'Choose image' }));
    await user.click(screen.getByRole('button', { name: 'Sunset' }));
    expect(field.getByText('sunset')).toBeInTheDocument();
    expect(field.queryByText(/Using site default/)).not.toBeInTheDocument();
    expect(field.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('explains the sitemap rebuild in terms of published content', async () => {
    renderSeo('sitemap');
    expect(await screen.findByText('Rebuild the sitemap now to include the latest published content.')).toBeInTheDocument();
    expect(screen.queryByText('Force-rebuild the cached sitemap now, bypassing the normal cache-hit path.')).not.toBeInTheDocument();
  });
});

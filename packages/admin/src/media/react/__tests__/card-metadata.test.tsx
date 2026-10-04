import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryMediaApi } from '../../adapters/memory.js';
import { MediaCard } from '../components/MediaCard.js';
import { formatUploadDate } from '../../rules.js';
afterEach(cleanup);
it('shows the size and upload date together on a media card', async () => {
  const api = createMemoryMediaApi({});
  const asset = await api.upload({ filename: 'photo.png', contentType: 'image/png', dataBase64: 'aGVsbG8=' });
  render(<MediaCard api={api} item={{ ...asset, byteSize: 1258291, createdAt: '2026-10-04T23:30:00Z' }} />);
  expect(screen.getByText('1.2 MB')).toBeVisible();
  expect(screen.getByText('Oct 4, 2026')).toBeVisible();
  expect(screen.getByText('Oct 4, 2026').closest('p')).toHaveTextContent('1.2 MB · Oct 4, 2026');
  expect(screen.getByText('Oct 4, 2026')).toHaveAttribute('datetime', '2026-10-04T23:30:00Z');
});
it('formats dates by locale and omits invalid legacy dates', () => {
  expect(formatUploadDate({ createdAt: '2026-10-04T00:00:00Z' }, { locale: 'de-DE' })).toBe('4. Okt. 2026');
  expect(formatUploadDate({ createdAt: '' })).toBeNull();
  expect(formatUploadDate({ createdAt: 'invalid' })).toBeNull();
});

import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MediaLoadMore } from '../MediaLoadMore.js';

it('loads the next page, prevents a second click while loading, and offers retry after a read failure', () => {
  const onLoadMore = vi.fn();
  const props = { hasMore: true, loading: false, error: null, onLoadMore, t: (key: string) => key };
  const view = render(<MediaLoadMore {...props} />);
  fireEvent.click(view.getByRole('button', { name: 'Load more' }));
  // The button hands its click event straight through; the count is the contract.
  expect(onLoadMore).toHaveBeenCalledTimes(1);

  view.rerender(<MediaLoadMore {...props} loading />);
  const busy = view.getByRole('button', { name: 'Load more' });
  expect(busy).toBeDisabled();
  fireEvent.click(busy);
  expect(onLoadMore).toHaveBeenCalledTimes(1);

  view.rerender(<MediaLoadMore {...props} error="The next page could not load." />);
  expect(view.getByRole('alert')).toHaveTextContent('The next page could not load.');
  fireEvent.click(view.getByRole('button', { name: 'Try again' }));
  expect(onLoadMore).toHaveBeenCalledTimes(2);

  view.rerender(<MediaLoadMore {...props} hasMore={false} />);
  expect(view.queryByRole('button')).toBeNull();
  expect(view.queryByRole('alert')).toBeNull();
});

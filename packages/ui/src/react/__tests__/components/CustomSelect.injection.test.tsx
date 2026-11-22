import { fireEvent, render, screen, within } from '../../../__tests__/ui-kit-render-support.js';
import { expect, it, vi } from 'vitest';
import { CustomSelect, CustomSelectOptionButton, useCustomSelect } from '../../components/CustomSelect.js';

it('uses the injected overlay and origin theme, with an explicit container taking precedence', () => {
  const overlay = document.createElement('div'), explicit = document.createElement('div');
  document.body.append(overlay, explicit);
  const useCustomSelectHook: typeof useCustomSelect = (required) => ({
    ...useCustomSelect(required), open: true, position: { top: 20, left: 10, width: 150, maxHeight: 200 },
  });
  const props = { value: 'a', options: [{ value: 'a', label: 'Alpha' }], onChange: vi.fn(), ariaLabel: 'Pick',
    useCustomSelect: useCustomSelectHook, useOverlayContainerHook: () => overlay,
    useAgentHandleHook: () => 'injected-select', useCustomSelectOriginThemeHook: () => ({ 'data-theme': 'injected-theme' }),
  };
  try {
    const view = render(<CustomSelect {...props} />);
    expect(screen.getByRole('combobox')).toHaveAttribute('data-agent-element', 'injected-select');
    expect(within(overlay).getByRole('listbox')).toHaveAttribute('data-theme', 'injected-theme');
    view.rerender(<CustomSelect {...props} portalContainer={explicit} />);
    expect(within(explicit).getByRole('listbox')).toHaveAttribute('data-theme', 'injected-theme');
    expect(within(overlay).queryByRole('listbox')).toBeNull();
    view.unmount();
  } finally { overlay.remove(); explicit.remove(); }
});

it('uses the option handle override and preserves choose and hover values', () => {
  const onChoose = vi.fn(), onActive = vi.fn();
  render(<CustomSelectOptionButton option={{ value: 'a', label: 'Alpha' }} selected active={false} id="option-a"
    onChoose={onChoose} onActive={onActive} useAgentHandleHook={() => 'injected-option'} />);
  const option = screen.getByRole('option', { name: 'Alpha' });
  expect(option).toHaveAttribute('data-agent-element', 'injected-option');
  fireEvent.mouseEnter(option); fireEvent.click(option);
  expect(onActive).toHaveBeenCalledWith('a');
  expect(onChoose).toHaveBeenCalledWith('a');
});

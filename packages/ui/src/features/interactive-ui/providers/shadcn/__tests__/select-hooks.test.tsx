import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../../../__tests__/ui-kit-render-support.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select.js';
import { CheckboxField } from '../checkbox-field.js';
import { SelectField } from '../select-field.js';

describe('SelectContent overlay-container hook', () => {
  it('portals the open menu into the container returned by the injected hook', () => {
    const container = document.body.appendChild(document.createElement('div'));
    container.id = 'injected-overlay';
    render(
      <Select open>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent useOverlayContainerHook={() => container}>
          <SelectItem value="a">Option A</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('portals the open menu straight under document.body when the host has no overlay container', () => {
    const { container } = render(
      <Select open>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent useOverlayContainerHook={() => null}>
          <SelectItem value="a">Option A</SelectItem>
        </SelectContent>
      </Select>,
    );
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    // Portalled out of the rendering host into the page body, not left inline.
    expect(container.contains(listbox)).toBe(false);
    expect(document.body.contains(listbox)).toBe(true);
  });
});

describe('agent-handle hook injection', () => {
  it('addresses the checkbox with the handle from the injected hook', () => {
    const useAgentHandleHook = vi.fn(() => 'fake-checkbox-handle');
    render(<CheckboxField label="Accept" checked={false} onCheckedChange={vi.fn()} useAgentHandleHook={useAgentHandleHook} />);
    expect(useAgentHandleHook).toHaveBeenCalled();
    expect(screen.getByRole('checkbox').outerHTML).toContain('fake-checkbox-handle');
  });

  it('addresses the select with the handle from the injected hook', () => {
    const useAgentHandleHook = vi.fn(() => 'fake-select-handle');
    render(<SelectField options={[{ value: 'a', label: 'Option A' }]} placeholder="Pick" useAgentHandleHook={useAgentHandleHook} />);
    expect(useAgentHandleHook).toHaveBeenCalled();
    expect(screen.getByRole('combobox').outerHTML).toContain('fake-select-handle');
  });
});

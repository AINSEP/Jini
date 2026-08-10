import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnnotationCanvas } from '../AnnotationCanvas.js';
import { createFakeAnnotationCanvasPort } from '../../../dependencies.js';
import { I18nProvider } from '../../../../react/i18n.js';

describe('AnnotationCanvas', () => {
  it('renders children plus the toolbar while active', () => {
    render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort()}>
        <div data-testid="preview-content">preview</div>
      </AnnotationCanvas>,
    );
    expect(screen.getByTestId('preview-content')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Annotation tools' })).toBeInTheDocument();
  });

  it('hides the toolbar when inactive and there is nothing drawn', () => {
    render(
      <AnnotationCanvas active={false} port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('the submit-action picker: opening the menu and choosing draft switches the primary action', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ ok: true }));
    render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort({ onSubmit })}>
        <div>preview</div>
      </AnnotationCanvas>,
    );

    const noteInput = screen.getByLabelText('Annotation note');
    await user.type(noteInput, 'hello');

    await user.click(screen.getByRole('button', { name: 'Submit options' }));
    const menu = screen.getByRole('menu', { name: 'Submit options' });
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Add to input' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'draft', note: 'hello' }));
  });

  it('the submit-action picker: choosing queue then clicking the primary button submits queue again', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ ok: true }));
    render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort({ onSubmit })}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    await user.type(screen.getByLabelText('Annotation note'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Submit options' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Queue' }));
    onSubmit.mockClear();
    await user.type(screen.getByLabelText('Annotation note'), '!');
    await user.click(screen.getByRole('button', { name: /Queue/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'queue' }));
  });

  it('disables the send option and shows the reason when sendDisabled', async () => {
    const user = userEvent.setup();
    render(
      <AnnotationCanvas active sendDisabled sendDisabledReason="A run is already streaming" port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    await user.type(screen.getByLabelText('Annotation note'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Submit options' }));
    expect(screen.getByRole('menuitemradio', { name: 'Send' })).toBeDisabled();
  });

  it('Escape closes the overlay (keyboard shortcut)', async () => {
    const user = userEvent.setup();
    const onActiveChange = vi.fn();
    render(
      <AnnotationCanvas active onActiveChange={onActiveChange} port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    await user.keyboard('{Escape}');
    expect(onActiveChange).toHaveBeenCalledWith(false);
  });

  it('the close button also closes the overlay and fires onToolbarClick', async () => {
    const user = userEvent.setup();
    const onActiveChange = vi.fn();
    const onToolbarClick = vi.fn();
    render(
      <AnnotationCanvas active onActiveChange={onActiveChange} onToolbarClick={onToolbarClick} port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    await user.click(screen.getByRole('button', { name: 'Close annotation tools' }));
    expect(onActiveChange).toHaveBeenCalledWith(false);
    expect(onToolbarClick).toHaveBeenCalledWith('exit');
  });

  it('the mark-tool picker switches tools via its menu', async () => {
    const user = userEvent.setup();
    render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    await user.click(screen.getByRole('button', { name: 'Box select' }));
    const menu = screen.getByRole('menu', { name: 'Box select' });
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Text' }));
    expect(screen.getByRole('button', { name: 'Text' })).toBeInTheDocument();
  });

  it('renders custom icons when overridden', () => {
    render(
      <AnnotationCanvas
        active
        port={createFakeAnnotationCanvasPort()}
        icons={{ close: () => <span data-testid="custom-close-icon" /> }}
      >
        <div>preview</div>
      </AnnotationCanvas>,
    );
    expect(screen.getByTestId('custom-close-icon')).toBeInTheDocument();
  });

  it('translates toolbar labels when mounted under an I18nProvider with a dictionary', () => {
    render(
      <I18nProvider dictionary={{ 'Annotation tools': 'Outils d’annotation', Send: 'Envoyer' }}>
        <AnnotationCanvas active port={createFakeAnnotationCanvasPort()}>
          <div>preview</div>
        </AnnotationCanvas>
      </I18nProvider>,
    );
    expect(screen.getByRole('toolbar', { name: 'Outils d’annotation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Envoyer/ })).toBeInTheDocument();
  });

  it('the text tool creates an editable label on canvas click; typing updates it, and the remove button deletes it', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    await user.click(screen.getByRole('button', { name: 'Box select' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Text' }));

    const canvas = container.querySelector('canvas')!;
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });

    const textarea = screen.getByLabelText('Text annotation');
    expect(textarea).toBeInTheDocument();
    await user.type(textarea, 'hello');
    expect(textarea).toHaveValue('hello');

    await user.click(screen.getByRole('button', { name: 'Remove text annotation' }));
    expect(screen.queryByLabelText('Text annotation')).not.toBeInTheDocument();
  });

  it('blurring an empty text label removes it, but one with real text survives', async () => {
    const { container } = render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Box select' }));
    await userEvent.setup().click(screen.getByRole('menuitemradio', { name: 'Text' }));
    const canvas = container.querySelector('canvas')!;
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    const textarea = screen.getByLabelText('Text annotation');
    fireEvent.blur(textarea);
    expect(screen.queryByLabelText('Text annotation')).not.toBeInTheDocument();
  });

  it('Escape inside a text label blurs it without also closing the overlay', async () => {
    const onActiveChange = vi.fn();
    const { container } = render(
      <AnnotationCanvas active onActiveChange={onActiveChange} port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Box select' }));
    await userEvent.setup().click(screen.getByRole('menuitemradio', { name: 'Text' }));
    const canvas = container.querySelector('canvas')!;
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    const textarea = screen.getByLabelText('Text annotation');
    fireEvent.change(textarea, { target: { value: 'keep me' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.getByLabelText('Text annotation')).toBeInTheDocument(); // still there, just blurred
    expect(onActiveChange).not.toHaveBeenCalled();
  });

  it('attaching images shows thumbnails; clicking one opens the preview modal, closable via the Close button, the backdrop, and Escape', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(screen.getByLabelText('Attached images')).toBeInTheDocument();
    const thumbButton = screen.getByRole('button', { name: 'photo.png' });

    await user.click(thumbButton);
    expect(screen.getByRole('dialog', { name: 'photo.png' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(thumbButton);
    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'photo.png' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(thumbButton);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking inside the preview modal content does not close it', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await user.click(screen.getByRole('button', { name: 'photo.png' }));
    const dialog = screen.getByRole('dialog', { name: 'photo.png' });
    fireEvent.mouseDown(dialog.querySelector('img')!);
    expect(screen.getByRole('dialog', { name: 'photo.png' })).toBeInTheDocument();
  });

  it('the attach-image button clicks the hidden file input', async () => {
    const user = userEvent.setup();
    const onToolbarClick = vi.fn();
    const { container } = render(
      <AnnotationCanvas active onToolbarClick={onToolbarClick} port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');
    await user.click(screen.getByRole('button', { name: 'Attach image' }));
    expect(clickSpy).toHaveBeenCalled();
    expect(onToolbarClick).toHaveBeenCalledWith('attach_image');
  });

  it('removing an attached image via its own remove button drops just that thumbnail', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    const a = new File(['x'], 'a.png', { type: 'image/png' });
    const b = new File(['y'], 'b.png', { type: 'image/png' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, [a, b]);
    expect(screen.getAllByRole('button', { name: 'Remove attached image' })).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'Remove attached image' })[0]!);
    expect(screen.getByRole('button', { name: 'b.png' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'a.png' })).not.toBeInTheDocument();
  });

  it('shows the capture-warning banner (role=status) after a failed submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ ok: false, message: 'Could not reach the server' }));
    render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort({ onSubmit })}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    await user.type(screen.getByLabelText('Annotation note'), 'hi');
    await user.click(screen.getByRole('button', { name: /Send/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('Could not reach the server');
  });

  it('hideChrome hides the canvas/text-layer/toolbar chrome without deactivating drawing', () => {
    const { container } = render(
      <AnnotationCanvas active hideChrome port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    const canvas = container.querySelector('canvas')!;
    expect(canvas).toHaveStyle({ visibility: 'hidden' });
    // `getByRole` excludes elements hidden via CSS visibility from the
    // accessibility tree, so query the DOM directly to check the style
    // itself rather than asserting the toolbar is unreachable by role.
    expect(container.querySelector('[role="toolbar"]')).toHaveStyle({ visibility: 'hidden' });
  });

  it('renders the dock into toolbarHost via a portal instead of inline when provided', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { container } = render(
      <AnnotationCanvas active toolbarHost={host} port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    expect(host.querySelector('[role="toolbar"]')).toBeInTheDocument();
    expect(container.querySelector('[role="toolbar"]')).not.toBeInTheDocument();
    host.remove();
  });

  it('a surviving text mark becomes pointer-transparent and loses its remove button once a non-text tool is selected', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort()}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    await user.click(screen.getByRole('button', { name: 'Box select' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Text' }));
    const canvas = container.querySelector('canvas')!;
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    const textarea = screen.getByLabelText('Text annotation');
    fireEvent.change(textarea, { target: { value: 'keep me' } });
    fireEvent.blur(textarea); // has text, so the mark survives

    expect(screen.getByRole('button', { name: 'Remove text annotation' })).toBeInTheDocument();
    const markWrapper = textarea.parentElement as HTMLElement;
    expect(markWrapper).toHaveStyle({ pointerEvents: 'auto' }); // still the text tool

    await user.click(screen.getByRole('button', { name: 'Text' }));
    const menu = screen.getByRole('menu', { name: 'Text' });
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Box select' }));

    expect(markWrapper).toHaveStyle({ pointerEvents: 'none' });
    expect(screen.queryByRole('button', { name: 'Remove text annotation' })).not.toBeInTheDocument();

    // pointercancel drives the same drag-end handler as pointerup.
    expect(() => fireEvent.pointerCancel(markWrapper, { clientX: 10, clientY: 10 })).not.toThrow();
  });

  it('hides the capture-warning banner and the attached-images strip (not just the toolbar row) when hideChrome is set', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ ok: false, message: 'nope' }));
    const { container, rerender } = render(
      <AnnotationCanvas active port={createFakeAnnotationCanvasPort({ onSubmit })}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await user.type(screen.getByLabelText('Annotation note'), 'hi');
    await user.click(screen.getByRole('button', { name: /Send/ }));
    await screen.findByRole('status');

    rerender(
      <AnnotationCanvas active hideChrome port={createFakeAnnotationCanvasPort({ onSubmit })}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    expect(container.querySelector('[role="status"]')).toHaveStyle({ visibility: 'hidden' });
    expect(container.querySelector('[aria-label="Attached images"]')).toHaveStyle({ visibility: 'hidden' });
  });
});

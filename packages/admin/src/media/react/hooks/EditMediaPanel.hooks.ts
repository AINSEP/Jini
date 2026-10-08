import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useController } from '../../../core/react/use-controller.js';
import { createEditMediaController } from '../../controllers/edit-media.controller.js';
import type { MediaApiPort } from '../../ports.js';
import type { MediaAsset, MediaMetadataPatch, UploadInput } from '../../models.js';
import { canReplaceMedia, mediaEmbedSnippet, parseOptionalPixelSize, safeMediaUrl } from '../../rules.js';
import { parseMediaHtmlAttributes, describeMediaHtmlAttributeError } from '../../html-attributes.js';
export interface EditMediaPanelProps {
  readonly api: MediaApiPort;
  readonly item: MediaAsset;
  readonly onSaved: (required?: { message?: string }) => void | Promise<void>;
  readonly onClose: () => void;
}
export function useEditMediaPanel(props: EditMediaPanelProps, _optional: Record<string, never> = {}) {
  const { controller, snapshot } = useController({
    create: () => createEditMediaController({ api: props.api, item: props.item }),
    dependencies: [props.api, props.item.id],
  });
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); };
  }, []);
  const saving = !snapshot || snapshot.saving;
  const titleRef = useRef<HTMLInputElement>(null);
  const ready = !!snapshot;
  useLayoutEffect(() => {
    // The controller attaches after the first render. Title is initially disabled;
    // focus it once the draft is ready, rather than letting a later copy button win.
    if (!ready) return;
    titleRef.current?.focus({ preventScroll: true });
    const dialog = titleRef.current?.closest('dialog');
    if (dialog) dialog.scrollTop = 0;
  }, [ready]);
  // Live hint ONLY: invalid attributes must never gate saving unrelated dirty metadata.
  // The server revalidates atomically and reports errors through the usual save banner.
  const parsed = parseMediaHtmlAttributes({ text: snapshot?.draft.htmlAttributes ?? '' });
  const hint = parsed.error ? describeMediaHtmlAttributeError({ error: parsed.error }) : null;
  const fields = [
    { key: 'title', label: 'Title', handle: 'title' },
    { key: 'alt', label: 'Alt', handle: 'alt' },
    { key: 'slug', label: 'Slug', handle: 'slug' },
    { key: 'caption', label: 'Caption', handle: 'caption' },
    { key: 'credit', label: 'Credit', handle: 'credit' },
    { key: 'width', label: 'Width (px)', handle: 'width' },
    { key: 'height', label: 'Height (px)', handle: 'height' },
    { key: 'cssClass', label: 'CSS class (optional)', handle: 'css-class' },
    { key: 'htmlAttributes', label: 'HTML attributes (optional)', handle: 'html-attributes' },
  ].map(({ key, label, handle }) => ({
    fieldId: key, label, ...(key === 'title' ? { ref: titleRef } : {}), type: key === 'width' || key === 'height' ? 'number' as const : 'text' as const,
    ...(key === 'width' || key === 'height' ? { placeholder: 'native' } : {}),
    value: String(snapshot?.draft[key as keyof MediaMetadataPatch] ?? ''),
    attrs: { 'data-jini-part': `media.editor.${key}`, 'data-agent-element': `media-edit-${handle}`,
      ...(key === 'title' ? { 'data-jini-autofocus': true } : {}),
      ...(key === 'htmlAttributes' ? { 'aria-invalid': !!hint } : {}) },
    onValueChange: ({ value }: { value: string }, _optional: Record<string, never> = {}) => {
      const next = key === 'width' || key === 'height' ? parseOptionalPixelSize({ value })
        : key === 'cssClass' || key === 'htmlAttributes' ? value.trim() === '' ? null : value : value;
      controller?.setDraft({ patch: { [key]: next } });
    },
  }));
  // Server-computed public URL, never the authenticated original route. Trashed assets
  // and hosts without a public transform expose no link or copy action at all.
  const publicUrl = props.item.status === 'active' && props.item.publicUrl
    ? safeMediaUrl({ url: props.item.publicUrl }) : undefined;
  const embed = mediaEmbedSnippet({ slug: props.item.slug });
  // Visible text is the legacy "Copy"/"Copied" on every row; the accessible name keeps
  // the value's noun so three identical buttons stay distinguishable, even mid-feedback.
  const copies = [
    { id: 'url', label: 'File URL', value: publicUrl, noun: 'URL' },
    { id: 'embed', label: 'Embed code', value: embed, noun: 'embed code' },
    { id: 'hash', label: 'sha256', value: props.item.sha256, noun: 'hash' },
  ].filter((row): row is { id: string; label: string; value: string; noun: string } => !!row.value)
    .map(row => ({ ...row, isLink: row.id === 'url', buttonLabel: copied[row.id] ? 'Copied' : 'Copy',
      attrs: { 'data-agent-element': `media-edit-copy-${row.id}`,
        'aria-label': `${copied[row.id] ? 'Copied' : 'Copy'} ${row.noun}` },
      async copy() {
        try {
          await navigator.clipboard.writeText(row.value);
          if (!mounted.current) return;
          setCopied(current => ({ ...current, [row.id]: true }));
          clearTimeout(timers.current.get(row.id));
          timers.current.set(row.id, setTimeout(() => {
            timers.current.delete(row.id);
            setCopied(current => ({ ...current, [row.id]: false }));
          }, 1500));
        } catch {
          // Clipboard may be denied/insecure. The full value stays selectable for manual copy.
        }
      },
    }));
  const fieldRows = [[0, 1], [2], [3, 4], [5, 6], [7], [8]].map((indexes, index) => ({ id: index, className: indexes.length > 1 ? 'jini-field-row' : 'jini-field-group-row', fields: indexes.map(i => fields[i]!) }));
  return { ...props, snapshot, fields, fieldRows, copies, hint, saving, title: `Editing "${props.item.title}"`,
    canReplace: canReplaceMedia({ api: props.api }),
    async onSave() { if (await controller?.save()) await props.onSaved(); },
    async replace({ input }: { input: UploadInput }, _optional: Record<string, never> = {}) {
      const result = (await controller?.replace({ upload: input })) ?? false;
      if (result) await props.onSaved({ message: `Replaced ${props.item.title}` });
      return result;
    },
    close() { if (!saving) props.onClose(); },
  };
}

/**
 * Headless controller for the annotation-canvas engine: freehand/box/text
 * drawing, undo/redo, canvas rAF/DPR redraw, the collision-avoiding floating
 * toolbar placement, and the send/draft/queue submit-action picker — plus
 * every keyboard shortcut the origin component had (Escape to close the
 * overlay / dismiss whichever menu or text edit is open; Cmd/Ctrl+Z undo;
 * Shift+Cmd/Ctrl+Z redo; Enter in the note input submits as Queue).
 *
 * Origin: `apps/web/src/components/PreviewDrawOverlay.tsx`. See
 * `../../source-map.md` for the exact file-by-file port breakdown and what
 * was intentionally left product-side (the `window` `CustomEvent` wire
 * protocol, the compositor-iframe snapshot lookup, the composer's
 * submission semantics).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  ChangeEvent as ReactChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import {
  clamp01,
  computeDockPlacement,
  deriveMarkKind,
  mergeBounds,
  mergeRects,
  normalizedRectFromPoints,
  buildSubmitOptionRules,
  dockPlacementEquals,
} from '../../rules.js';
import { redrawStrokesAndBoxes, textFontSizePx, compositeMarksOntoCanvas } from '../../drawing.js';
import type { AnnotationCanvasPort } from '../../ports.js';
import type {
  AnnotationAction,
  CaptureTarget,
  DockPlacement,
  DrawToolbarElement,
  MarkTool,
  NormalizedRect,
  Point,
  PreviewSnapshot,
  Rect,
  Stroke,
  TextMark,
} from '../../types.js';
import { useT } from '../../../react/i18n.js';
import {
  attemptCapture,
  buildMarkToolOptionControllers,
  buildSubmitOptionControllers,
  buildSubmitPayload,
  canAttemptSend,
  deriveCanvasVisibility,
  deriveSendGate,
  deriveSentWarning,
  deriveUndoRedoAvailability,
  describeSubmitFailure,
} from './useAnnotationCanvas.controller.js';

const DEFAULT_DOCKED_STYLE = {
  left: 'calc(50% - 52px)',
  bottom: '16px',
  transform: 'translateX(-50%)',
  maxWidth: 'min(760px, calc(100% - 144px))',
} as const;

export interface UseAnnotationCanvasOptions {
  /** Whether the overlay is currently in drawing mode (canvas pointer-events on, toolbar visible). */
  active: boolean;
  onActiveChange?: ((active: boolean) => void) | undefined;
  /** Submit even with no ink/box/text mark at all — used for a whole-viewport screenshot annotation. */
  captureViewport?: boolean | undefined;
  captureTarget?: CaptureTarget | null | undefined;
  filePath?: string | undefined;
  /** Disables the `send` action (e.g. a run is already streaming) — `draft`/`queue` stay usable. */
  sendDisabled?: boolean | undefined;
  sendDisabledReason?: string | undefined;
  /** Hides the canvas/toolbar chrome without deactivating drawing — used by a host to hide marks during its own screenshot capture (mirrors the internal `capturing` state, which does the same thing automatically around `port.captureSnapshot`). */
  hideChrome?: boolean | undefined;
  onToolbarClick?: ((element: DrawToolbarElement, submitAction?: AnnotationAction) => void) | undefined;
  port: AnnotationCanvasPort;
}

export interface SubmitOptionController {
  action: AnnotationAction;
  label: string;
  pendingLabel: string;
  title: string;
  enabled: boolean;
}

export interface MarkToolOptionController {
  tool: MarkTool;
  label: string;
}

export interface TextMarkController extends TextMark {
  editing: boolean;
}

const SUBMIT_TIMEOUT_MS = 60_000;

export interface AnnotationCanvasController {
  wrapRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  dockRef: RefObject<HTMLDivElement | null>;
  markToolMenuRef: RefObject<HTMLDivElement | null>;
  submitMenuRef: RefObject<HTMLDivElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;

  showCanvas: boolean;
  textLayerVisible: boolean;
  chromeHidden: boolean;
  textFontPx: number;
  dockPlacement: DockPlacement;

  markTool: MarkTool;
  markToolMenuOpen: boolean;
  markToolOptions: MarkToolOptionController[];
  currentMarkTool: MarkToolOptionController;
  setMarkToolMenuOpen: (open: boolean) => void;
  selectMarkTool: (tool: MarkTool) => void;

  textMarks: TextMarkController[];
  updateTextMark: (id: number, text: string) => void;
  removeTextMark: (id: number) => void;
  handleTextBlur: (id: number) => void;
  handleTextEscape: (id: number, el: HTMLTextAreaElement) => void;
  autosizeTextArea: (el: HTMLTextAreaElement | null) => void;
  registerTextArea: (id: number, el: HTMLTextAreaElement | null) => void;
  onTextPointerDown: (e: ReactPointerEvent, mark: TextMark) => void;
  onTextPointerMove: (e: ReactPointerEvent, mark: TextMark) => void;
  onTextPointerUp: (e: ReactPointerEvent, mark: TextMark) => void;

  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;

  undoStroke: () => void;
  redoStroke: () => void;
  canUndo: boolean;
  canRedo: boolean;

  note: string;
  setNote: (note: string) => void;
  onNotePaste: (e: ReactClipboardEvent<HTMLInputElement>) => void;
  onNoteKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;

  extraFiles: File[];
  imagePreviews: { file: File; url: string }[];
  previewIndex: number | null;
  setPreviewIndex: (index: number | null) => void;
  addExtraFiles: (files: FileList | File[] | null) => void;
  onFileInputChange: (e: ReactChangeEvent<HTMLInputElement>) => void;
  removeExtraFile: (index: number) => void;

  submitAction: AnnotationAction;
  submitMenuOpen: boolean;
  setSubmitMenuOpen: (open: boolean) => void;
  submitOptions: SubmitOptionController[];
  currentSubmit: SubmitOptionController;
  chooseSubmitAction: (action: AnnotationAction) => void;
  send: (action: AnnotationAction) => Promise<void>;
  sending: boolean;
  canSubmit: boolean;

  captureWarning: { action: AnnotationAction; message: string } | null;
  closeOverlay: () => void;
}

export function useAnnotationCanvas(options: UseAnnotationCanvasOptions): AnnotationCanvasController {
  const { active, onActiveChange, captureViewport = false, captureTarget = null, filePath, sendDisabled = false, hideChrome = false, onToolbarClick, port } = options;
  const t = useT();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const markToolMenuRef = useRef<HTMLDivElement>(null);
  const submitMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [note, setNote] = useState('');
  const [markTool, setMarkTool] = useState<MarkTool>('box');
  const [markToolMenuOpen, setMarkToolMenuOpen] = useState(false);
  const strokesRef = useRef<Stroke[]>([]);
  const undoneStrokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);
  const selectionBoxesRef = useRef<NormalizedRect[]>([]);
  const boxDraftRef = useRef<{ start: Point; current: Point } | null>(null);
  const composingRef = useRef(false);

  const [textMarks, setTextMarksState] = useState<TextMark[]>([]);
  const textMarksRef = useRef<TextMark[]>([]);
  const textIdRef = useRef(0);
  const [editingTextId, setEditingTextId] = useState<number | null>(null);
  const textAreaRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());

  const [frameSize, setFrameSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hasInk, setHasInk] = useState(false);
  const [hasBox, setHasBox] = useState(false);
  const [hasText, setHasText] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [pendingAction, setPendingAction] = useState<AnnotationAction | null>(null);
  const [submitAction, setSubmitAction] = useState<AnnotationAction>('send');
  const [submitMenuOpen, setSubmitMenuOpen] = useState(false);
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<{ file: File; url: string }[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [captureWarning, setCaptureWarning] = useState<{ action: AnnotationAction; message: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [dockPlacement, setDockPlacement] = useState<DockPlacement>({ layout: 'docked', side: null, style: DEFAULT_DOCKED_STYLE });

  const sending = pendingAction !== null;

  const bumpLayoutRevision = useCallback(() => setLayoutRevision((v) => v + 1), []);

  const redraw = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    if (typeof window === 'undefined' || typeof window.CanvasRenderingContext2D === 'undefined') return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const draft = boxDraftRef.current ? normalizedRectFromPoints(boxDraftRef.current.start, boxDraftRef.current.current) : null;
    redrawStrokesAndBoxes(
      ctx,
      {
        strokes: strokesRef.current,
        drawingStroke: drawingRef.current,
        selectionBoxes: draft ? [...selectionBoxesRef.current, draft] : selectionBoxesRef.current,
        boxDraft: null,
      },
      cvs.width,
      cvs.height,
      window.devicePixelRatio || 1,
    );
  }, []);

  const redrawFrameRef = useRef<number | null>(null);
  const scheduleRedraw = useCallback(() => {
    if (redrawFrameRef.current !== null) return;
    redrawFrameRef.current = requestAnimationFrame(() => {
      redrawFrameRef.current = null;
      redraw();
    });
  }, [redraw]);
  useEffect(
    () => () => {
      if (redrawFrameRef.current !== null) cancelAnimationFrame(redrawFrameRef.current);
    },
    [],
  );

  // Size the canvas from the wrapper's layout box + redraw on resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    const cvs = canvasRef.current;
    if (!wrap || !cvs) return undefined;
    const resize = () => {
      const width = wrap.offsetWidth;
      const height = wrap.offsetHeight;
      const dpr = window.devicePixelRatio || 1;
      cvs.width = Math.max(1, Math.floor(width * dpr));
      cvs.height = Math.max(1, Math.floor(height * dpr));
      cvs.style.width = `${width}px`;
      cvs.style.height = `${height}px`;
      setFrameSize((cur) => (cur.w === width && cur.h === height ? cur : { w: width, h: height }));
      redraw();
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw, active, hasInk, hasBox, hasText]);

  function syncHistoryState() {
    setHasInk(strokesRef.current.length > 0);
    setHasBox(selectionBoxesRef.current.length > 0);
    setHasText(textMarksRef.current.some((mark) => mark.text.trim().length > 0));
    setUndoCount(strokesRef.current.length);
    setRedoCount(undoneStrokesRef.current.length);
  }

  function commitTextMarks(next: TextMark[]) {
    textMarksRef.current = next;
    setTextMarksState(next);
    setHasText(next.some((mark) => mark.text.trim().length > 0));
  }

  const closeOverlay = useCallback(() => {
    onActiveChange?.(false);
  }, [onActiveChange]);

  // Keyboard shortcut #1: Escape closes the overlay; Cmd/Ctrl+Z undoes;
  // Shift+Cmd/Ctrl+Z redoes. Bound only while active.
  useEffect(() => {
    if (!active) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onActiveChange?.(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoStroke();
        else undoStroke();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onActiveChange, sending]);

  // Keyboard shortcut #2: Escape closes the staged-image preview modal first (capture phase).
  useEffect(() => {
    if (previewIndex === null) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPreviewIndex(null);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [previewIndex]);

  // Keyboard shortcut #3: Escape (and outside-click) dismisses the submit-action menu.
  useEffect(() => {
    if (!submitMenuOpen) return undefined;
    function onPointerDownOutside(e: MouseEvent) {
      if (submitMenuRef.current && !submitMenuRef.current.contains(e.target as Node)) setSubmitMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSubmitMenuOpen(false);
      }
    }
    window.addEventListener('mousedown', onPointerDownOutside, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDownOutside, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [submitMenuOpen]);

  // Keyboard shortcut #4: Escape (and outside-click) dismisses the mark-tool menu.
  useEffect(() => {
    if (!markToolMenuOpen) return undefined;
    function onPointerDownOutside(e: MouseEvent) {
      if (markToolMenuRef.current && !markToolMenuRef.current.contains(e.target as Node)) setMarkToolMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMarkToolMenuOpen(false);
      }
    }
    window.addEventListener('mousedown', onPointerDownOutside, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDownOutside, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [markToolMenuOpen]);

  function pointFromEvent(e: { clientX: number; clientY: number }): Point {
    const cvs = canvasRef.current;
    if (!cvs) return { x: 0, y: 0 };
    const rect = cvs.getBoundingClientRect();
    const x = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    const y = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (!active) return;
    e.preventDefault();
    if (sending) return;
    if (markTool === 'text') {
      const point = pointFromEvent(e);
      const id = (textIdRef.current += 1);
      commitTextMarks([...textMarksRef.current, { id, x: point.x, y: point.y, text: '' }]);
      setEditingTextId(id);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const point = pointFromEvent(e);
    if (markTool === 'box') {
      boxDraftRef.current = { start: point, current: point };
      syncHistoryState();
      redraw();
      return;
    }
    drawingRef.current = { points: [point] };
    redraw();
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!active) return;
    e.preventDefault();
    if (sending) return;
    if (boxDraftRef.current) {
      boxDraftRef.current.current = pointFromEvent(e);
      scheduleRedraw();
      return;
    }
    if (!drawingRef.current) return;
    drawingRef.current.points.push(pointFromEvent(e));
    scheduleRedraw();
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (!active) return;
    e.preventDefault();
    if (sending) return;
    if (redrawFrameRef.current !== null) {
      cancelAnimationFrame(redrawFrameRef.current);
      redrawFrameRef.current = null;
    }
    if (boxDraftRef.current) {
      boxDraftRef.current.current = pointFromEvent(e);
      const next = normalizedRectFromPoints(boxDraftRef.current.start, boxDraftRef.current.current);
      boxDraftRef.current = null;
      if (next.width >= 0.006 && next.height >= 0.006) {
        selectionBoxesRef.current = [...selectionBoxesRef.current, next];
        bumpLayoutRevision();
      }
      syncHistoryState();
      redraw();
      return;
    }
    if (!drawingRef.current) return;
    if (drawingRef.current.points.length > 1) {
      strokesRef.current.push(drawingRef.current);
      undoneStrokesRef.current = [];
      bumpLayoutRevision();
      syncHistoryState();
    }
    drawingRef.current = null;
    redraw();
  }

  function undoStroke() {
    if (sending) return;
    if (boxDraftRef.current) {
      boxDraftRef.current = null;
      syncHistoryState();
      redraw();
      bumpLayoutRevision();
      onToolbarClick?.('undo');
      return;
    }
    if (selectionBoxesRef.current.length > 0) {
      selectionBoxesRef.current = selectionBoxesRef.current.slice(0, -1);
      syncHistoryState();
      redraw();
      bumpLayoutRevision();
      onToolbarClick?.('undo');
      return;
    }
    const stroke = strokesRef.current.pop();
    if (!stroke) return;
    onToolbarClick?.('undo');
    undoneStrokesRef.current.push(stroke);
    drawingRef.current = null;
    syncHistoryState();
    redraw();
    bumpLayoutRevision();
  }

  function redoStroke() {
    if (sending) return;
    const stroke = undoneStrokesRef.current.pop();
    if (!stroke) return;
    onToolbarClick?.('redo');
    strokesRef.current.push(stroke);
    drawingRef.current = null;
    syncHistoryState();
    redraw();
    bumpLayoutRevision();
  }

  function resetTextEditingState() {
    textAreaRefs.current.clear();
    setEditingTextId(null);
  }

  function clearInk() {
    strokesRef.current = [];
    undoneStrokesRef.current = [];
    drawingRef.current = null;
    selectionBoxesRef.current = [];
    boxDraftRef.current = null;
    resetTextEditingState();
    commitTextMarks([]);
    syncHistoryState();
    redraw();
    bumpLayoutRevision();
  }

  // Reset all drawing state whenever the overlay is deactivated.
  useEffect(() => {
    if (active) return;
    strokesRef.current = [];
    undoneStrokesRef.current = [];
    drawingRef.current = null;
    selectionBoxesRef.current = [];
    boxDraftRef.current = null;
    resetTextEditingState();
    commitTextMarks([]);
    setExtraFiles([]);
    setPreviewIndex(null);
    syncHistoryState();
    redraw();
    bumpLayoutRevision();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, redraw]);

  const autosizeTextArea = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.width = '0px';
    el.style.height = '0px';
    el.style.width = `${el.scrollWidth + 2}px`;
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  /** Registers (or, when `el` is null, unregisters) the mounted `<textarea>` backing a text mark, so the autofocus-on-create effect, the autosize-on-frame-change effect, and `textBounds()`'s export-accurate measurement can find it. The presentational layer calls this from the textarea's `ref` callback. */
  const registerTextArea = useCallback((id: number, el: HTMLTextAreaElement | null) => {
    if (el) textAreaRefs.current.set(id, el);
    else textAreaRefs.current.delete(id);
  }, []);

  function updateTextMark(id: number, text: string) {
    commitTextMarks(textMarksRef.current.map((mark) => (mark.id === id ? { ...mark, text } : mark)));
  }

  function removeTextMark(id: number) {
    textAreaRefs.current.delete(id);
    commitTextMarks(textMarksRef.current.filter((mark) => mark.id !== id));
  }

  function handleTextBlur(id: number) {
    setEditingTextId((cur) => (cur === id ? null : cur));
    const mark = textMarksRef.current.find((item) => item.id === id);
    if (mark && mark.text.trim() === '') removeTextMark(id);
  }

  // Keyboard shortcut #5: Escape inside a text-label editor blurs it (stopping propagation so the overlay itself doesn't also close).
  function handleTextEscape(_id: number, el: HTMLTextAreaElement) {
    el.blur();
  }

  useEffect(() => {
    if (editingTextId === null) return;
    const el = textAreaRefs.current.get(editingTextId);
    if (el) {
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, [editingTextId, textMarks]);

  const textDragRef = useRef<{ id: number; pointerId: number; startX: number; startY: number; originX: number; originY: number; curX: number; curY: number; moved: boolean } | null>(null);
  const lastTextTapRef = useRef<{ id: number; time: number } | null>(null);

  function onTextPointerDown(e: ReactPointerEvent, mark: TextMark) {
    if (editingTextId === mark.id) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    textDragRef.current = {
      id: mark.id,
      pointerId: e.pointerId,
      startX: (e.clientX - rect.left) / rect.width,
      startY: (e.clientY - rect.top) / rect.height,
      originX: mark.x,
      originY: mark.y,
      curX: mark.x,
      curY: mark.y,
      moved: false,
    };
  }

  function onTextPointerMove(e: ReactPointerEvent, mark: TextMark) {
    const drag = textDragRef.current;
    if (!drag || drag.id !== mark.id) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const nx = clamp01(drag.originX + ((e.clientX - rect.left) / rect.width - drag.startX));
    const ny = clamp01(drag.originY + ((e.clientY - rect.top) / rect.height - drag.startY));
    drag.curX = nx;
    drag.curY = ny;
    if (Math.abs(nx - drag.originX) > 0.002 || Math.abs(ny - drag.originY) > 0.002) drag.moved = true;
    const el = e.currentTarget as HTMLElement;
    el.style.left = `${nx * 100}%`;
    el.style.top = `${ny * 100}%`;
  }

  function onTextPointerUp(e: ReactPointerEvent, mark: TextMark) {
    const drag = textDragRef.current;
    if (!drag || drag.id !== mark.id) return;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    textDragRef.current = null;
    if (drag.moved) {
      commitTextMarks(textMarksRef.current.map((item) => (item.id === mark.id ? { ...item, x: drag.curX, y: drag.curY } : item)));
      lastTextTapRef.current = null;
      return;
    }
    const prev = lastTextTapRef.current;
    if (prev && prev.id === mark.id && e.timeStamp - prev.time < 320) {
      lastTextTapRef.current = null;
      setEditingTextId(mark.id);
    } else {
      lastTextTapRef.current = { id: mark.id, time: e.timeStamp };
    }
  }

  useEffect(() => {
    textAreaRefs.current.forEach((el) => autosizeTextArea(el));
  }, [frameSize, textMarks, autosizeTextArea]);

  function addExtraFiles(files: FileList | File[] | null) {
    if (!files) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imgs.length === 0) return;
    setExtraFiles((cur) => [...cur, ...imgs]);
  }
  function onFileInputChange(e: ReactChangeEvent<HTMLInputElement>) {
    addExtraFiles(e.target.files);
    e.target.value = '';
  }
  function onNotePaste(e: ReactClipboardEvent<HTMLInputElement>) {
    const files = e.clipboardData?.files;
    if (!files || files.length === 0) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imgs.length === 0) return;
    e.preventDefault();
    addExtraFiles(imgs);
  }
  function removeExtraFile(index: number) {
    setExtraFiles((cur) => cur.filter((_, i) => i !== index));
    setPreviewIndex(null);
  }

  useEffect(() => {
    const next = extraFiles.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setImagePreviews(next);
    return () => {
      next.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [extraFiles]);

  function selectMarkTool(nextTool: MarkTool) {
    onToolbarClick?.(nextTool === 'box' ? 'rect' : nextTool === 'text' ? 'text' : 'pen');
    setMarkTool(nextTool);
    setMarkToolMenuOpen(false);
  }

  function onCompositionStart() {
    composingRef.current = true;
  }
  function onCompositionEnd() {
    composingRef.current = false;
  }
  // Keyboard shortcut #6: Enter in the note input submits as Queue (IME-composition-safe — a candidate-confirming Enter must not also submit).
  function onNoteKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (composingRef.current) return;
    if (e.key === 'Enter') void send('queue');
  }

  function normalizedRectToCanvasRect(box: NormalizedRect): Rect | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: box.x * rect.width,
      y: box.y * rect.height,
      width: Math.max(1, box.width * rect.width),
      height: Math.max(1, box.height * rect.height),
    };
  }

  function boxBounds(): Rect | null {
    const boxes = selectionBoxesRef.current.map((box) => normalizedRectToCanvasRect(box)).filter((box): box is Rect => Boolean(box));
    return mergeRects(boxes);
  }

  function lastBoxBounds(): Rect | null {
    const last = selectionBoxesRef.current.at(-1);
    return last ? normalizedRectToCanvasRect(last) : null;
  }

  function strokeRect(stroke: Stroke | null | undefined): Rect | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    const points = stroke?.points ?? [];
    if (!rect || rect.width <= 0 || rect.height <= 0 || points.length === 0) return null;
    const xs = points.map((point) => point.x * rect.width);
    const ys = points.map((point) => point.y * rect.height);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const pad = 8;
    return { x: Math.max(0, minX - pad), y: Math.max(0, minY - pad), width: Math.max(1, maxX - minX + pad * 2), height: Math.max(1, maxY - minY + pad * 2) };
  }

  function textBounds(): Rect | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const rects: Rect[] = [];
    for (const mark of textMarksRef.current) {
      if (mark.text.trim().length === 0) continue;
      const el = textAreaRefs.current.get(mark.id);
      if (el) {
        const box = el.getBoundingClientRect();
        rects.push({ x: box.left - rect.left, y: box.top - rect.top, width: Math.max(1, box.width), height: Math.max(1, box.height) });
      } else {
        const left = mark.x * rect.width;
        const top = mark.y * rect.height;
        rects.push({ x: left, y: top, width: 1, height: 1 });
      }
    }
    return mergeRects(rects);
  }

  function strokeBounds(): Rect | null {
    const points = strokesRef.current.flatMap((stroke) => stroke.points);
    return strokeRect(points.length > 0 ? { points } : null);
  }

  function lastStrokeBounds(): Rect | null {
    return strokeRect(strokesRef.current.at(-1));
  }

  function anchorBounds(): Rect | null {
    return lastBoxBounds() ?? lastStrokeBounds() ?? (captureTarget?.position ?? null);
  }

  function annotationBounds(): Rect | undefined {
    return mergeBounds([boxBounds(), strokeBounds(), textBounds(), captureTarget?.position ?? null]);
  }

  function markKind() {
    return deriveMarkKind({ hasTarget: Boolean(captureTarget), hasVisualMark: hasInk || hasBox || hasText });
  }

  function waitForOverlayHidden(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  async function requestSnapshot(): Promise<PreviewSnapshot | null> {
    if (!port.captureSnapshot) return null;
    setCapturing(true);
    try {
      await waitForOverlayHidden();
      return await port.captureSnapshot();
    } finally {
      setCapturing(false);
    }
  }

  async function compositeWithBackground(snap: PreviewSnapshot): Promise<Blob | null> {
    const frameRect = port.captureFrameRect?.() ?? wrapRef.current?.getBoundingClientRect() ?? null;
    if (!frameRect) return null;
    // No `typeof document !== 'undefined'` SSR guard here (unlike the
    // component's own preview-modal portal check): this function is only
    // ever reached via `send()`, itself only invocable from an event handler
    // on an already-mounted, hydrated component — never during an SSR render
    // pass, where `document` is provably defined. Proved dead and removed
    // during the coverage pass (see `source-map.md`); the guard is only
    // meaningful at JSX-render time (portal / effect bodies), not inside an
    // async handler like this one.
    const out = document.createElement('canvas');
    out.width = snap.w;
    out.height = snap.h;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    const bg = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = snap.dataUrl;
    });
    if (!bg) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(bg, 0, 0, snap.w, snap.h);
    const sx = snap.w / Math.max(1, frameRect.width);
    const sy = snap.h / Math.max(1, frameRect.height);
    compositeMarksOntoCanvas(
      ctx,
      { target: captureTarget, selectionBoxes: selectionBoxesRef.current, strokes: strokesRef.current, textMarks: textMarksRef.current },
      snap.w,
      snap.h,
      sx,
      sy,
    );
    return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
  }

  async function send(action: AnnotationAction) {
    const hasTarget = Boolean(captureTarget);
    const noteTrimmed = note.trim();
    const { shouldCapture, canSubmitNow } = deriveSendGate({
      hasInk,
      hasBox,
      hasText,
      hasCaptureTarget: hasTarget,
      captureViewport,
      noteTrimmed,
      extraFilesCount: extraFiles.length,
    });
    if (!canAttemptSend({ sending, canSubmitNow, action, sendDisabled })) return;
    onToolbarClick?.('annotation_submit', action);
    setCaptureWarning(null);
    setPendingAction(action);
    try {
      let file: File | null = null;
      if (shouldCapture) {
        const capture = await attemptCapture({
          hasInk,
          hasBox,
          hasCaptureTarget: hasTarget,
          captureViewport,
          noteTrimmed,
          extraFilesCount: extraFiles.length,
          requestSnapshot,
          compositeWithBackground,
          t,
        });
        if (capture.kind === 'warned') {
          setCaptureWarning({ action, message: capture.message });
          return;
        }
        if (capture.kind === 'captured') file = capture.file;
      }
      const kind = markKind();
      const payload = buildSubmitPayload({ file, note: noteTrimmed, action, filePath, captureTarget, markKind: kind, bounds: annotationBounds(), extraFiles });
      const result = await Promise.race([
        port.onSubmit(payload),
        new Promise<{ ok: boolean; message?: string }>((resolve) =>
          setTimeout(() => resolve({ ok: false, message: t('Timed out waiting to submit this annotation.') }), SUBMIT_TIMEOUT_MS),
        ),
      ]);
      if (!result.ok) {
        setCaptureWarning({ action, message: describeSubmitFailure(result, t) });
        return;
      }
      clearInk();
      setCaptureWarning(deriveSentWarning({ shouldCapture, file, action }, t));
      setNote('');
      setExtraFiles([]);
      setPreviewIndex(null);
    } finally {
      setPendingAction(null);
    }
  }

  function chooseSubmitAction(action: AnnotationAction) {
    setSubmitAction(action);
    setSubmitMenuOpen(false);
    void send(action);
  }

  // Collision-avoiding floating-toolbar placement: re-measure and recompute
  // whenever the layout could have shifted (drawing a new mark, resizing the
  // dock/host, or a capture-warning banner appearing/disappearing changes the
  // dock's own height).
  useLayoutEffect(() => {
    if (!active) {
      setDockPlacement((current) => (dockPlacementEquals(current, { layout: 'docked', side: null, style: DEFAULT_DOCKED_STYLE }) ? current : { layout: 'docked', side: null, style: DEFAULT_DOCKED_STYLE }));
      return;
    }
    const wrap = wrapRef.current;
    const dock = dockRef.current;
    if (!wrap || !dock) return;
    const hostRect = wrap.getBoundingClientRect();
    const wrapRect = hostRect;
    const dockRect = dock.getBoundingClientRect();
    const anchor = anchorBounds();
    const next = computeDockPlacement({
      dockedStyle: DEFAULT_DOCKED_STYLE,
      hostRect: { x: hostRect.left, y: hostRect.top, width: hostRect.width, height: hostRect.height },
      wrapRect: { x: wrapRect.left, y: wrapRect.top, width: wrapRect.width, height: wrapRect.height },
      dockRect: { x: dockRect.left, y: dockRect.top, width: dockRect.width, height: dockRect.height },
      anchor,
    });
    setDockPlacement((current) => (dockPlacementEquals(current, next) ? current : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, captureTarget, layoutRevision, imagePreviews.length, captureWarning?.message]);

  useLayoutEffect(() => {
    if (!active || typeof ResizeObserver === 'undefined') return undefined;
    const wrap = wrapRef.current;
    const dock = dockRef.current;
    if (!wrap || !dock) return undefined;
    const recompute = () => setLayoutRevision((v) => v + 1);
    const ro = new ResizeObserver(recompute);
    ro.observe(wrap);
    ro.observe(dock);
    return () => ro.disconnect();
  }, [active]);

  const { showCanvas, textLayerVisible, chromeHidden } = deriveCanvasVisibility({ active, hasInk, hasBox, hasText, capturing, hideChrome });
  const { canSubmitNow: canSubmitValue } = deriveSendGate({
    hasInk,
    hasBox,
    hasText,
    hasCaptureTarget: Boolean(captureTarget),
    captureViewport,
    noteTrimmed: note.trim(),
    extraFilesCount: extraFiles.length,
  });
  const { canUndo, canRedo } = deriveUndoRedoAvailability({ undoCount, hasBox, redoCount, sending });

  const submitRules = buildSubmitOptionRules({ canSubmit: canSubmitValue, sendDisabled });
  const { submitOptions, currentSubmit } = buildSubmitOptionControllers({
    submitRules,
    sendDisabled,
    sendDisabledReason: options.sendDisabledReason,
    submitAction,
    t,
  });

  const { markToolOptions, currentMarkTool } = buildMarkToolOptionControllers({ markTool, t });

  const textMarksWithEditing: TextMarkController[] = textMarks.map((mark) => ({ ...mark, editing: editingTextId === mark.id }));

  return {
    wrapRef,
    canvasRef,
    dockRef,
    markToolMenuRef,
    submitMenuRef,
    fileInputRef,
    showCanvas,
    textLayerVisible,
    chromeHidden,
    textFontPx: textFontSizePx(frameSize.h),
    dockPlacement,
    markTool,
    markToolMenuOpen,
    markToolOptions,
    currentMarkTool,
    setMarkToolMenuOpen,
    selectMarkTool,
    textMarks: textMarksWithEditing,
    updateTextMark,
    removeTextMark,
    handleTextBlur,
    handleTextEscape,
    autosizeTextArea,
    registerTextArea,
    onTextPointerDown,
    onTextPointerMove,
    onTextPointerUp,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    undoStroke,
    redoStroke,
    canUndo,
    canRedo,
    note,
    setNote,
    onNotePaste,
    onNoteKeyDown,
    onCompositionStart,
    onCompositionEnd,
    extraFiles,
    imagePreviews,
    previewIndex,
    setPreviewIndex,
    addExtraFiles,
    onFileInputChange,
    removeExtraFile,
    submitAction,
    submitMenuOpen,
    setSubmitMenuOpen,
    submitOptions,
    currentSubmit,
    chooseSubmitAction,
    send,
    sending,
    canSubmit: canSubmitValue,
    captureWarning,
    closeOverlay,
  };
}

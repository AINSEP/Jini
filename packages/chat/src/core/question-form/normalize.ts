/**
 * @module question-form/normalize
 *
 * Normalization of a raw (already-JSON-parsed) question object into this
 * package's stable `FormQuestion`/`DirectionCard` shape — tolerant of the
 * looser vocabulary a model tends to emit (`"multi"` for `checkbox`,
 * `"default"` for `defaultValue`, etc). Split out of the original
 * single-file `question-form.ts`; see `../question-form.ts` for the public
 * facade and `./scan.ts` for the caller that turns raw JSON into these
 * question objects.
 */
import type { DirectionCard, FormOption, FormQuestion, QuestionType } from './types.js';
import { formOptionValueForLabel } from './format.js';

export function mapRawQuestion(q: unknown, index: number): FormQuestion | null {
  if (!q || typeof q !== 'object') return null;
  const qo = q as Record<string, unknown>;
  const id = typeof qo.id === 'string' && qo.id.trim().length > 0 ? qo.id.trim() : `q${index + 1}`;
  const label = typeof qo.label === 'string' ? qo.label : id;
  const type = normalizeType(qo.type);
  const options = parseOptions(qo.options);
  const placeholder = typeof qo.placeholder === 'string' ? qo.placeholder : undefined;
  const help = typeof qo.help === 'string' ? qo.help : undefined;
  const required = qo.required === true;
  const maxSelections =
    typeof qo.maxSelections === 'number' && Number.isInteger(qo.maxSelections) && qo.maxSelections > 0
      ? qo.maxSelections
      : undefined;
  const cards = parseDirectionCards(qo.cards);
  const defaultValue = parseDefaultValue(qo, options);
  const allowCustom =
    qo.allowCustom === false ? false : qo.allowCustom === true || qo.custom === true ? true : undefined;
  const customLabel = typeof qo.customLabel === 'string' ? qo.customLabel : undefined;
  const customPlaceholder = typeof qo.customPlaceholder === 'string' ? qo.customPlaceholder : undefined;
  const min = parseNumberAttr(qo.min);
  const max = parseNumberAttr(qo.max);
  const step = parseNumberAttr(qo.step);
  const multiple = qo.multiple === true;
  const accept = typeof qo.accept === 'string' ? qo.accept : undefined;
  return {
    id,
    label,
    type,
    ...(options ? { options } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(help ? { help } : {}),
    ...(required ? { required } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(maxSelections !== undefined && type === 'checkbox' ? { maxSelections } : {}),
    ...(allowCustom !== undefined ? { allowCustom } : {}),
    ...(customLabel ? { customLabel } : {}),
    ...(customPlaceholder ? { customPlaceholder } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(multiple && type === 'file' ? { multiple } : {}),
    ...(accept && type === 'file' ? { accept } : {}),
    ...(cards ? { cards } : {}),
  };
}

function normalizeType(raw: unknown): QuestionType {
  if (typeof raw !== 'string') return 'text';
  const lower = raw.toLowerCase().trim();
  if (lower === 'radio' || lower === 'single' || lower === 'choice') return 'radio';
  if (lower === 'checkbox' || lower === 'multi' || lower === 'multiple') return 'checkbox';
  if (lower === 'select' || lower === 'dropdown') return 'select';
  if (lower === 'textarea' || lower === 'long' || lower === 'paragraph') return 'textarea';
  if (lower === 'number' || lower === 'numeric') return 'number';
  if (lower === 'range' || lower === 'slider') return 'range';
  if (lower === 'date') return 'date';
  if (lower === 'time') return 'time';
  if (lower === 'datetime-local' || lower === 'datetime' || lower === 'date-time' || lower === 'datetime_local') {
    return 'datetime-local';
  }
  if (lower === 'color' || lower === 'colour' || lower === 'color-picker') return 'color';
  if (lower === 'url' || lower === 'link') return 'url';
  if (lower === 'email') return 'email';
  if (lower === 'tel' || lower === 'phone') return 'tel';
  if (lower === 'file' || lower === 'upload' || lower === 'attachment') return 'file';
  if (lower === 'switch' || lower === 'toggle' || lower === 'boolean') return 'switch';
  if (lower === 'direction-cards' || lower === 'directions' || lower === 'cards' || lower === 'direction') {
    return 'direction-cards';
  }
  return 'text';
}

function parseNumberAttr(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseOptions(raw: unknown): FormOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const options = raw.map(parseOption).filter((option): option is FormOption => option !== null);
  return options.length > 0 ? options : undefined;
}

function parseOption(raw: unknown): FormOption | null {
  if (typeof raw === 'string') {
    const label = raw.trim();
    return label.length > 0 ? { label, value: label } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const label = typeof obj.label === 'string' ? obj.label.trim() : '';
  if (label.length === 0) return null;
  const value = typeof obj.value === 'string' && obj.value.trim().length > 0 ? obj.value.trim() : label;
  const description = typeof obj.description === 'string' && obj.description.trim().length > 0 ? obj.description.trim() : undefined;
  return {
    label,
    value,
    ...(description ? { description } : {}),
  };
}

function parseDefaultValue(
  question: Record<string, unknown>,
  options: FormOption[] | undefined,
): string | string[] | undefined {
  const raw =
    typeof question.defaultValue === 'string' || Array.isArray(question.defaultValue)
      ? question.defaultValue
      : typeof question.defaultValue === 'number' || typeof question.defaultValue === 'boolean'
        ? String(question.defaultValue)
        : typeof question.default === 'string'
          ? question.default
          : typeof question.default === 'number' || typeof question.default === 'boolean'
            ? String(question.default)
            : undefined;
  if (typeof raw === 'string') return formOptionValueForLabel({ options }, raw);
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === 'string').map((value) => formOptionValueForLabel({ options }, value));
  }
  return undefined;
}

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** A bare CSS colour keyword. Letters only — with no parenthesis it cannot become a function call. */
const COLOR_KEYWORD = /^[a-z]+$/i;
/**
 * A colour function. The argument charset deliberately excludes `(`, so no nested function —
 * `var()`, `url()`, `image-set()`, `attr()` — can appear inside one of these either.
 */
const COLOR_FUNCTION = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(\s*[0-9a-z%.,/\s+-]*\)$/i;

/**
 * Whether a model-supplied palette entry may be written into a CSS value.
 *
 * `palette` reaches `QuestionForm`'s swatch as `style={{ background: c }}`, and `background` is a
 * SHORTHAND — it accepts far more than a colour. An agent (or anything that can influence one)
 * emitting `url(https://attacker.example/pixel)` therefore got the browser to issue a request the
 * moment the card rendered: a tracking beacon inside the chat transcript, needing no click. Neither
 * React nor the CSSOM filters this; React passes style values through, and the CSSOM happily
 * accepts a valid shorthand.
 *
 * Enforced HERE rather than at the swatch, because this is the normalization boundary and the
 * component is not the only thing that could ever read `palette`. An entry that fails is DROPPED
 * rather than substituted: a silently recoloured swatch would misrepresent the agent's proposal,
 * and a card with fewer swatches is honest about what survived validation.
 */
export function isRenderableColor(value: string): boolean {
  const candidate = value.trim();
  // Bounded before any regex runs: these come from model output, and the function pattern's `\s*`
  // plus a character class is the shape that makes a pathological input worth not accepting at all.
  if (candidate.length === 0 || candidate.length > 64) return false;
  return HEX_COLOR.test(candidate) || COLOR_KEYWORD.test(candidate) || COLOR_FUNCTION.test(candidate);
}

function parseDirectionCards(raw: unknown): DirectionCard[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: DirectionCard[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === 'string' && e.id.trim().length > 0 ? e.id.trim() : null;
    const label = typeof e.label === 'string' ? e.label : null;
    if (id === null || label === null) continue;
    const mood = typeof e.mood === 'string' ? e.mood : '';
    const references = Array.isArray(e.references) ? e.references.filter((r): r is string => typeof r === 'string').slice(0, 6) : [];
    const palette = Array.isArray(e.palette)
      ? e.palette.filter((p): p is string => typeof p === 'string' && isRenderableColor(p)).slice(0, 8)
      : [];
    const displayFont = typeof e.displayFont === 'string' ? e.displayFont : 'Georgia, serif';
    const bodyFont = typeof e.bodyFont === 'string' ? e.bodyFont : '-apple-system, system-ui, sans-serif';
    out.push({ id, label, mood, references, palette, displayFont, bodyFont });
  }
  return out.length > 0 ? out : undefined;
}

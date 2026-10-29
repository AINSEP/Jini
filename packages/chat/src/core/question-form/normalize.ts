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

/** `raw` viewed as a record of fields, or `null` when it isn't an object at all. */
export function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

/** `raw` when it is a string, else `undefined`. */
export function stringOrUndefined(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}

/** `raw` when it is a non-empty string, else `undefined`. */
export function nonEmptyString(raw: unknown): string | undefined {
  return stringOrUndefined(raw) || undefined;
}

/** `raw` trimmed when it is a string with visible content, else `undefined`. */
function trimmedNonBlank(raw: unknown): string | undefined {
  return nonEmptyString(stringOrUndefined(raw)?.trim());
}

/** The string entries of `raw` when it is an array, else an empty list. */
function stringsOnly(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : [];
}

type OmitUndefined<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/**
 * `obj` without its `undefined`-valued keys, in the original key order — so
 * an optional field is absent rather than present-but-undefined, which
 * `exactOptionalPropertyTypes` (and a consumer's `'key' in obj`) can tell apart.
 */
export function omitUndefined<T extends Record<string, unknown>>(obj: T): OmitUndefined<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as OmitUndefined<T>;
}

export function mapRawQuestion({ q, index }: { q: unknown; index: number }): FormQuestion | null {
  const qo = asRecord(q);
  if (!qo) return null;
  const id = trimmedNonBlank(qo.id) ?? `q${index + 1}`;
  const type = normalizeType(qo.type);
  const options = parseOptions(qo.options);
  const isFile = type === 'file';
  return omitUndefined({
    id,
    name: stringOrUndefined(qo.name),
    label: stringOrUndefined(qo.label) ?? id,
    type,
    options,
    placeholder: nonEmptyString(qo.placeholder),
    help: nonEmptyString(qo.help),
    required: qo.required === true || undefined,
    defaultValue: parseDefaultValue(qo, options),
    maxSelections: type === 'checkbox' ? positiveInteger(qo.maxSelections) : undefined,
    allowCustom: parseAllowCustom(qo),
    customLabel: nonEmptyString(qo.customLabel),
    customPlaceholder: nonEmptyString(qo.customPlaceholder),
    min: parseNumberAttr(qo.min),
    max: parseNumberAttr(qo.max),
    step: parseNumberAttr(qo.step),
    multiple: (isFile && qo.multiple === true) || undefined,
    accept: isFile ? nonEmptyString(qo.accept) : undefined,
    cards: parseDirectionCards(qo.cards),
  });
}

function positiveInteger(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

// An explicit `allowCustom: false` wins over the legacy `custom: true` key.
function parseAllowCustom(question: Record<string, unknown>): boolean | undefined {
  if (question.allowCustom === false) return false;
  return question.allowCustom === true || question.custom === true || undefined;
}

const TYPE_ALIASES: ReadonlyMap<string, QuestionType> = new Map<string, QuestionType>(
  (
    [
      ['radio', ['radio', 'single', 'choice']],
      ['checkbox', ['checkbox', 'multi', 'multiple']],
      ['select', ['select', 'dropdown']],
      ['textarea', ['textarea', 'long', 'paragraph']],
      ['number', ['number', 'numeric']],
      ['range', ['range', 'slider']],
      ['date', ['date']],
      ['time', ['time']],
      ['datetime-local', ['datetime-local', 'datetime', 'date-time', 'datetime_local']],
      ['color', ['color', 'colour', 'color-picker']],
      ['url', ['url', 'link']],
      ['email', ['email']],
      ['tel', ['tel', 'phone']],
      ['file', ['file', 'upload', 'attachment']],
      ['switch', ['switch', 'toggle', 'boolean']],
      ['direction-cards', ['direction-cards', 'directions', 'cards', 'direction']],
    ] satisfies [QuestionType, string[]][]
  ).flatMap(([type, aliases]) => aliases.map((alias): [string, QuestionType] => [alias, type])),
);

function normalizeType(raw: unknown): QuestionType {
  if (typeof raw !== 'string') return 'text';
  return TYPE_ALIASES.get(raw.toLowerCase().trim()) ?? 'text';
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
    const label = trimmedNonBlank(raw);
    return label ? { label, value: label } : null;
  }
  const obj = asRecord(raw) ?? {};
  const label = trimmedNonBlank(obj.label);
  if (!label) return null;
  return omitUndefined({ label, value: trimmedNonBlank(obj.value) ?? label, description: trimmedNonBlank(obj.description) });
}

// Only `defaultValue` may hold a list; the legacy `default` key is read as a scalar only.
function parseDefaultValue(
  question: Record<string, unknown>,
  options: FormOption[] | undefined,
): string | string[] | undefined {
  const resolve = (labelOrValue: string) => formOptionValueForLabel({ question: { options }, labelOrValue });
  if (Array.isArray(question.defaultValue)) return stringsOnly(question.defaultValue).map(resolve);
  const raw = scalarString(question.defaultValue) ?? scalarString(question.default);
  return raw === undefined ? undefined : resolve(raw);
}

function scalarString(raw: unknown): string | undefined {
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return stringOrUndefined(raw);
}

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** A bare CSS colour keyword. Letters only — with no parenthesis it cannot become a function call. */
const COLOR_KEYWORD = /^[a-z]+$/i;
/**
 * A colour function. The argument charset deliberately excludes `(`, so no nested function —
 * `var()`, `url()`, `image-set()`, `attr()` — can appear inside one of these either.
 */
const COLOR_FUNCTION = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9a-z%.,/\s+-]*\)$/i;

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
export function isRenderableColor({ value }: { value: string }): boolean {
  const candidate = value.trim();
  // Bounded before any regex runs: these come from model output, and the function pattern's `\s*`
  // plus a character class is the shape that makes a pathological input worth not accepting at all.
  if (candidate.length === 0 || candidate.length > 64) return false;
  return HEX_COLOR.test(candidate) || COLOR_KEYWORD.test(candidate) || COLOR_FUNCTION.test(candidate);
}

function parseDirectionCards(raw: unknown): DirectionCard[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.flatMap((entry: unknown) => parseDirectionCard(asRecord(entry) ?? {}) ?? []);
  return out.length > 0 ? out : undefined;
}

function parseDirectionCard(e: Record<string, unknown>): DirectionCard | null {
  const id = trimmedNonBlank(e.id);
  const label = stringOrUndefined(e.label);
  if (id === undefined || label === undefined) return null;
  return {
    id,
    label,
    mood: stringOrUndefined(e.mood) ?? '',
    references: stringsOnly(e.references).slice(0, 6),
    palette: stringsOnly(e.palette).filter((value) => isRenderableColor({ value })).slice(0, 8),
    displayFont: stringOrUndefined(e.displayFont) ?? 'Georgia, serif',
    bodyFont: stringOrUndefined(e.bodyFont) ?? '-apple-system, system-ui, sans-serif',
  };
}

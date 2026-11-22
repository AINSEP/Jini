
// ---------------------------------------------------------------------------
// TipTap/ProseMirror `bodyJson` vocabulary — see this file's header for why this schema exists and
// what it does (and does not) validate. Mirrors exactly the node/mark types
// the site renderer's `renderDocNode`/`renderMarks` switch on (including
// `DOC_NODE_HANDLERS`'s full entry list); nothing here describes a node type the renderer would not
// recognize.
// ---------------------------------------------------------------------------

/**
 * A `text` node's formatting mark.
 *
 * 2026-09-11: expanded from 4 mark types to the 10 `renderMarks`/`MARK_RENDERERS` (`render.ts`)
 * actually dispatches on — this schema previously named only `bold`/`italic`/`code`/`link`, the SAME
 * documentation-drift defect this file's `TIPTAP_DOC_SCHEMA` doc comment describes for node types,
 * just on marks instead. Investigated rather than assumed: the admin editor's own extension list
 * (the host admin's post editor hook) was cross-checked against `MARK_RENDERERS`'s keys —
 * every mark the editor can produce (`StarterKit`'s bundled `Bold`/`Code`/`Italic`/`Link`/`Strike`/
 * `Underline`, plus the explicitly-loaded `Subscript`/`Superscript`/`Highlight`/`TextStyle` with
 * `Color`/`BackgroundColor`/`FontFamily`/`FontSize`/`LineHeight`) has a matching `MARK_RENDERERS`
 * entry — there is no "editor produces it, renderer silently drops it" case to report here.
 *
 * `link`/`textStyle`/`highlight` are the only marks carrying `attrs`; the other seven
 * (`bold`/`italic`/`code`/`strike`/`underline`/`subscript`/`superscript`) are boolean-style (present
 * or absent, no attrs). `textStyle` and `highlight` both read an attr named `color` for DIFFERENT
 * purposes (text color vs. highlight background color) — see that field's own description below.
 */
export const TIPTAP_MARK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type"],
  properties: {
    type: {
      type: "string",
      enum: ["bold", "italic", "code", "strike", "underline", "subscript", "superscript", "textStyle", "highlight", "link"],
      description: "The mark type.",
    },
    attrs: {
      type: "object",
      additionalProperties: false,
      properties: {
        href: { type: "string", description: "Required for a 'link' mark. Ignored for every other mark type." },
        color: {
          type: "string",
          description:
            "For a 'textStyle' mark: the text color. For a 'highlight' mark: the highlight's background color (highlight has no " +
            "separate attr for this). Ignored for every other mark type. A CSS color: 3/4/6/8-digit hex ('#f00', '#ff0000'), a bare " +
            "keyword ('red', 'transparent'), or rgb()/rgba()/hsl()/hsla()/oklch(). Omit for a plain 'highlight' with no chosen color.",
        },
        backgroundColor: {
          type: "string",
          description: "Background color for a 'textStyle' mark only (NOT 'highlight' — see 'color' above for that one). Same CSS-color shape as 'color'. Ignored for every other mark type.",
        },
        fontFamily: {
          type: "string",
          description: "Font family for a 'textStyle' mark, e.g. '\"Courier New\", monospace'. Ignored for every other mark type.",
        },
        fontSize: {
          type: "string",
          description: "Font size for a 'textStyle' mark — a CSS length, e.g. '16px' or '1.2rem'. Ignored for every other mark type.",
        },
        lineHeight: {
          type: "string",
          description: "Line height for a 'textStyle' mark — a bare unitless number (e.g. '1.5', the idiomatic CSS form) or a length. Ignored for every other mark type.",
        },
      },
      description:
        "Only 'link' (href), 'textStyle' (color/backgroundColor/fontFamily/fontSize/lineHeight — send only the ones you're " +
        "setting; each is independent), and 'highlight' (color) marks carry attrs. Omit entirely for every other mark type.",
    },
  },
} as const;

/** The only inline (text-bearing) node type this renderer supports — every paragraph/heading/
 * codeBlock's `content` is an array of these. */
export const TIPTAP_TEXT_NODE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "text"],
  properties: {
    type: { const: "text" },
    text: { type: "string", description: "The literal text. Escaped automatically at render time — do not include HTML." },
    marks: { type: "array", items: TIPTAP_MARK_SCHEMA, description: "Zero or more formatting marks applied to this whole text run. Omit for unformatted text." },
  },
} as const;

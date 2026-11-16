/** @file The input-field descriptor shared by the element-handle state and the agentic field guards. */

/** The subset of an input element these guards need. Framework- and DOM-free by design. */
export interface FieldDescriptor {
  /** The `type` attribute, lowercased. */
  readonly type?: string | undefined;
  /** The `autocomplete` attribute, lowercased. */
  readonly autocomplete?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  /**
   * **Every** human-visible naming of the field the driver could resolve — `aria-label`,
   * `placeholder`, and the text of each associated `<label>`.
   *
   * Carried because `name`/`id` are the *machine* names, and a form builder or CMS that emits
   * `name="field_47"` leaves the guard nothing to judge while the page still plainly reads
   * "Card number" to the user. A field whose sensitivity is stated only in its label was
   * invisible to every refusal here until this existed.
   *
   * Plural, and required to be exhaustive, because the singular form this replaced took whichever
   * source resolved *first*: a page could then mask a sensitive field behind a benign one —
   * `<label for=f>Card number</label><input id=f name=field_47 placeholder="Enter value">` reached
   * the guard as the single label "Enter value", and its value was reported back in full.
   */
  readonly accessibleLabels?: readonly string[] | undefined;
  readonly readOnly?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}

const optionSchema = {
  type: 'object', additionalProperties: false, required: ['label'],
  properties: {
    label: { type: 'string', minLength: 1 },
    value: { type: 'string', minLength: 1, description: 'Defaults to label when omitted.' },
    description: { type: 'string' },
  },
} as const;

const selectSchema = {
  type: 'object', additionalProperties: false, required: ['label', 'options'],
  properties: {
    label: { type: 'string', minLength: 1 },
    options: { type: 'array', minItems: 1, items: { ...optionSchema, required: ['value', 'label'] } },
  },
} as const;

/** Model-authored question. Legacy nested selects remain aliases; answers are form-only. */
export const ASK_CHOICE_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  anyOf: [
    { required: ['question', 'options'] },
    { required: ['title', 'singleSelect'] },
    { required: ['title', 'multiSelect'] },
  ],
  properties: {
    question: { type: 'string', minLength: 1, description: 'The question to ask the human.' },
    options: { type: 'array', minItems: 1, items: optionSchema },
    multiple: { type: 'boolean', description: 'Allow several selections. Defaults to false.' },
    title: { type: 'string', minLength: 1, description: 'Legacy alias: title with singleSelect or multiSelect.' },
    description: { type: 'string' }, submitLabel: { type: 'string' },
    singleSelect: { ...selectSchema, description: 'Legacy nested single-choice alias.' },
    multiSelect: {
      ...selectSchema, description: 'Legacy nested multiple-choice alias.',
      properties: { ...selectSchema.properties, hint: { type: 'string' } },
    },
  },
} as const;

/** Execution-only callback fields. The same handler still verifies the principal-bound ticket. */
export const ASK_CHOICE_INVOCATION_SCHEMA = {
  ...ASK_CHOICE_INPUT_SCHEMA,
  anyOf: [...ASK_CHOICE_INPUT_SCHEMA.anyOf, { required: ['choice', '__askChoiceAnswerTicket'] }, { required: ['selections', '__askChoiceAnswerTicket'] }],
  properties: {
    ...ASK_CHOICE_INPUT_SCHEMA.properties,
    choice: { type: 'string' },
    selections: { type: 'array', items: { type: 'string' } },
    __askChoiceAnswerTicket: { type: 'string' },
  },
} as const;

const optionSchema = {
  type: 'object', additionalProperties: false, required: ['value', 'label'],
  properties: { value: { type: 'string' }, label: { type: 'string' } },
} as const;

const selectSchema = {
  type: 'object', additionalProperties: false, required: ['label', 'options'],
  properties: {
    label: { type: 'string' },
    options: { type: 'array', minItems: 1, items: optionSchema },
  },
} as const;

/** Model input schema. Callback correlation params are carried by the rendered form only. */
export const ASK_CHOICE_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title'],
  anyOf: [{ required: ['singleSelect'] }, { required: ['multiSelect'] }],
  properties: {
    title: { type: 'string' }, description: { type: 'string' }, submitLabel: { type: 'string' },
    singleSelect: selectSchema,
    multiSelect: {
      ...selectSchema,
      properties: { ...selectSchema.properties, hint: { type: 'string' } },
    },
    choice: { type: 'string', description: 'Set by the rendered form; never by the model.' },
    selections: { type: 'array', items: { type: 'string' }, description: 'Set by the rendered form; never by the model.' },
  },
} as const;

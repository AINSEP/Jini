/**
 * Error gate, rule 2: no generic failure words in a string or template. A user-facing error says
 * what failed and what to do; "something went wrong" says neither. The deny-list is deliberately
 * short and literal: the gate cannot tell a good sentence from a vague one beyond it (review owns that).
 */
const GENERIC = /\b(?:unknown error|internal error|something went wrong|request failed|operation failed|an? (?:\w+ )?error occurred)\b/i;

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: { generic: 'Generic failure text "{{phrase}}". Say what failed and what to do next (a catalog sentence or the boundary\'s own fallback words).' },
  },
  create(context) {
    const check = (node, text) => {
      const match = typeof text === 'string' ? GENERIC.exec(text) : null;
      if (match) context.report({ node, messageId: 'generic', data: { phrase: match[0] } });
    };
    return {
      Literal(node) { check(node, node.value); },
      TemplateElement(node) { check(node, node.value.cooked); },
    };
  },
};

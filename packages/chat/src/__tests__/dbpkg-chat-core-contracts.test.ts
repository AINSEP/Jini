import { expect, it } from 'vitest';
import {
  buildTranscript, deriveConversationTitle, deriveToolStatus, formatFormAnswers,
  latestTodosFromEvents, parsePartialJson, parseQuestionForm, sanitizePriorAssistantTurn,
  splitStreamingArtifact, toRenderProps,
} from '../core/index.js';

it('retains JSON-prefix repair and incomplete artifact separation with object arguments', () => {
  expect(parsePartialJson({ buf: '{"answer":"hel' })).toEqual({ answer: 'hel' });
  expect(splitStreamingArtifact({ content: 'Intro <artifact identifier="a" type="html" title="A">body' })).toEqual({
    head: 'Intro', live: { identifier: 'a', artifactType: 'html', title: 'A', content: 'body' },
  });
});

it('retains the default failed status when a completed run has no tool result', () => {
  const use = { kind: 'tool_use' as const, id: 't', name: 'search', input: { query: 'wind' } };
  expect(deriveToolStatus({ result: undefined, runStreaming: false })).toBe('error');
  expect(deriveToolStatus({ result: undefined, runStreaming: false }, { runSucceeded: true })).toBe('complete');
  expect(toRenderProps({ use, result: undefined, runStreaming: true })).toEqual({
    status: 'executing', name: 'search', args: { query: 'wind' }, result: undefined, isError: false, media: undefined,
  });
});

it('keeps conversation title and transcript order independent of argument containers', () => {
  const history = [{ id: 'u', role: 'user' as const, content: 'Autumn wind' }];
  // Title Case, as `persistence/title.test.ts` pins ("Login Bug") since f31447e6.
  expect(deriveConversationTitle({ prompt: 'Autumn wind' })).toBe('Autumn Wind');
  expect(buildTranscript({ history })).toBe('## user\nAutumn wind');
  expect(sanitizePriorAssistantTurn({ content: 'A <question-form>{"questions":[]}</question-form> B' })).toBe('A [question-form was emitted here on a prior turn; the user already answered, see their reply below.] B');
});

it('retains the last plan update and question form round trip', () => {
  expect(latestTodosFromEvents({ events: [
    { kind: 'tool_use', id: 'old', name: 'TodoWrite', input: { todos: [{ content: 'Old', status: 'pending' }] } },
    { kind: 'tool_use', id: 'new', name: 'TodoWrite', input: { todos: [{ content: 'New', status: 'completed', activeForm: undefined }] } },
  ] })).toEqual([{ content: 'New', status: 'completed', activeForm: undefined }]);
  const form = parseQuestionForm({ input: '<question-form>{"questions":[{"id":"q","label":"Which?","options":["One","Two"]}]}</question-form>' });
  expect(form?.questions).toHaveLength(1);
  expect(formatFormAnswers({ form: form!, answers: { q: 'One' } })).toBe('[form answers — discovery]\n- Which?: One');
});

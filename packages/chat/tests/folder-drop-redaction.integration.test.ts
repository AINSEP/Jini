import { expect, it } from 'vitest';
import { redactUserText } from '../src/core/user-text-redaction.js';
// Keep cross-package source integration outside src so it does not expand the package build's rootDir.
import { formatDroppedFolderPaths } from '@jini-ai/ui/core';

it.each([
  '/Users/la/Client Work/CustomerPortal2026ProductionSourceFilesAndDocuments',
  String.raw`C:\Users\la\Client Work\CustomerPortal2026ProductionSourceFilesAndDocuments`,
  '/Users/la/Client\tWork/CustomerPortal2026ProductionSourceFilesAndDocuments',
  '/Users/la/Client\u00a0Work/CustomerPortal2026ProductionSourceFilesAndDocuments',
])('keeps a whitespace-containing dropped path quoted through redaction: %s', path => {
  const text = formatDroppedFolderPaths([path, '/Users/la/proj']);
  expect(text).toBe(`"${path}" /Users/la/proj`);
  expect(redactUserText({ text })).toEqual({ text, secretRedacted: false, count: 0 });
  const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  expect(redactUserText({ text: `${text} ${secret}` })).toEqual({ text: `${text} [token removed]`, secretRedacted: true, count: 1 });
});

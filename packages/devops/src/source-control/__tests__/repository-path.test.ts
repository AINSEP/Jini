import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizeRepositoryFolder, prefixRepositoryPath, repositoryPathContained } from '../repository-path.js';

test('repository folders default to root and normalize separators without hiding traversal', () => {
  assert.equal(normalizeRepositoryFolder({}), '');
  assert.equal(normalizeRepositoryFolder({ folder: '' }), '');
  assert.equal(normalizeRepositoryFolder({ folder: 'sites\\summer//pages/' }), 'sites/summer/pages');
  for (const folder of [null, 1, {}, [], '/site', '\\site', 'C:site', 'a/../b', './site', 'a//./b', 'a\u0000b', 'a\nb', 'a\u007fb']) {
    assert.throws(() => normalizeRepositoryFolder({ folder }), /folder/i, String(folder));
  }
});

test('prefixing and containment enforce exact canonical directory boundaries', () => {
  for (const folder of ['', 'site', 'nested/site', 'space folder', '日本語']) {
    const path = prefixRepositoryPath({ folder, path: 'pages/index.html' });
    assert.equal(path, folder ? `${folder}/pages/index.html` : 'pages/index.html');
    assert.equal(repositoryPathContained({ folder, path }), true);
    assert.equal(repositoryPathContained({ folder, path: `${folder}/../outside` }), false);
  }
  for (const path of ['site', 'site-old/a', 'other/a', 'site/../a', 'site//a', '/site/a', 'site\\a']) {
    assert.equal(repositoryPathContained({ folder: 'site', path }), false, path);
  }
  for (const path of ['', '../a', '/a', 'a/../b', 'a\\b', 'a//b']) {
    assert.throws(() => prefixRepositoryPath({ folder: 'site', path }), /path/i);
  }
});

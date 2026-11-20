import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { cleanLabel, isWithin, safeName, safeSegments, walkFiles } from './paths.js';

describe('safeSegments', () => {
  it('splits a normal nested path', () => {
    assert.deepEqual(safeSegments('photos/2024/a.jpg'), ['photos', '2024', 'a.jpg']);
  });

  it('copes with backslashes and redundant separators', () => {
    assert.deepEqual(safeSegments('a\\b//c/./d.txt'), ['a', 'b', 'c', 'd.txt']);
  });

  it('rejects parent traversal', () => {
    for (const bad of ['../evil.txt', 'a/../../evil', '..', 'a/..']) assert.equal(safeSegments(bad), null, bad);
  });

  it('rejects empty paths', () => {
    for (const bad of ['', '/', './', null, undefined]) assert.equal(safeSegments(bad), null, String(bad));
  });

  it('replaces control and reserved characters', () => {
    assert.deepEqual(safeSegments('a\x00b/c:d?.txt'), ['a_b', 'c_d_.txt']);
  });

  it('limits segment length', () => {
    assert.equal(safeSegments('x'.repeat(500))?.[0]?.length, 200);
  });

  it('avoids names Windows cannot create', () => {
    assert.deepEqual(safeSegments('CON/aux.txt/nul/COM1.log'), ['_CON', '_aux.txt', '_nul', '_COM1.log']);
    assert.deepEqual(safeSegments('notes. /file.txt. /ok'), ['notes', 'file.txt', 'ok'], 'trailing dots and spaces dropped');
    assert.deepEqual(safeSegments('console/lpt10/conx.txt'), ['console', 'lpt10', 'conx.txt'], 'only exact reserved names');
  });

  it('still rejects traversal hidden behind trailing-dot tricks', () => {
    for (const bad of ['a/.. /b', '../.', 'a/../b']) {
      const result = safeSegments(bad);
      assert.ok(result === null || !result.includes('..'), bad);
    }
    assert.equal(safeSegments('../b'), null);
    assert.equal(safeSegments('a/../b'), null);
  });
});

describe('safeName', () => {
  it('removes directory characters', () => {
    assert.equal(safeName('a/b\\c.zip', 'files'), 'a_b_c.zip');
  });

  it('falls back when nothing usable is left', () => {
    for (const bad of ['', '   ', '.', '..', null, undefined]) assert.equal(safeName(bad, 'files'), 'files');
  });
});

describe('cleanLabel', () => {
  it('trims, strips control characters and limits length', () => {
    assert.equal(cleanLabel("  Bob\x07's phone  "), "Bob's phone");
    assert.equal(cleanLabel('x'.repeat(100)).length, 30);
  });
});

describe('filesystem helpers', () => {
  it('isWithin', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eazy-paths-'));
    try {
      assert.ok(isWithin(root, path.join(root, 'a', 'b.txt')));
      assert.ok(!isWithin(root, path.join(root, '..', 'x')));
      assert.ok(!isWithin(root, root), 'the root itself is not "within" itself');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('walkFiles is sorted and relative', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eazy-paths-'));
    try {
      fs.mkdirSync(path.join(root, 'b'));
      fs.writeFileSync(path.join(root, 'b', '2.txt'), '2');
      fs.writeFileSync(path.join(root, 'a.txt'), 'a');
      assert.deepEqual(walkFiles(root).map((f) => f.relative), ['a.txt', 'b/2.txt']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

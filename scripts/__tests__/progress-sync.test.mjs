// Unit test for scripts/progress-sync.mjs using Node's built-in test
// runner. Renders the fixture progress folder into INDEX.md, then
// compares the rendered output (line by line, after normalizing line
// endings) against the expected-INDEX.md fixture.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderIndex } from '../progress-sync.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures', 'progress');
const EXPECTED_PATH = join(FIXTURE_DIR, 'expected-INDEX.md');

function normalize(s) {
  return s.replace(/\r\n/g, '\n').trimEnd();
}

test('renderIndex matches expected-INDEX.md for the 3-chunk fixture', () => {
  const expected = normalize(readFileSync(EXPECTED_PATH, 'utf8'));
  const actual = normalize(renderIndex(FIXTURE_DIR));
  assert.equal(actual, expected);
});

test('renderIndex skips files that do not start with chunk-', () => {
  const out = renderIndex(FIXTURE_DIR);
  // expected-INDEX.md itself lives in the fixture folder; the renderer
  // must ignore it instead of trying to parse it as a chunk.
  assert.equal(out.includes('expected-INDEX'), false);
});

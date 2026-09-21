import test from 'node:test';
import assert from 'node:assert/strict';
import { manuscriptDiff } from '../server/manuscript-diff.js';

test('Japanese edits highlight exact new characters without changing paragraph indices', () => {
  const after = '同じ段落。\n\n青い傘と🐈。\n\n後ろも同じ。';
  const d = manuscriptDiff('同じ段落。\n\n赤い傘と🐕。\n\n後ろも同じ。', after);
  assert.equal(d.paragraphs[0], null);
  assert.equal(d.paragraphs[2], null);
  assert.deepEqual(d.paragraphs[1].ranges.map(([s, e]) => '青い傘と🐈。'.slice(s, e)), ['青', '🐈']);
  assert.deepEqual(d.changes[0].ranges.map(([s, e]) => d.changes[0].before.slice(s, e)), ['赤', '🐕']);
});
test('added and deleted paragraphs retain positions and complete deleted text', () => {
  const d = manuscriptDiff('前。\n\n削除。\n\n後。', '前。\n\n後。\n\n追加。');
  assert.deepEqual(d.changes.map(c => [c.kind, c.at, c.count]), [['deleted', 1, 0], ['added', 2, 1]]);
  assert.equal(d.changes[0].before, '削除。');
  assert.equal(d.paragraphs[1], null);
  assert.deepEqual(d.paragraphs[2].ranges, [[0, 3]]);
});
test('new files, pure deletions, and paragraph splitting remain reviewable', () => {
  assert.equal(manuscriptDiff(null, '新規。').paragraphs[0].kind, 'added');
  assert.equal(manuscriptDiff('削除。', '').changes[0].before, '削除。');
  const d = manuscriptDiff('前。後。', '前。\n\n後。');
  assert.equal(d.paragraphs.length, 2);
  assert.equal(d.changes[0].before, '前。後。');
});
test('CRLF and repeated paragraph separators do not create false body edits', () => {
  assert.equal(manuscriptDiff('前。\r\n\r\n後。\r\n', '前。\n\n\n後。\n').changes.length, 0);
});
test('large rewrites use explicit coarse highlighting and keep the full previous text', () => {
  const old = 'あ'.repeat(40000), current = 'い'.repeat(40000);
  const d = manuscriptDiff(old, current);
  assert.equal(d.coarse, true);
  assert.equal(d.changes[0].before, old);
  assert.deepEqual(d.paragraphs[0].ranges, [[0, current.length]]);
});

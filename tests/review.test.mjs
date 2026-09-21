import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createReviewHandler } from '../server/review.js';

const repo = 'owner/novel', commit = 'a'.repeat(40), nextCommit = 'b'.repeat(40);
const baseCommit = 'c'.repeat(40), mergeBase = 'd'.repeat(40);
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'test' };
const keys = createLocalJWKSet({ keys: [jwk] });
const env = { ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'test', FEEDBACK_GITHUB_TOKEN: 'server-token' };
const jwt = await new SignJWT({ email: 'test@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('reader').setIssuer('https://test.cloudflareaccess.com').setAudience('test').setExpirationTime('5m').sign(privateKey);
const pull = { number: 7, title: '改稿 <script>', state: 'open', draft: true, base: { sha: baseCommit }, head: { repo: { full_name: repo }, ref: 'novel/revision', sha: commit } };
const rows = [
  { number: 1, title: '第一話', manuscript: 'main/001.txt' },
  { number: 2, title: '前後の話', manuscript: 'main/002.txt' },
  { number: 3, title: '削除した話', manuscript: 'main/003.txt' },
  { number: 4, title: '非本文', manuscript: 'wiki/secret.md' },
  { number: 5, title: 'リンク', manuscript: 'main/link.txt' },
  { number: 6, title: '親への参照', manuscript: 'main/../wiki/secret.md' },
];
function setup({ pr = pull, index = rows, format = 'standard', indexPath = 'plot/episodes.json', override = () => undefined } = {}) {
  const calls = [];
  const tree = [{ path: indexPath, sha: 'index', type: 'blob', mode: '100644' }, ...['main/001.txt', 'main/002.txt', 'main/第15.5話.md'].map(path => ({ path, sha: path, type: 'blob', mode: '100644' })), { path: 'main/link.txt', sha: 'secret', type: 'blob', mode: '120000' }];
  const handler = createReviewHandler({ repo, format, indexPath }, { keys: () => keys, fetcher: async (url, options) => {
    const p = url.replace(`https://api.github.com/repos/${repo}/`, '');
    assert.notEqual(p, url, 'all reads must stay in the configured repository');
    assert.equal(options.headers.Authorization, 'Bearer server-token');
    assert.equal(options.redirect, 'manual');
    calls.push(p);
    const custom = override(p, calls);
    if (custom !== undefined) return custom;
    if (p.startsWith('pulls?')) return Response.json([pr, { ...pr, number: 8, head: { ...pr.head, repo: { full_name: 'other/fork' } } }]);
    if (p === 'pulls/7') return Response.json(pr);
    if (p === `git/trees/${commit}?recursive=1`) return Response.json({ tree, truncated: false });
    if (p === `compare/${baseCommit}...${commit}?per_page=1`) return Response.json({ merge_base_commit: { sha: mergeBase } });
    if (p === `git/trees/${mergeBase}?recursive=1`) return Response.json({ tree: [{ path: 'main/001.txt', sha: 'old-body', type: 'blob', mode: '100644' }], truncated: false });
    if (p === 'git/blobs/old-body') return Response.json({ encoding: 'base64', content: Buffer.from('変更前の本文。\n\n日本語と🐈').toString('base64') });
    if (p === 'git/blobs/index') return Response.json({ encoding: 'base64', content: Buffer.from(JSON.stringify(index)).toString('base64') });
    if (p.startsWith('git/blobs/main/')) return Response.json({ encoding: 'base64', content: Buffer.from('PRの本文。\n\n日本語と🐈').toString('base64') });
    if (p.startsWith('pulls/7/files?')) return Response.json([{ filename: 'main/001.txt', status: 'modified' }, { filename: 'main/第15.5話.md', status: 'added' }, { filename: 'main/003.txt', status: 'removed' }]);
    throw new Error('unexpected request: ' + p);
  } });
  return { calls, run: (query = '', token = jwt, method = 'GET') => handler({ request: new Request('https://reader.example/api/review' + query, { method, headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} }), env }) };
}
test('PR list includes same-repository drafts, no forks or secrets, and never caches', async () => {
  const s = setup(), response = await s.run(), data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(data.repo, repo);
  assert.deepEqual(data.pulls.map(p => p.number), [7]);
  assert.equal(data.pulls[0].draft, true);
  assert.equal(JSON.stringify(data).includes(env.FEEDBACK_GITHUB_TOKEN), false);
});
test('index returns only indexed regular manuscripts and marks modified/added files', async () => {
  const s = setup(), data = await (await s.run('?pr=7')).json();
  assert.deepEqual(data.episodes.map(e => [e.number, e.changed]), [[1, true]]);
  assert.equal(data.pull.commit, commit);
  assert.equal(data.pull.branch, 'novel/revision');
  assert.equal(s.calls.filter(p => p === 'pulls/7').length, 2);
});
test('pinned body returns UTF-8, blob SHA and SHA-256', async () => {
  const s = setup(), response = await s.run(`?pr=7&commit=${commit}&path=main/001.txt`), body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.text, /日本語と🐈/);
  assert.equal(body.commit, commit);
  assert.match(body.hash, /^[a-f0-9]{64}$/);
  assert.equal(body.sha, 'main/001.txt');
  assert.equal(body.diff.baseCommit, mergeBase);
  assert.equal(body.diff.paragraphs[0].kind, 'changed');
  assert.equal(body.diff.paragraphs[1], null);
  assert.equal(body.diff.changes[0].before, '変更前の本文。');
});
test('supports Kiriya fractional episode numbers and Japanese manuscript paths', async () => {
  const s = setup({ format: 'kiriya', indexPath: 'kakuyomu/episodes.json', index: { episodes: [{ label: '第15.5話', title: '第15.5話　追加の話', file: 'main/第15.5話.md', kakuyomuSlot: 16 }] } });
  const data = await (await s.run('?pr=7')).json();
  assert.equal(data.episodes[0].number, '15.5');
  assert.equal(data.episodes[0].title, '追加の話');
  assert.equal(data.episodes[0].changed, true);
  assert.equal((await s.run(`?pr=7&commit=${commit}&path=${encodeURIComponent('main/第15.5話.md')}`)).status, 200);
});
test('rejects missing/forged authentication and POST without GitHub access', async () => {
  const s = setup();
  for (const token of ['', 'forged']) assert.equal((await s.run('', token)).status, 401);
  assert.equal((await s.run('', jwt, 'POST')).status, 405);
  assert.equal(s.calls.length, 0);
});
test('rejects closed, forked and stale PRs before reading manuscripts', async () => {
  for (const [pr, status] of [[{ ...pull, state: 'closed' }, 409], [{ ...pull, head: { ...pull.head, repo: null } }, 422], [{ ...pull, head: { ...pull.head, sha: nextCommit } }, 409]]) {
    const s = setup({ pr });
    assert.equal((await s.run(`?pr=7&commit=${commit}&path=main/001.txt`)).status, status);
    assert.equal(s.calls.some(p => p.startsWith('git/')), false);
  }
});
test('rejects index assembled while the PR changes', async () => {
  const s = setup({ override: (p, calls) => p === 'pulls/7' && calls.filter(x => x === p).length > 1 ? Response.json({ ...pull, head: { ...pull.head, sha: nextCommit } }) : undefined });
  assert.equal((await s.run('?pr=7')).status, 409);
});
test('refuses repository overrides, traversal, unindexed files, and symlink bodies', async () => {
  for (const query of ['?repo=other/repo', '?pr=../1', '?path=main/001.txt', '?pr=7&path=main/001.txt', `?pr=7&commit=${commit}&path=wiki/secret.md`, `?pr=7&commit=${commit}&path=main/../wiki/secret.md`]) assert.equal((await setup().run(query)).status, 400);
  for (const path of ['main/unindexed.txt', 'main/link.txt']) {
    const s = setup();
    assert.equal((await s.run(`?pr=7&commit=${commit}&path=${path}`)).status, 404);
    assert.equal(s.calls.includes('git/blobs/secret'), false);
  }
});
test('paginates changed files and lists without silently omitting later pages', async () => {
  const s = setup({ override: p => p.endsWith('page=1') ? Response.json(Array.from({ length: 100 }, () => p.startsWith('pulls?') ? pull : { filename: 'main/002.txt', status: 'modified' })) : undefined });
  await s.run();
  const data = await (await s.run('?pr=7')).json();
  assert.equal(data.episodes.find(e => e.number === 1).changed, true);
  assert.equal(s.calls.some(p => p.startsWith('pulls?') && p.endsWith('page=2')), true);
  assert.equal(s.calls.some(p => p.startsWith('pulls/7/files?') && p.endsWith('page=2')), true);
});
test('upstream failures do not expose tokens and explain the required PR permission', async () => {
  const s = setup({ override: () => new Response(env.FEEDBACK_GITHUB_TOKEN, { status: 403 }) });
  const response = await s.run(), data = await response.json();
  assert.equal(response.status, 502);
  assert.match(data.error, /Pull requests: Read/);
  assert.equal(data.error.includes(env.FEEDBACK_GITHUB_TOKEN), false);
});
test('rejects truncated trees and invalid JSON without serving a partial index', async () => {
  const s = setup({ override: p => p.startsWith('git/trees/') ? Response.json({ truncated: true, tree: [] }) : undefined });
  assert.equal((await s.run('?pr=7')).status, 422);
});

test('unchanged episodes cannot be opened through a PR body deep link', async () => {
  const s = setup();
  assert.equal((await s.run(`?pr=7&commit=${commit}&path=main/002.txt`)).status, 404);
  assert.equal(s.calls.includes('git/blobs/main/002.txt'), false);
});

test('renamed manuscript compares with its original path at the merge base', async () => {
  const s = setup({ override: p => {
    if (p.startsWith('pulls/7/files?')) return Response.json([{ filename: 'main/001.txt', previous_filename: 'main/旧題.txt', status: 'renamed' }]);
    if (p === `git/trees/${mergeBase}?recursive=1`) return Response.json({ tree: [{ path: 'main/旧題.txt', sha: 'old-body', type: 'blob', mode: '100644' }] });
  } });
  const response = await s.run(`?pr=7&commit=${commit}&path=main/001.txt`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).diff.basePath, 'main/旧題.txt');
});

test('comparison rejects symlinks, non-manuscript rename sources and base changes during loading', async () => {
  for (const override of [
    p => p === `git/trees/${mergeBase}?recursive=1` ? Response.json({ tree: [{ path: 'main/001.txt', sha: 'private', type: 'blob', mode: '120000' }] }) : undefined,
    p => p.startsWith('pulls/7/files?') ? Response.json([{ filename: 'main/001.txt', previous_filename: 'wiki/private.md', status: 'renamed' }]) : undefined,
  ]) {
    const s = setup({ override });
    assert.equal((await s.run(`?pr=7&commit=${commit}&path=main/001.txt`)).status, 422);
    assert.equal(s.calls.includes('git/blobs/private'), false);
  }
  const s = setup({ override: (p, calls) => p === 'pulls/7' && calls.filter(x => x === p).length > 1 ? Response.json({ ...pull, base: { sha: nextCommit } }) : undefined });
  assert.equal((await s.run(`?pr=7&commit=${commit}&path=main/001.txt`)).status, 409);
});


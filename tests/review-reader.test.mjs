import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync(new URL('../reader/index.html', import.meta.url), 'utf8');
const modern = existsSync(new URL('../reader/app.js', import.meta.url));
const script = modern ? readFileSync(new URL('../reader/app.js', import.meta.url), 'utf8') : html.match(/<script>([\s\S]*?)<\/script>/)[1];
const helper = readFileSync(new URL('../reader/pull-requests.js', import.meta.url), 'utf8');
const repo = modern ? 'owner/novel' : html.match(/const cfg = \{ repo: '([^']+)'/)[1];
const kiriya = repo.endsWith('novel-kiriya'), n = kiriya ? '15.5' : 1;
const commit = 'a'.repeat(40), nextCommit = 'b'.repeat(40);
const pull = { number: 7, title: '改稿 <img onerror="alert(1)">', branch: 'novel/revision', commit, url: `https://github.com/${repo}/pull/7`, draft: true };
const row = { number: n, title: '検証用', kind: '', manuscript: 'main/001.txt', changed: true };
const key = `draft:${repo}:${modern ? 'main:' : ''}${n}`;
const savedPath = 'feedback/001-20260921-010101-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md';
function page({ search = '?pr=7', hash = '', override = async () => undefined } = {}) {
  const nodes = new Map(), store = new Map(), requests = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '', style: { setProperty() {} }, dataset: {}, listeners: {},
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
      addEventListener(event, fn) { this.listeners[event] = fn; }, querySelectorAll: () => [], querySelector: () => node('child') });
    return nodes.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: node, documentElement: node('root'), addEventListener() {} },
    localStorage: { get length() { return store.size; }, key: i => [...store.keys()][i], getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    sessionStorage: { length: 0 },
    location: { protocol: 'https:', hostname: 'reader.example', href: `https://reader.example/reader/${search}${hash}`, search, hash },
    history: { replaceState() {} }, URL, URLSearchParams, Blob, crypto, console, addEventListener() {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      const custom = await override(url, options);
      if (custom !== undefined) return custom;
      const query = new URL(url, 'https://reader.example/reader/').searchParams;
      if (url.startsWith('../api/review')) return Response.json({ repo, ...(query.has('path') ? { text: 'PR本文。\n\n二段落目。', hash: 'c'.repeat(64), sha: 'blob-sha', commit } : query.has('pr') ? { pull, episodes: [row] } : { pulls: [pull] }) });
      if (url === '../api/feedback') return Response.json(options.method === 'POST' ? { path: savedPath } : { configured: true, repo, branch: 'main' });
      if (url === 'project.json') return Response.json({ repo, title: '検証用', branch: 'main', hashes: {}, commit: 'main-commit' });
      if (url.includes('episodes.json')) return Response.json(kiriya ? { episodes: [{ label: `第${n}話`, title: '検証用', file: row.manuscript }] } : [row]);
      return new Response('通常版の本文。');
    },
  });
  vm.runInContext(helper, context); vm.runInContext(script, context);
  const run = s => vm.runInContext(s, context);
  return { node, store, requests, run, ready: run('startup'), click: id => node(id).listeners.click(), async choose(value) { node('review-source').value = value; await node('review-source').listeners.change(); } };
}
test('PR deep link opens changed manuscript at the pinned commit and escapes its title', async () => {
  const p = page(); await p.ready;
  assert.equal(p.run('cur.commit'), commit);
  assert.equal(p.run('cur.pr'), 7);
  assert.equal(p.run('cur.paras[0]'), 'PR本文。');
  assert.equal(p.run('cur.n'), n);
  assert.match(p.node('meta').textContent, /PR #7/);
  assert.match(p.node('eplist').innerHTML, /変更あり/);
  assert.doesNotMatch(p.node('review-source').innerHTML, /<img/);
  assert.match(p.requests.find(r => r.url.includes('path=')).url, new RegExp(`commit=${commit}`));
});
test('PR feedback and copied instruction record PR, branch, commit and body hash', async () => {
  const p = page(); await p.ready;
  p.node('overall').value = '会話を増やす'; p.run('saveDraft()');
  const markdown = p.run('toMarkdown()');
  assert.match(markdown, /pull\/7/); assert.match(markdown, /novel\/revision/);
  assert.match(markdown, new RegExp(commit)); assert.match(markdown, /本文SHA-256: c{64}/);
  assert.match(p.run(modern ? 'agentPrompt("feedback/test.md")' : 'devinPrompt("feedback/test.md")'), /このPRのブランチで修正/);
  await p.click('submit');
  const sent = p.requests.find(r => r.options.method === 'POST');
  assert.equal(sent.url, '../api/feedback');
  assert.match(JSON.parse(sent.options.body).markdown, /pull\/7/);
  assert.equal(p.store.has(`${key}:pr:7:${commit}`), false);
});
test('main and PR drafts remain separate when switching the same episode', async () => {
  const p = page(); await p.ready;
  p.node('overall').value = 'PRへの指示'; p.run('saveDraft()');
  p.store.set(key, JSON.stringify({ overall: '通常版への指示', anns: [] }));
  await p.choose('');
  assert.equal(p.node('overall').value, '通常版への指示');
  assert.equal(p.run('cur.pr'), undefined);
  await p.choose('7');
  assert.equal(p.node('overall').value, 'PRへの指示');
  assert.equal(JSON.parse(p.store.get(key)).overall, '通常版への指示');
});
test('refreshing an updated PR retains old draft and starts a distinct new-version draft', async () => {
  let latest = commit;
  const p = page({ override: async url => {
    if (!url.startsWith('../api/review?')) return;
    const q = new URL(url, 'https://reader.example').searchParams;
    return Response.json({ repo, ...(q.has('path') ? { text: 'PR本文。', hash: 'd'.repeat(64), commit: latest, sha: 'blob' } : { pull: { ...pull, commit: latest }, episodes: [row] }) });
  } });
  await p.ready; p.node('overall').value = '旧版への指示'; p.run('saveDraft()');
  latest = nextCommit; await p.click('review-refresh');
  assert.equal(p.run('cur.commit'), nextCommit);
  assert.equal(p.node('overall').value, '');
  assert.equal(JSON.parse(p.store.get(`${key}:pr:7:${commit}`)).overall, '旧版への指示');
});
test('stale PR file errors never fall back to the main manuscript', async () => {
  const p = page({ override: async url => url.includes('path=') ? Response.json({ error: 'PRが更新されました。' }, { status: 409 }) : undefined });
  await p.ready;
  assert.equal(p.run('cur'), null);
  assert.equal(p.node('submit').disabled, true);
  assert.match(p.node('status').textContent, /PRが更新/);
  assert.equal(p.requests.some(r => r.url.startsWith('../main/')), false);
});
test('older PR drafts remain exportable with their original source and quotes', async () => {
  const p = page(); await p.ready;
  p.node('overall').value = '旧版に対する指示'; p.run('saveDraft()');
  p.run(`review.pull = {...review.pull, commit: '${nextCommit}'}; draft = {overall:'',anns:[]};`);
  const markdown = p.run('reviewSavedDrafts()');
  assert.match(markdown, /旧版に対する指示/);
  assert.match(markdown, new RegExp(commit));
  assert.match(markdown, /main\/001.txt/);
  assert.match(markdown, /novel\/revision/);
  assert.equal(p.store.has(`${key}:pr:7:${commit}`), true);
});
test('failed PR switch clears old manuscript so it cannot be mistaken for the PR', async () => {
  const p = page({ search: '', override: async url => url.includes('?pr=7') ? Response.json({ error: '権限を確認' }, { status: 502 }) : undefined });
  await p.ready; await p.run(`openEpisode(${JSON.stringify(n)})`);
  await p.choose('7');
  assert.equal(p.run('cur'), null); assert.equal(p.node('text').innerHTML, '');
  assert.equal(p.node('overall').disabled, true); assert.equal(p.node('submit').disabled, true);
});
test('PR submission in flight does not clear the same episode draft in main', async () => {
  let finish, started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const p = page({ override: async (_url, options) => options.method === 'POST' ? new Promise(resolve => { finish = resolve; started(); }) : undefined });
  await p.ready; p.node('overall').value = 'PRへの指示'; p.run('saveDraft()');
  const sending = p.click('submit'); await startedPromise;
  await p.choose(''); p.node('overall').value = '通常版への新しい指示'; p.run('saveDraft()');
  finish(Response.json({ path: savedPath })); await sending;
  assert.equal(JSON.parse(p.store.get(key)).overall, '通常版への新しい指示');
  assert.equal(p.node('overall').value, '通常版への新しい指示');
});
test('a slower old source request cannot overwrite a later source choice', async () => {
  let finish, hold = false;
  const p = page({ override: async url => hold && url === '../api/review?pr=7' ? new Promise(resolve => { finish = resolve; }) : undefined });
  await p.ready; hold = true;
  const stale = p.run('loadIndex()');
  await p.choose('');
  finish(Response.json({ repo, pull, episodes: [row] })); await stale;
  assert.equal(p.run('review.pull'), null);
  assert.equal(p.run('cur?.pr'), undefined);
});

test('PR index hides unchanged episodes even when the old deep link points to one', async () => {
  const p = page({ hash: '#99', override: async url => url === '../api/review?pr=7'
    ? Response.json({ repo, pull, episodes: [{ ...row, number: 99, title: '変更なし', changed: false }, row] }) : undefined });
  await p.ready;
  assert.equal(p.run('episodes.length'), 1);
  assert.equal(p.run('cur.n'), n);
  assert.doesNotMatch(p.node('eplist').innerHTML, /変更なし/);
});
test('PR with no changed manuscript clears the body and explains the empty list', async () => {
  const p = page({ override: async url => url === '../api/review?pr=7'
    ? Response.json({ repo, pull, episodes: [{ ...row, changed: false }] }) : undefined });
  await p.ready;
  assert.equal(p.run('cur'), null);
  assert.equal(p.node('eplist').innerHTML, '');
  assert.equal(p.node('submit').disabled, true);
  assert.match(p.node('status').textContent, /追加・変更された本文はありません/);
});
test('diff highlights coexist with annotations without changing quotes or leaking old HTML', async () => {
  const diff = { paragraphs: [{ kind: 'changed', ranges: [[0, 2]] }, null], changes: [{ at: 0, count: 1, kind: 'changed', before: '<img onerror="alert(1)">', ranges: [[0, 22]] }], coarse: false };
  const p = page({ override: async url => url.includes('path=') ? Response.json({ repo, text: 'PR本文。\n\n二段落目。', hash: 'c'.repeat(64), sha: 'blob', commit, diff }) : undefined });
  await p.ready;
  assert.match(p.node('text').innerHTML, /<ins class="pr-added">PR<\/ins>/);
  assert.match(p.node('text').innerHTML, /data-pr-change="変更"/);
  assert.doesNotMatch(p.node('review-changes').innerHTML, /<img/);
  assert.match(p.node('review-changes').innerHTML, /&lt;img/);
  p.run("draft.anns.push({type:'fix',pStart:0,pEnd:0,quote:'PR本文。',comment:'確認'}); renderText(); saveDraft()");
  assert.match(p.node('text').innerHTML, /<mark class="c-fix"><ins class="pr-added">PR<\/ins><\/mark>/);
  const markdown = p.run('toMarkdown()');
  assert.match(markdown, /> PR本文。/);
  assert.doesNotMatch(markdown, /<ins|<img|変更前/);
  await p.choose('');
  assert.equal(p.node('review-changes').hidden, true);
  assert.doesNotMatch(p.node('text').innerHTML, /pr-added/);
});

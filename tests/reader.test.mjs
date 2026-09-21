import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../reader/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../reader/index.html', import.meta.url), 'utf8');
const repo = 'owner/test-novel', branch = 'main';
const key = `draft:${repo}:${branch}:1`;
const savedPath = 'feedback/001-20260921-010101-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md';
function page({ api = async (_url, options) => Response.json(options.method === 'POST' ? { path: savedPath } : { configured: true, repo, branch }) } = {}) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '', style: { setProperty() {} }, dataset: {}, disabled: false, listeners: {},
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
      addEventListener(event, handler) { this.listeners[event] = handler; }, querySelectorAll: () => [], querySelector() { return node('child'); } });
    return nodes.get(id);
  }
  const store = new Map([['darask:cfg', JSON.stringify({ token: 'old-token', repo: 'other/repo' })], [key, JSON.stringify({ overall: '修正指示', anns: [] })]]);
  const session = new Map([['darask:token:owner/old', 'old-token']]);
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: node, documentElement: node('documentElement'), addEventListener() {} },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k) },
    sessionStorage: { get length() { return session.size; }, key: i => [...session.keys()][i], removeItem: k => session.delete(k) },
    location: { protocol: 'https:', hostname: 'reader.example', search: '?repo=other/repo', hash: '' },
    URLSearchParams, URL, Blob, console, crypto, addEventListener() {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url === '../api/review') return Response.json({ repo, pulls: [] });
      if (url === '../api/feedback') return api(url, options);
      if (url === 'project.json') return Response.json({ title: '作品', repo, branch, commit: 'abc', hashes: {} });
      return Response.json([]);
    },
  });
  vm.runInContext(readFileSync(new URL('../reader/pull-requests.js', import.meta.url), 'utf8'), context);
  vm.runInContext(script, context);
  async function prepare() {
    await vm.runInContext('startup', context);
    vm.runInContext("cur = { n: 1, title: '題名', path: 'main/001.txt', paras: ['本文'], commit: 'abc', hash: 'sha' }; draft = LS.get(draftKey(1), null); $('overall').value = draft.overall; renderSide();", context);
  }
  return { node, store, session, requests, context, prepare, click: id => node(id).listeners.click() };
}

test('removes old browser credentials, preserves drafts, and ignores repo query overrides', async () => {
  const p = page(); await p.prepare();
  assert.equal(p.session.size, 0);
  assert.equal(p.store.has('darask:cfg'), false);
  assert.equal(p.store.has(key), true);
  assert.equal(vm.runInContext('cfg.repo', p.context), repo);
  assert.doesNotMatch(html + script, /id="s-token"|api\.github\.com|github_pat_/);
});
test('checks server destination and submits only episode and markdown to same origin', async () => {
  const p = page(); await p.prepare(); await p.click('submit');
  const sent = p.requests.find(r => r.options.method === 'POST');
  assert.equal(sent.url, '../api/feedback');
  assert.equal(sent.options.credentials, 'same-origin');
  assert.equal(sent.options.redirect, 'error');
  const body = JSON.parse(sent.options.body);
  assert.deepEqual(Object.keys(body).sort(), ['episode','markdown']);
  assert.equal(body.episode, '1');
  assert.match(body.markdown, /修正指示/);
  assert.equal(p.store.has(key), false);
});
test('mismatched server repository never receives a POST', async () => {
  const p = page({api: async () => Response.json({ configured: true, repo:'other/repo', branch })});
  await p.prepare(); await p.click('submit');
  assert.equal(p.requests.some(r => r.options.method === 'POST'), false);
  assert.equal(p.store.has(key), true);
  assert.match(p.node('status').textContent, /一致しません/);
});
test('failed submission retains the draft and enables retry', async () => {
  const p = page({api: async (_url,opt) => opt.method === 'POST' ? Response.json({error:'保存に失敗'}, {status:502}) : Response.json({configured:true,repo,branch})});
  await p.prepare(); await p.click('submit');
  assert.equal(p.store.has(key), true);
  assert.equal(p.node('submit').disabled, false);
});
test('edits made while sending remain after success and duplicate sends are suppressed', async () => {
  let finish; const response = new Promise(resolve => {finish=resolve;});
  const p = page({api: async (_url,opt) => opt.method === 'POST' ? response : Response.json({configured:true,repo,branch})});
  await p.prepare(); const pending = p.click('submit'); await p.click('submit');
  p.node('overall').value = '送信中の追記';
  vm.runInContext('saveDraft()', p.context);
  finish(Response.json({path:savedPath})); await pending;
  assert.equal(p.requests.filter(r => r.options.method === 'POST').length, 1);
  assert.equal(JSON.parse(p.store.get(key)).overall, '送信中の追記');
});
test('switching episode while sending does not clear the new draft', async () => {
  let finish; const response = new Promise(resolve => {finish=resolve;});
  const p = page({api: async (_url,opt) => opt.method === 'POST' ? response : Response.json({configured:true,repo,branch})});
  await p.prepare(); const pending = p.click('submit');
  vm.runInContext("cur = {...cur, n:2}; draft = {overall:'第2話の指示',anns:[]}; $('overall').value=draft.overall; saveDraft();",p.context);
  finish(Response.json({path:savedPath})); await pending;
  assert.equal(JSON.parse(p.store.get(`draft:${repo}:${branch}:2`)).overall,'第2話の指示');
  assert.equal(p.store.has(key),true);
});

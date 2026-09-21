'use strict';
const TYPES = { fix: '修正', expand: '増やす', trim: '減らす', note: 'メモ' };
const $ = (id) => document.getElementById(id);
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};
const params = new URLSearchParams(location.search);
const cfg = { repo: '', branch: 'main' };
let site = null;
const isLocal = () => location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || params.has('local');
// Only remove credentials from prior reader versions; preserve all drafts.
try {
  LS.del('darask:cfg'); LS.del('cfg');
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (key.startsWith('darask:token:')) sessionStorage.removeItem(key);
  }
} catch {}

let episodes = [];
let cur = null;           // { n, title, kind, path, paras: string[], sha, commit }
let draft = null;         // { overall: string, anns: Ann[] }  Ann = { id, type, pStart, pEnd, quote, comment, ts }
let pending = null;       // selection captured when popup opened

// ---------- Static manuscript / same-origin feedback API ----------
async function getFile(path) {
  const res = await fetch(`../${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return { text: await res.text(), sha: '' };
}
async function headCommit() { return site?.commit || ''; }
async function siteApi(options = {}) {
  let res;
  try {
    res = await fetch('../api/feedback', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...options });
  } catch {
    throw new Error('通信できませんでした。ページを読み直してログインを確認してください。下書きは残っています。');
  }
  if (!res.headers.get('Content-Type')?.includes('application/json')) {
    throw new Error('送信サービスを確認できません。再ログインしても直らない場合は管理者に連絡してください。');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '送信サービスでエラーが発生しました。');
  return data;
}
async function checkConnection() {
  const data = await siteApi();
  if (data.configured !== true || data.repo !== cfg.repo || data.branch !== cfg.branch) {
    throw new Error('配信元と送信先の作品・ブランチが一致しません。管理者がnovel.tomlとCloudflareの設定を確認してください。');
  }
  return data;
}

// ---------- load ----------
function status(msg, isErr = false) { $('status').textContent = msg; $('status').style.color = isErr ? 'var(--fix)' : 'var(--muted)'; }
function statusHTML(html) { $('status').innerHTML = html; $('status').style.color = 'var(--muted)'; }

async function loadIndex() {
  try {
    ++openSerial;
    cur = null; draft = null;
    $('text').innerHTML = ''; $('annlist').innerHTML = ''; $('overall').value = '';
    $('submit').disabled = true;
    const { text } = await getFile('plot/episodes.json');
    episodes = JSON.parse(text);
    renderToc();
    const h = location.hash.match(/^#(\d+)$/);
    if (h) await openEpisode(+h[1]);
  } catch (e) {
    status(`索引の読み込みに失敗: ${e.message}\nページを読み直してください。ローカルではHTTPサーバーから開いてください。`, true);
  }
}

function renderToc() {
  $('eplist').innerHTML = episodes.map((e) => {
    const d = LS.get(draftKey(e.number), null);
    const has = d && (d.anns.length || d.overall.trim());
    return `<a class="ep${cur && cur.n === e.number ? ' active' : ''}${has ? ' has-draft' : ''}" href="#${e.number}" data-n="${e.number}">
      <span class="n">${String(e.number).padStart(3, '0')}</span><span>${esc(e.title)}</span><span class="k">${esc(e.kind)}</span></a>`;
  }).join('');
}

const draftKey = (n) => `draft:${cfg.repo}:${cfg.branch}:${n}`;
let openSerial = 0;

async function openEpisode(n) {
  const e = episodes.find((x) => x.number === n);
  if (!e) return;
  status('読み込み中…');
  const serial = ++openSerial; const sourceRepo = cfg.repo; const sourceBranch = cfg.branch;
  try {
    const commit = await headCommit();
    const { text, sha } = await getFile(e.manuscript, commit || cfg.branch);
    if (serial !== openSerial || cfg.repo !== sourceRepo || cfg.branch !== sourceBranch) return;
    const hash = site?.hashes?.[e.manuscript] || '';
    const paras = text.replace(/\r\n/g, '\n').split(/\n\n+/).map((p) => p.replace(/^\n+|\n+$/g, ''));
    cur = { n, title: e.title, kind: e.kind, path: e.manuscript, paras, sha, commit, hash, sourceRepo, sourceBranch };
    draft = LS.get(draftKey(n), { overall: '', anns: [] });
    $('overall').value = draft.overall;
    $('title').textContent = `第${n}話「${e.title}」`;
    $('meta').textContent = `${e.kind}・${bodyChars(text).toLocaleString()}字・${e.manuscript}${commit ? ' @ ' + commit.slice(0, 7) : ''}`;
    $('empty').style.display = 'none';
    location.hash = `#${n}`;
    renderText();
    renderSide();
    renderToc();
    status(draft.source && (draft.source.commit !== commit || draft.source.hash !== hash) ? '以前の本文への下書きです。保存時には元の版と引用を記録します。' : '');
    $('main').scrollTop = 0;
    closePanels();
  } catch (err) {
    status(`本文の読み込みに失敗: ${err.message}`, true);
  }
}

// 題名・空白・ルビの読みを除いた本文字数（scripts の count_body に近い簡易版）
function bodyChars(t) {
  return t.replace(/《[^》]*》/g, '').replace(/[｜|]/g, '').replace(/\s/g, '').length;
}

// ---------- render text ----------
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderText() {
  const byPara = new Map();
  draft.anns.forEach((a, idx) => {
    for (let p = a.pStart; p <= a.pEnd; p++) {
      if (!byPara.has(p)) byPara.set(p, []);
      byPara.get(p).push({ a, idx });
    }
  });
  $('text').innerHTML = cur.paras.map((p, i) => {
    const list = byPara.get(i) || [];
    const cls = list.length ? ` ann c-${list[0].a.type}` : '';
    const badge = list.length ? list.map((x) => `#${x.idx + 1}`).join(' ') : '+';
    return `<p data-i="${i}" class="${cls.trim()}"><span class="gut" data-i="${i}" title="この段落に指示を付ける">${badge}</span>${markup(p, i, list)}</p>`;
  }).join('');
}

function markup(text, i, list) {
  // 単一段落の注記だけ、引用箇所を <mark> で示す（重なりは先着優先）
  const ranges = [];
  for (const { a } of list) {
    if (a.pStart !== a.pEnd || !a.quote) continue;
    const s = text.indexOf(a.quote);
    if (s < 0) continue;
    const e = s + a.quote.length;
    if (ranges.some((r) => s < r.e && e > r.s)) continue;
    ranges.push({ s, e, t: a.type });
  }
  ranges.sort((x, y) => x.s - y.s);
  let out = '', pos = 0;
  for (const r of ranges) {
    out += esc(text.slice(pos, r.s)) + `<mark class="c-${r.t}">${esc(text.slice(r.s, r.e))}</mark>`;
    pos = r.e;
  }
  return out + esc(text.slice(pos));
}

// ---------- selection / popup ----------
const pop = $('pop');
function paraIndexOf(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  const p = el && el.closest('#text p');
  return p ? +p.dataset.i : -1;
}
function rangeText(r) {
  const frag = r.cloneContents();
  frag.querySelectorAll('.gut').forEach((g) => g.remove());
  const ps = frag.querySelectorAll('p');
  const parts = ps.length ? [...ps].map((p) => p.textContent) : [frag.textContent];
  return parts.map((s) => s.trim()).filter(Boolean).join('\n\n');
}
function showPop(x, y) {
  pop.style.display = 'block';
  $('pop-cm').style.display = 'none';
  pop.querySelector('.act').style.display = 'none';
  $('pop-cm').value = '';
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(x - w / 2, innerWidth - w - 8)) + 'px';
  pop.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
}
function hidePop() { pop.style.display = 'none'; pending = null; }

document.addEventListener('selectionchange', () => {
  if (pending && pending.type) return; // 入力中は閉じない
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !cur) {
    if (pending && !pending.whole) hidePop();
    return;
  }
  const r = sel.getRangeAt(0);
  const ps = paraIndexOf(r.startContainer), pe = paraIndexOf(r.endContainer);
  if (ps < 0 || pe < 0) return;
  const quote = rangeText(r);
  if (!quote) return;
  pending = { pStart: Math.min(ps, pe), pEnd: Math.max(ps, pe), quote };
  const rect = r.getBoundingClientRect();
  showPop(rect.left + rect.width / 2, rect.bottom + 8);
});

$('text').addEventListener('click', (ev) => {
  const g = ev.target.closest('.gut');
  if (!g) return;
  ev.preventDefault();
  const i = +g.dataset.i;
  getSelection().removeAllRanges();
  pending = { pStart: i, pEnd: i, quote: cur.paras[i], whole: true };
  const rect = g.getBoundingClientRect();
  showPop(rect.right + 140, rect.bottom + 8);
});

pop.querySelectorAll('.row button[data-t]').forEach((b) => b.addEventListener('click', () => {
  if (!pending) return;
  pending.type = b.dataset.t;
  $('pop-cm').style.display = 'block';
  $('pop-cm').placeholder = { fix: '何が問題で、どう直すか', expand: '何を厚くするか（例：会話をもう2往復、描写を足す）', trim: '何を削るか（例：説明が重複、半分に）', note: '気づいたこと' }[pending.type];
  pop.querySelector('.act').style.display = 'flex';
  $('pop-ok').textContent = `${TYPES[pending.type]}として追加`;
  $('pop-cm').focus();
}));
pop.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'TEXTAREA') e.preventDefault(); }); // 選択を保つ
$('pop-cancel').addEventListener('click', hidePop);
$('pop-ok').addEventListener('click', () => {
  if (!pending || !pending.type) return;
  draft.anns.push({ id: Date.now().toString(36), type: pending.type, pStart: pending.pStart, pEnd: pending.pEnd, quote: pending.quote, comment: $('pop-cm').value.trim(), ts: new Date().toISOString() });
  saveDraft();
  getSelection().removeAllRanges();
  hidePop();
  renderText(); renderSide();
});
$('pop-cm').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('pop-ok').click(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pending) { getSelection().removeAllRanges(); hidePop(); } });
document.addEventListener('mousedown', (e) => { if (!pop.contains(e.target) && !e.target.closest('.gut') && pending && pending.whole && !pending.type) hidePop(); });

// ---------- side panel ----------
function saveDraft() {
  if (!cur) return;
  if (!draft.source) draft.source = { commit: cur.commit, hash: cur.hash };
  draft.overall = $('overall').value;
  if (draft.anns.length || draft.overall.trim()) LS.set(draftKey(cur.n), draft); else LS.del(draftKey(cur.n));
  renderToc();
}
$('overall').addEventListener('input', () => { saveDraft(); renderSide(false); });

function renderSide(list = true) {
  const c = draft.anns.length + (draft.overall.trim() ? 1 : 0);
  $('anncount').textContent = c ? `${c}件` : '';
  $('anncount2').textContent = c ? `(${c})` : '';
  $('submit').disabled = submitting || !c;
  if (!list) return;
  $('annlist').innerHTML = draft.anns.map((a, i) => `
    <div class="card c-${a.type}" data-i="${i}">
      <div class="h"><b>#${i + 1} ${TYPES[a.type]}</b><span>段落${a.pStart + 1}${a.pEnd !== a.pStart ? '〜' + (a.pEnd + 1) : ''}</span>
        <button class="x" data-del="${i}" title="削除">✕</button></div>
      <blockquote>${esc(a.quote)}</blockquote>
      <div class="cm" contenteditable="plaintext-only" data-cm="${i}" data-placeholder="（指示を書く）">${esc(a.comment)}</div>
    </div>`).join('');
}
$('annlist').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { draft.anns.splice(+del.dataset.del, 1); saveDraft(); renderText(); renderSide(); return; }
  if (e.target.closest('[data-cm]')) return;
  const card = e.target.closest('.card');
  if (card) {
    const a = draft.anns[+card.dataset.i];
    document.querySelector(`#text p[data-i="${a.pStart}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    closePanels();
  }
});
$('annlist').addEventListener('input', (e) => {
  const cm = e.target.closest('[data-cm]');
  if (cm) { draft.anns[+cm.dataset.cm].comment = cm.textContent.trim(); saveDraft(); }
});

// ---------- markdown / submit ----------
function pad3(n) { return String(n).padStart(3, '0'); }
function stamp(d = new Date()) {
  const z = (x) => String(x).padStart(2, '0');
  return { file: `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`, human: `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}` };
}
function feedbackPath() { return `feedback/${pad3(cur.n)}-${stamp().file}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.md`; }
function toMarkdown() {
  const source = draft.source || cur;
  const lines = [`# 第${cur.n}話「${cur.title}」への修正指示`, '', `- 作成: ${stamp().human}`, `- 対象: ${cur.path}${source.commit ? ` @ ${source.commit}` : '（作業コピー・コミット未記録）'}`, `- 件数: ${draft.anns.length}${draft.overall.trim() ? '（＋話全体）' : ''}`, ''];
  if (source.hash) lines.push(`- 本文SHA-256: ${source.hash}`, '');
  if (draft.overall.trim()) lines.push('## 話全体', '', draft.overall.trim(), '');
  draft.anns.forEach((a, i) => {
    const where = `段落${a.pStart + 1}${a.pEnd !== a.pStart ? `〜${a.pEnd + 1}` : ''}`;
    lines.push(`## ${i + 1}. ${TYPES[a.type]}（${where}）`, '');
    lines.push(...a.quote.split('\n').map((l) => `> ${l}`), '');
    lines.push(a.comment || '（指示なし。種別どおりに扱う）', '');
  });
  return lines.join('\n');
}
function agentPrompt(path) {
  return `ja-novel-revise を使い、${path} の指示を第${cur.n}話（${cur.path}）に反映して。手順は feedback/README.md のとおり。`;
}

$('preview').addEventListener('click', () => {
  if (!cur) return;
  $('preview-text').textContent = toMarkdown();
  $('preview-dialog').showModal();
});
$('preview-close').addEventListener('click', () => $('preview-dialog').close());
$('clear').addEventListener('click', () => {
  if (!cur || !confirm('この話の下書きをすべて消しますか？')) return;
  draft = { overall: '', anns: [] }; $('overall').value = '';
  LS.del(draftKey(cur.n)); renderText(); renderSide(); renderToc();
});
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
let submitting = false;
$('submit').addEventListener('click', async () => {
  if (!cur || submitting || (!draft.anns.length && !draft.overall.trim())) return;
  const sendingCur = cur, sendingDraft = draft, sentText = toMarkdown();
  const snapshot = JSON.stringify(draft), key = draftKey(cur.n);
  const episode = String(cur.n), path = feedbackPath();
  if (isLocal()) {
    download(path.slice('feedback/'.length), sentText);
    statusHTML(`ダウンロードしました。<code>${esc(path)}</code> として保存してコミットしてください。`);
    LS.set(`sent:${cfg.repo}:${cur.n}`, path);
    return;
  }
  submitting = true; $('submit').disabled = true; status('コミット中…');
  try {
    await checkConnection();
    const result = await siteApi({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episode, markdown: sentText }) });
    if (!/^feedback\/[0-9.]+-[0-9-]+-[a-f0-9-]+\.md$/.test(result.path || '')) throw new Error('保存結果を確認できません。下書きは残しています。');
    LS.set(`sent:${cfg.repo}:${episode}`, result.path);
    if (cur !== sendingCur || draft !== sendingDraft) return;
    const url = `https://github.com/${cfg.repo}/blob/${encodeURIComponent(cfg.branch)}/${result.path}`;
    statusHTML(`送信しました: <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(result.path)}</a>`);
    if (JSON.stringify(draft) === snapshot) {
      draft = { overall: '', anns: [] }; $('overall').value = ''; LS.del(key);
    }
    renderText(); renderSide(); renderToc();
  } catch (e) {
    status(`送信に失敗: ${e.message}`, true);
  } finally {
    submitting = false;
    if (cur && draft) renderSide();
  }
});
$('copyprompt').addEventListener('click', () => {
  if (!cur) return;
  const sent = LS.get(`sent:${cfg.repo}:${cur.n}`, null);
  navigator.clipboard.writeText(agentPrompt(sent || `feedback/${pad3(cur.n)}-＜送信後のファイル名＞.md`));
  status(sent ? `コピーしました（${sent}）` : 'コピーしました（ファイル名は送信後に確定します）');
});

// ---------- settings / view ----------
async function openSettings() {
  $('settings').style.display = 'flex';
  $('connection-status').textContent = isLocal() ? 'ローカルではMarkdownを保存します。' : '接続を確認中…';
  if (isLocal()) return;
  try {
    await checkConnection();
    $('connection-status').textContent = 'ログインと送信先の設定を確認しました。';
  } catch (e) { $('connection-status').textContent = e.message; }
}
$('cfg').addEventListener('click', openSettings);
$('s-cancel').addEventListener('click', () => $('settings').style.display = 'none');
if (isLocal()) $('submit').textContent = '修正指示を保存（Markdown）';

let fs = LS.get('fs', 17);
function applyFs() { document.documentElement.style.setProperty('--fs', fs + 'px'); LS.set('fs', fs); }
$('fs-').addEventListener('click', () => { fs = Math.max(12, fs - 1); applyFs(); });
$('fs+').addEventListener('click', () => { fs = Math.min(28, fs + 1); applyFs(); });
applyFs();
$('vert').addEventListener('click', () => { $('text').classList.toggle('vertical'); LS.set('vert', $('text').classList.contains('vertical')); });
if (LS.get('vert', false)) $('text').classList.add('vertical');
function applyTheme(t) { document.documentElement.dataset.theme = t; LS.set('theme', t); $('theme').textContent = t === 'dark' ? '☀' : '☾'; }
$('theme').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
applyTheme(LS.get('theme', 'light'));

function closePanels() { $('toc').classList.remove('open'); $('side').classList.remove('open'); }
$('b-toc').addEventListener('click', () => { const o = $('toc').classList.contains('open'); closePanels(); if (!o) $('toc').classList.add('open'); });
$('b-side').addEventListener('click', () => { const o = $('side').classList.contains('open'); closePanels(); if (!o) $('side').classList.add('open'); });
$('b-read').addEventListener('click', closePanels);

$('eplist').addEventListener('click', (e) => { const a = e.target.closest('a.ep'); if (a) { e.preventDefault(); openEpisode(+a.dataset.n); } });
addEventListener('hashchange', () => { const h = location.hash.match(/^#(\d+)$/); if (h && (!cur || cur.n !== +h[1])) openEpisode(+h[1]); });

async function bootstrap() {
  if (location.protocol !== 'file:') {
    try {
      const res = await fetch('project.json', { cache: 'no-store' });
      if (res.ok) site = await res.json();
    } catch {}
  }
  if (site) {
    cfg.repo = site.repo;
    cfg.branch = site.branch;
    document.title = site.title + ' — 校閲リーダー';
  }
  await loadIndex();
}
const startup = bootstrap();

'use strict';
const TYPES = { fix: '修正', expand: '増やす', trim: '減らす', note: 'メモ' };
const $ = (id) => document.getElementById(id);
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};
const params = new URLSearchParams(location.search);
const savedCfg = LS.get('darask:cfg', {});
const cfg = { repo: savedCfg.repo || '', branch: savedCfg.branch || 'main', mode: savedCfg.mode || 'github', token: '' };
let site = null;
const validRepo = (r) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r);
const readToken = () => { try { return sessionStorage.getItem('darask:token:' + cfg.repo) || ''; } catch { return ''; } };
const storeToken = () => { try { const k = 'darask:token:' + cfg.repo; if (cfg.token) sessionStorage.setItem(k, cfg.token); else sessionStorage.removeItem(k); } catch {} };
if (params.get('repo')) cfg.repo = params.get('repo');
if (params.get('branch')) cfg.branch = params.get('branch');
if (params.has('local')) cfg.mode = 'local';

let episodes = [];
let cur = null;           // { n, title, kind, path, paras: string[], sha, commit }
let draft = null;         // { overall: string, anns: Ann[] }  Ann = { id, type, pStart, pEnd, quote, comment, ts }
let pending = null;       // selection captured when popup opened

// ---------- GitHub API ----------
async function gh(path, opt = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.headers || {}) };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  const res = await fetch(`https://api.github.com${path}`, { ...opt, headers });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg += `: ${(await res.json()).message}`; } catch {}
    throw new Error(msg);
  }
  return res.json();
}
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const b64encode = (s) => {
  const bytes = new TextEncoder().encode(s); let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
};
const isLocal = () => cfg.mode === 'local';
let hasStatic = false;   // 作品ルートごと配信されている（ローカル http.server / GitHub Pages）なら本文は同じ場所から読む
async function fetchStatic(path) {
  const res = await fetch(`../${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return { text: await res.text(), sha: '' };
}
async function getFile(path, ref = cfg.branch) {
  if (isLocal() || hasStatic) return fetchStatic(path);
  const j = await gh(`/repos/${cfg.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`);
  return { text: b64decode(j.content), sha: j.sha };
}
async function headCommit() {
  if (hasStatic || isLocal()) return site?.commit || '';
  if (!validRepo(cfg.repo)) throw new Error('接続設定に owner/name を入力してください');
  const j = await gh(`/repos/${cfg.repo}/commits/${encodeURIComponent(cfg.branch)}`);
  return j.sha;
}
async function putFile(path, content, message) {
  return gh(`/repos/${cfg.repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: b64encode(content), branch: cfg.branch }),
  });
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
    if (isLocal() && site && (cfg.repo !== site.repo || cfg.branch !== site.branch)) {
      throw new Error('ローカル配信の作品と接続先が異なります。接続先を配信元に戻すか、GitHub読込へ切り替えてください');
    }
    hasStatic = !!site && cfg.repo === site.repo && cfg.branch === site.branch;
    if (!hasStatic && !isLocal() && !validRepo(cfg.repo)) { openSettings(); return; }
    const { text } = await getFile('plot/episodes.json');
    episodes = JSON.parse(text);
    renderToc();
    const h = location.hash.match(/^#(\d+)$/);
    if (h) openEpisode(+h[1]);
  } catch (e) {
    status(`索引の読み込みに失敗: ${e.message}\n⚙ から読み込み元・トークン・リポジトリを確認してください。`, true);
    if (!cfg.token && !isLocal()) openSettings();
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
    const hash = (hasStatic || isLocal()) ? site?.hashes?.[e.manuscript] || '' : '';
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
  $('submit').disabled = !c;
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
$('submit').addEventListener('click', async () => {
  if (!cur) return;
  const path = feedbackPath();
  if (!cfg.token) {
    download(path.slice('feedback/'.length), toMarkdown());
    statusHTML(`ダウンロードしました。<code>${esc(path)}</code> として保存してコミットしてください。<br>執筆エージェント への依頼文: <code>${esc(agentPrompt(path))}</code>`);
    LS.set(`sent:${cfg.repo}:${cur.n}`, path);
    return;
  }
  if (!validRepo(cfg.repo) || cfg.repo !== cur.sourceRepo || cfg.branch !== cur.sourceBranch) {
    status('送信先が閲覧元と一致しません。接続設定と本文を読み直してください。', true); return;
  }
  const sendingCur = cur; const sendingDraft = draft; const sentText = toMarkdown();
  $('submit').disabled = true; status('コミット中…');
  try {
    const j = await putFile(path, sentText, `feedback: 第${cur.n}話への修正指示 ${draft.anns.length}件`);
    if (cur !== sendingCur || draft !== sendingDraft) return;
    const url = j.content?.html_url || '';
    statusHTML(`送信しました: <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(path)}</a><br>執筆エージェント への依頼文: <code>${esc(agentPrompt(path))}</code> <button class="btn" id="cp2">コピー</button>`);
    $('cp2').onclick = () => navigator.clipboard.writeText(agentPrompt(path));
    LS.set(`sent:${cfg.repo}:${cur.n}`, path);
    if (toMarkdown() === sentText) {
      draft = { overall: '', anns: [] }; $('overall').value = '';
      LS.del(draftKey(cur.n));
    }
    renderText(); renderSide(); renderToc();
  } catch (e) {
    status(`送信に失敗: ${e.message}`, true); $('submit').disabled = false;
  }
});
$('copyprompt').addEventListener('click', () => {
  if (!cur) return;
  const sent = LS.get(`sent:${cfg.repo}:${cur.n}`, null);
  navigator.clipboard.writeText(agentPrompt(sent || `feedback/${pad3(cur.n)}-＜送信後のファイル名＞.md`));
  status(sent ? `コピーしました（${sent}）` : 'コピーしました（ファイル名は送信後に確定します）');
});

// ---------- settings / view ----------
function openSettings() { $('s-mode').value = cfg.mode; $('s-repo').value = cfg.repo; $('s-branch').value = cfg.branch; $('s-token').value = cfg.token; $('settings').style.display = 'flex'; }
$('cfg').addEventListener('click', openSettings);
$('s-repo').addEventListener('input', () => { if ($('s-repo').value.trim() !== cfg.repo) $('s-token').value = ''; });
$('s-cancel').addEventListener('click', () => $('settings').style.display = 'none');
$('s-save').addEventListener('click', () => {
  const repo = $('s-repo').value.trim();
  if (repo && !validRepo(repo)) { status('リポジトリは owner/name の形式です。', true); return; }
  cfg.mode = $('s-mode').value; cfg.repo = repo; cfg.branch = $('s-branch').value.trim() || 'main';
  cfg.token = $('s-token').value.trim();
  storeToken();
  LS.set('darask:cfg', { mode: cfg.mode, repo: cfg.repo, branch: cfg.branch }); $('settings').style.display = 'none'; status(''); loadIndex();
});

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
    cfg.repo = params.get('repo') || site.repo;
    cfg.branch = params.get('branch') || site.branch;
    document.title = site.title + ' — 校閲リーダー';
  }
  cfg.token = readToken();
  await loadIndex();
}
bootstrap();

'use strict';
// Shared by the template and the two existing readers; drafts for main keep their keys.
const review = { number: '', pull: null, serial: 0, listSerial: 0, changeIndex: -1 };
async function reviewApi(query = {}) {
  const response = await fetch('../api/review' + (Object.keys(query).length ? '?' + new URLSearchParams(query) : ''), { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('PRを確認できません。ページを読み直してログインしてください。');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'PRを読み込めません。');
  if (data.repo !== cfg.repo) throw new Error('校閲元の作品設定が一致しません。管理者に連絡してください。');
  return data;
}
function reviewKey(base) {
  return review.pull ? `${base}:pr:${review.pull.number}:${review.pull.commit}` : base;
}
function reviewSource() {
  return review.pull ? { pr: review.pull.number, branch: review.pull.branch, url: review.pull.url } : {};
}
function reviewLines(source) {
  return source.pr ? [`- 対象PR: ${source.url}`, `- 修正先ブランチ: ${source.branch}`, '- 反映方法: 対象PRのブランチへ修正を反映する。閲覧した版と現在の差分を確認する。', ''] : [];
}
function reviewPrompt() {
  const source = draft?.source?.pr ? draft.source : cur || {};
  return source.pr ? ` 対象はPR #${source.pr}（${source.url}）、修正先は ${source.branch}。記録された閲覧版と現在の差分を確認し、このPRのブランチで修正して。` : '';
}
function reviewMessage(message) { document.getElementById('source-status').textContent = message; }
function reviewSavedDrafts() {
  const blocks = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(`draft:${cfg.repo}:`) || !/:pr:\d+:[a-f0-9]{40}$/.test(key)) continue;
    const saved = LS.get(key, null), source = saved?.source;
    if (!source?.pr || !Array.isArray(saved.anns)) continue;
    const lines = [`# PR #${source.pr}・第${source.number}話「${source.title}」`, '', `- 対象: ${source.path} @ ${source.commit}`, `- 本文SHA-256: ${source.hash}`, ...reviewLines(source)];
    if (saved.overall?.trim()) lines.push('## 話全体', '', saved.overall.trim(), '');
    saved.anns.forEach((a, index) => lines.push(`## ${index + 1}. ${TYPES[a.type]}（段落${a.pStart + 1}〜${a.pEnd + 1}）`, '', ...a.quote.split('\n').map(line => `> ${line}`), '', a.comment || '（指示なし。種別どおりに扱う）', ''));
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n---\n\n');
}
async function refreshReviews(reload = true) {
  const serial = ++review.listSerial;
  try {
    const data = await reviewApi();
    if (serial !== review.listSerial) return;
    const select = document.getElementById('review-source');
    select.innerHTML = '<option value="">通常版</option>' + data.pulls.map(p => `<option value="${p.number}">PR #${p.number}: ${esc(p.title)}${p.draft ? '（下書き）' : ''}</option>`).join('');
    if (review.number && !data.pulls.some(p => String(p.number) === review.number)) {
      select.innerHTML += `<option value="${review.number}">PR #${review.number}（確認が必要）</option>`;
    }
    select.value = review.number;
    if (!review.number) reviewMessage(data.pulls.length ? 'PRを選ぶと、マージ前の本文を読めます。' : '校閲できる未完了のPRはありません。');
    if (reload && review.number) await loadIndex();
  } catch (error) {
    if (serial === review.listSerial) reviewMessage(`PR一覧の取得に失敗: ${error.message}`);
  }
}
async function loadReviewIndex(loadStatic) {
  const serial = ++review.serial;
  ++openSerial;
  review.pull = null;
  cur = null; draft = null; episodes = [];
  hidePop();
  $('text').innerHTML = ''; $('annlist').innerHTML = ''; $('eplist').innerHTML = '';
  $('overall').value = ''; $('overall').disabled = true; $('submit').disabled = true;
  $('title').textContent = '校閲リーダー'; $('meta').textContent = '';
  $('empty').style.display = ''; $('anncount').textContent = ''; $('anncount2').textContent = '';
  $('empty').textContent = '左の索引から話を選んでください。文章を選択すると修正指示を付けられます。';
  $('review-changes').hidden = true; $('review-changes').innerHTML = '';
  try {
    const data = review.number ? await reviewApi({ pr: review.number }) : { episodes: await loadStatic() };
    if (serial !== review.serial) return;
    review.pull = data.pull || null;
    episodes = review.pull ? data.episodes.filter(e => e.changed) : data.episodes;
    renderToc();
    const h = location.hash.match(/^#(\d+(?:\.\d+)?)$/);
    const requested = h && episodes.find(e => String(e.number) === h[1]);
    const first = requested || (review.pull && episodes[0]);
    if (review.pull) reviewMessage(`PR #${review.pull.number}・${review.pull.branch}・${review.pull.commit.slice(0, 7)} / 変更した話: ${episodes.filter(e => e.changed).length}件`);
    else reviewMessage('通常版を表示しています。');
    if (first) await openEpisode(first.number);
    else {
      const message = review.pull ? 'このPRで追加・変更された本文はありません。' : '';
      if (message) $('empty').textContent = message;
      status(message);
    }
  } catch (error) {
    if (serial === review.serial) {
      reviewMessage(`読み込みに失敗: ${error.message}`);
      status(`索引の読み込みに失敗: ${error.message}`, true);
    }
  }
}
async function initializeReview() {
  const select = $('review-source');
  $('review-changes').addEventListener('click', event => {
    const button = event.target.closest('button[data-change]');
    const changes = cur?.diff?.changes;
    if (!button || !changes?.length) return;
    review.changeIndex = button.dataset.change === 'next' ? (review.changeIndex + 1) % changes.length : Number(button.dataset.change);
    const change = changes[review.changeIndex];
    if (!change) return;
    const at = Math.min(change.at, cur.paras.length - 1);
    document.querySelector(`#text p[data-i="${at}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const next = document.querySelector('#review-changes [data-change="next"]');
    if (next) next.textContent = `次の変更へ（${review.changeIndex + 1}/${changes.length}）`;
  });
  $('review-export').addEventListener('click', () => {
    if (cur) saveDraft();
    const text = reviewSavedDrafts();
    if (!text) { reviewMessage('保存されたPRの下書きはありません。'); return; }
    download('pr-review-drafts.md', text);
    reviewMessage('更新前の版を含むPRの下書きをMarkdownで保存しました。');
  });
  select.addEventListener('change', async () => {
    if (cur) saveDraft();
    review.number = select.value;
    const url = new URL(location.href);
    if (review.number) url.searchParams.set('pr', review.number); else url.searchParams.delete('pr');
    history.replaceState(null, '', url);
    await loadIndex();
  });
  $('review-refresh').addEventListener('click', async () => {
    if (cur) saveDraft();
    await refreshReviews();
  });
  const number = new URLSearchParams(location.search).get('pr');
  if (number && !/^[1-9]\d{0,8}$/.test(number)) {
    reviewMessage('PR番号が正しくありません。通常版を表示します。');
  } else if (number) review.number = number;
  if (isLocal()) {
    select.disabled = true; $('review-refresh').disabled = true;
    if (review.number) {
      reviewMessage('PRの本文はCloudflareの校閲URLから開いてください。ローカルでは通常版のみ利用できます。');
      return;
    }
    await loadIndex();
    reviewMessage('ローカルでは通常版のみ利用できます。');
    return;
  }
  await Promise.all([refreshReviews(false), loadIndex()]);
}

// Split at both sets of boundaries: highlights never alter the manuscript or its quotes.
function reviewMarkup(text, index, annotations = []) {
  const additions = cur?.diff?.paragraphs[index]?.ranges || [];
  const points = [...new Set([0, text.length, ...annotations.flatMap(r => [r.s, r.e]), ...additions.flat()])].sort((a, b) => a - b);
  let html = '';
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i], end = points[i + 1];
    let part = esc(text.slice(start, end));
    if (additions.some(([s, e]) => s <= start && end <= e)) part = `<ins class="pr-added">${part}</ins>`;
    const annotation = annotations.find(r => r.s <= start && end <= r.e);
    if (annotation) part = `<mark class="c-${annotation.t}">${part}</mark>`;
    html += part;
  }
  return html;
}
function reviewParagraphLabel(index) {
  const kind = cur?.diff?.paragraphs[index]?.kind;
  return kind === 'added' ? '追加' : kind === 'changed' ? '変更' : '';
}
function renderReviewChanges() {
  const panel = $('review-changes'), diff = cur?.diff;
  review.changeIndex = -1;
  panel.hidden = !cur?.pr;
  panel.innerHTML = '';
  if (!cur?.pr) return;
  if (!diff) { panel.textContent = '変更箇所を表示するには、ページを再読み込みしてください。'; return; }
  if (!diff.changes.length) { panel.textContent = '本文の表示上の差分はありません。'; return; }
  const old = diff.changes.map((change, index) => {
    if (!change.before) return '';
    let html = '', pos = 0;
    for (const [start, end] of change.ranges) {
      html += esc(change.before.slice(pos, start)) + `<del>${esc(change.before.slice(start, end))}</del>`;
      pos = end;
    }
    html += esc(change.before.slice(pos));
    return `<section class="pr-before"><div class="pr-before-heading">${change.kind === 'deleted' ? '削除した文章' : '変更前の文章'} <button class="btn" data-change="${index}">本文の位置へ</button></div><div class="pr-old-text">${html}</div></section>`;
  }).join('');
  panel.innerHTML = `<div class="pr-change-toolbar"><strong>変更箇所 ${diff.changes.length}件</strong><button class="btn" data-change="next">次の変更へ</button></div>
    <div class="pr-legend"><ins class="pr-added">青色・下線</ins>は追加・書き換えた部分です。</div>
    ${diff.coarse ? '<div class="pr-legend">大きな変更は段落全体を強調しています。</div>' : ''}
    ${old ? `<details><summary>変更前・削除した文章を見る</summary><div class="pr-legend">赤色・取り消し線は削除した部分です。</div>${old}</details>` : ''}`;
}

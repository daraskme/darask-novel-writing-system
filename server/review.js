import { authorizeReader } from './access.js';
import { manuscriptDiff } from './manuscript-diff.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const regular = entry => entry?.type === 'blob' && ['100644', '100755'].includes(entry.mode);
const manuscript = path => typeof path === 'string' && /^main\/(?:[^/\\\x00-\x1f]+\/)*[^/\\\x00-\x1f]+\.(txt|md)$/.test(path) && !path.split('/').some(p => p === '.' || p === '..');

// Only the configured repository is read. No branch code is executed or deployed.
export function createReviewHandler({ repo, indexPath = 'plot/episodes.json', format = 'standard' }, { fetcher = fetch, keys } = {}) {
  return async ({ request, env }) => {
    if (request.method !== 'GET') return json({ error: 'この操作は利用できません。' }, 405);
    const denied = await authorizeReader(request, env, keys);
    if (denied) return denied;
    try {
      async function github(path) {
        const response = await fetcher(`https://api.github.com/repos/${repo}/${path}`, {
          headers: { Authorization: `Bearer ${env.FEEDBACK_GITHUB_TOKEN.trim()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'novel-reader' },
          // Workers supports manual/follow only; reject 3xx below without forwarding credentials.
          redirect: 'manual', signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) fail(502, 'PRを取得できません。管理者がFEEDBACK_GITHUB_TOKENの対象作品・Contents権限・Pull requests: Read権限と有効期限を確認してください。');
        return response.json();
      }
      async function pages(path, max = 30) {
        const rows = [];
        for (let page = 1; page <= max; page++) {
          const batch = await github(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
          if (!Array.isArray(batch)) fail(502, 'GitHubの応答を確認できません。');
          rows.push(...batch);
          if (batch.length < 100) return rows;
        }
        fail(422, '対象が多すぎます。PRを小さく分けてください。');
      }
      const summarize = pr => ({ number: pr.number, title: pr.title, branch: pr.head.ref, commit: pr.head.sha, url: `https://github.com/${repo}/pull/${pr.number}`, draft: pr.draft });
      const own = pr => pr.head?.repo?.full_name?.toLowerCase() === repo.toLowerCase();
      const query = new URL(request.url).searchParams;
      if ([...query.keys()].some(k => !['pr', 'commit', 'path'].includes(k))) fail(400, '校閲対象の指定が正しくありません。');
      const number = query.get('pr');
      if (!number) {
        if (query.size) fail(400, 'PR番号を指定してください。');
        const pulls = await pages('pulls?state=open&sort=updated&direction=desc', 10);
        return json({ repo, pulls: pulls.filter(own).map(summarize) });
      }
      if (!/^[1-9]\d{0,8}$/.test(number)) fail(400, 'PR番号が正しくありません。');
      const pr = await github(`pulls/${number}`);
      if (pr.state !== 'open') fail(409, 'このPRは終了しています。通常版に切り替えてください。');
      if (!own(pr)) fail(422, 'この作品内のブランチから作成したPRを選んでください。');
      if (!/^[a-f0-9]{40}$/.test(pr.head.sha)) fail(502, 'PRの版を確認できません。');
      const commit = query.get('commit');
      const path = query.get('path');
      if (path && (!manuscript(path) || !commit)) fail(400, '本文パスと閲覧した版を指定してください。');
      if (commit && commit !== pr.head.sha) fail(409, 'PRが更新されました。「PR一覧を更新」から最新の版を開いてください。以前の下書きは残っています。');
      const tree = await github(`git/trees/${pr.head.sha}?recursive=1`);
      if (tree.truncated || !Array.isArray(tree.tree)) fail(422, '作品のファイル一覧を完全に取得できません。');
      const entries = new Map(tree.tree.map(entry => [entry.path, entry]));
      async function read(file, source = entries) {
        const entry = source.get(file);
        if (!regular(entry) || entry.size > 1024 * 1024) fail(422, '校閲対象は1MB以下の通常の原稿・索引ファイルにしてください。');
        const blob = await github(`git/blobs/${entry.sha}`);
        if (blob.encoding !== 'base64' || typeof blob.content !== 'string' || blob.content.length > 1500000) fail(422, 'ファイルを読み取れません。');
        const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), c => c.charCodeAt(0));
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), sha: entry.sha, bytes };
      }
      const index = JSON.parse((await read(indexPath)).text);
      const rows = format === 'kiriya' ? index.episodes?.map(e => ({ number: e.label?.replace(/^第|話$/g, ''), title: e.title?.replace(/^第[\d.]+話[\s　]*/, ''), kind: e.kakuyomuSlot ? `${e.kakuyomuSlot}話目` : '', manuscript: e.file })) : index;
      if (!Array.isArray(rows)) fail(422, 'PRの話別索引を確認してください。');
      const episodes = rows.filter(e => e && /^\d{1,3}(?:\.\d{1,2})?$/.test(String(e.number)) && Number(e.number) > 0 && typeof e.title === 'string' && manuscript(e.manuscript) && regular(entries.get(e.manuscript)))
        .map(e => ({ number: e.number, title: e.title, kind: typeof e.kind === 'string' ? e.kind : '', manuscript: e.manuscript }));
      if (path) {
        if (!episodes.some(e => e.manuscript === path)) fail(404, '索引に登録された本文を選んでください。');
        const files = await pages(`pulls/${number}/files`);
        const changed = files.find(f => f.filename === path && f.status !== 'removed');
        if (!changed) fail(404, 'このPRで変更された本文を選んでください。');
        const file = await read(path);
        if (!/^[a-f0-9]{40}$/.test(pr.base?.sha)) fail(502, 'PRの比較元を確認できません。');
        const comparison = await github(`compare/${pr.base.sha}...${pr.head.sha}?per_page=1`);
        const baseCommit = comparison.merge_base_commit?.sha;
        if (!/^[a-f0-9]{40}$/.test(baseCommit)) fail(502, 'PRの比較元を確認できません。');
        const baseTree = await github(`git/trees/${baseCommit}?recursive=1`);
        if (baseTree.truncated || !Array.isArray(baseTree.tree)) fail(422, '比較元のファイル一覧を完全に取得できません。');
        const baseEntries = new Map(baseTree.tree.map(entry => [entry.path, entry]));
        const basePath = changed.status === 'renamed' ? changed.previous_filename : path;
        if (!manuscript(basePath)) fail(422, '本文フォルダ内の原稿との比較だけ利用できます。');
        if (!baseEntries.has(basePath) && changed.status !== 'added') fail(422, '比較元の本文が見つかりません。PR一覧を更新してください。');
        const before = baseEntries.has(basePath) ? (await read(basePath, baseEntries)).text : null;
        const latest = await github(`pulls/${number}`);
        if (latest.head.sha !== pr.head.sha || latest.base?.sha !== pr.base.sha || latest.state !== 'open') fail(409, '比較中にPRが更新されました。PR一覧を更新してください。');
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', file.bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
        return json({ repo, text: file.text, sha: file.sha, hash, commit: pr.head.sha, diff: { ...manuscriptDiff(before, file.text), baseCommit, basePath } });
      }
      const files = await pages(`pulls/${number}/files`);
      // Files API is live: reject an index assembled across two PR revisions.
      const latest = await github(`pulls/${number}`);
      if (latest.head.sha !== pr.head.sha || latest.state !== 'open') fail(409, '取得中にPRが更新されました。PR一覧を更新してください。');
      const changed = new Set(files.filter(f => f.status !== 'removed').map(f => f.filename));
      return json({ repo, pull: summarize(pr), episodes: episodes.filter(e => changed.has(e.manuscript)).map(e => ({ ...e, changed: true })) });
    } catch (error) {
      return json({ error: error.status ? error.message : 'PRを読み込めませんでした。索引の形式と接続を確認して再度お試しください。' }, error.status || 502);
    }
  };
}

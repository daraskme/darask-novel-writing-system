import { authorizeReader } from './access.js';

const MAX_BYTES = 256 * 1024;
function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

// Dependencies are replaceable only by server-side tests, never by request data.
export function createFeedbackHandler({ repo, branch = 'main' }, { fetcher = fetch, keys } = {}) {
  return async ({ request, env }) => {
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'この操作は利用できません。' }, 405);
    if (request.method === 'POST' && request.headers.get('Origin') !== new URL(request.url).origin) {
      return json({ error: 'リーダーの画面から送信してください。' }, 403);
    }

    const denied = await authorizeReader(request, env, keys);
    if (denied) return denied;
    if (request.method === 'GET') return json({ configured: true, repo, branch });
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
      return json({ error: 'JSON形式で送信してください。' }, 415);
    }

    let body;
    try {
      // Bound the stream as well as Content-Length (which may be absent or untrusted).
      const reader = request.body?.getReader();
      if (!reader) return json({ error: '送信内容が空です。' }, 400);
      const decoder = new TextDecoder();
      let size = 0, text = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          return json({ error: '指示が長すぎます。分けて送信してください。' }, 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      body = JSON.parse(text + decoder.decode());
    } catch {
      return json({ error: '送信内容を読み取れませんでした。' }, 400);
    }
    if (!body || typeof body.episode !== 'string' || !/^\d{1,3}(?:\.\d{1,2})?$/.test(body.episode) ||
        Number(body.episode) <= 0 || typeof body.markdown !== 'string' || !body.markdown.trim() ||
        Object.keys(body).some(key => !['episode', 'markdown'].includes(key))) {
      return json({ error: '話番号または修正指示が正しくありません。' }, 400);
    }

    const [whole, fraction] = body.episode.split('.');
    const episode = whole.padStart(3, '0') + (fraction ? `.${fraction}` : '');
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d+Z$/, '');
    const path = `feedback/${episode}-${timestamp}-${crypto.randomUUID()}.md`;
    const bytes = new TextEncoder().encode(body.markdown);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    try {
      const response = await fetcher(`https://api.github.com/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${env.FEEDBACK_GITHUB_TOKEN.trim()}`,
          Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'novel-reader',
        },
        body: JSON.stringify({ message: `feedback: 第${body.episode}話への修正指示`, content: btoa(binary), branch }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          return json({ error: 'GitHubへの保存が拒否されました。管理者がCloudflareのFEEDBACK_GITHUB_TOKENを更新し、対象リポジトリとContents: Read and write権限を確認してください。下書きは残っています。' }, 502);
        }
        return json({ error: 'GitHubへの保存に失敗しました。下書きは残っています。時間をおいて再度送信してください。' }, 502);
      }
      return json({ path, url: `https://github.com/${repo}/blob/${encodeURIComponent(branch)}/${path}` }, 201);
    } catch {
      return json({ error: 'GitHubへの通信を完了できませんでした。下書きは残っています。feedback/に保存済みか確認してから再送してください。' }, 502);
    }
  };
}

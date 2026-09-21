import { createRemoteJWKSet, jwtVerify } from 'jose';

let cachedIssuer, cachedKeys;
function remoteKeys(issuer) {
  if (issuer !== cachedIssuer) {
  cachedKeys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  cachedIssuer = issuer;
  }
  return cachedKeys;
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function authorizeReader(request, env, keys = remoteKeys) {
  const domain = (env.ACCESS_TEAM_DOMAIN || '').trim().replace(/^https:\/\//, '').replace(/\/$/, '');
  const aud = (env.ACCESS_AUD || '').trim();
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !aud) {
    return json({ error: 'サイトの認証設定が未完了です。管理者がCloudflareのACCESS_TEAM_DOMAIN・ACCESS_AUDを登録してください。' }, 503);
  }
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion) return json({ error: 'Googleログインを確認できません。ページを再読み込みしてログインし直してください。' }, 401);
  try {
    await jwtVerify(assertion, keys(`https://${domain}`), {
      issuer: `https://${domain}`, audience: aud, algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub', 'email'],
    });
  } catch {
    return json({ error: 'ログインの有効期限またはサイトの認証設定を確認できません。再ログインしても直らない場合は管理者に連絡してください。' }, 401);
  }
  if (!env.FEEDBACK_GITHUB_TOKEN?.trim()) {
    return json({ error: '送信用トークンが未登録です。管理者がCloudflareのFEEDBACK_GITHUB_TOKENを登録してください。' }, 503);
  }
  return null;
}

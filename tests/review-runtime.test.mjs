import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

test('compiled Pages API reads PRs in workerd and never follows GitHub redirects', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  await mkdir(join(root, '.wrangler'), { recursive: true });
  const dir = await mkdtemp(join(root, '.wrangler', 'review-runtime-'));
  let mf;
  try {
    const worker = join(dir, 'index.js');
    execFileSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'functions', 'build', '--outdir', dir], {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(dir, 'logs') },
      stdio: 'pipe',
    });
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(publicKey), kid: 'runtime-test' };
    const jwt = await new SignJWT({ email: 'reader@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('reader')
      .setIssuer('https://test.cloudflareaccess.com').setAudience('runtime-test')
      .setExpirationTime('5m').sign(privateKey);
    const calls = [];
    let redirect = false;
    mf = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      script: await readFile(worker, 'utf8'),
      compatibilityDate: '2026-09-20',
      bindings: {
        ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'runtime-test',
        FEEDBACK_GITHUB_TOKEN: 'runtime-test-token', FEEDBACK_REPOSITORY: 'owner/novel',
      },
      outboundService: request => {
        const url = new URL(request.url);
        calls.push(url);
        if (url.origin === 'https://test.cloudflareaccess.com' && url.pathname === '/cdn-cgi/access/certs') {
          return Response.json({ keys: [jwk] });
        }
        assert.equal(url.origin, 'https://api.github.com', 'credentials must never reach a redirect destination');
        assert.match(url.pathname, /^\/repos\/[^/]+\/[^/]+\/pulls$/);
        assert.equal(request.headers.get('Authorization'), 'Bearer runtime-test-token');
        if (redirect) return Response.redirect('https://unexpected.invalid/credentials', 302);
        const repo = url.pathname.split('/').slice(2, 4).join('/');
        return Response.json([{ number: 7, title: 'Runtime fixture', draft: true,
          head: { repo: { full_name: repo }, ref: 'revision', sha: 'a'.repeat(40) } }]);
      },
    }));
    const url = 'https://reader.example/api/review';
    assert.equal((await mf.dispatchFetch(url)).status, 401);
    assert.equal(calls.length, 0);
    const init = { headers: { 'Cf-Access-Jwt-Assertion': jwt } };
    const response = await mf.dispatchFetch(url, init);
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.deepEqual(data.pulls.map(p => [p.number, p.draft, p.branch]), [[7, true, 'revision']]);
    assert.equal(JSON.stringify(data).includes('runtime-test-token'), false);
    redirect = true;
    const denied = await mf.dispatchFetch(url, init);
    assert.equal(denied.status, 502);
    assert.match((await denied.json()).error, /PRを取得できません/);
    assert.equal(calls.filter(u => u.origin === 'https://api.github.com').length, 2);
  } finally {
    await mf?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

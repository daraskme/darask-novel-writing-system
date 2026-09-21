import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createFeedbackHandler } from '../server/feedback.js';

const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey);
jwk.kid = 'test-key';
const localKeys = createLocalJWKSet({ keys: [jwk] });
const env = { ACCESS_TEAM_DOMAIN: 'reader-test.cloudflareaccess.com', ACCESS_AUD: 'reader-audience', FEEDBACK_GITHUB_TOKEN: 'server-only-test-token' };
const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
async function token(overrides = {}) {
  return new SignJWT({ email: 'reader@example.com', sub: 'reader-id', iss: issuer, aud: env.ACCESS_AUD, exp: Math.floor(Date.now() / 1000) + 300, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
}
const validToken = await token();
const url = 'https://reader.example/api/feedback';
const origin = new URL(url).origin;
function request({ method = 'POST', jwt = validToken, headers = {}, body = { episode: '15.5', markdown: '# 修正指示\n\n会話を増やす。🐈' } } = {}) {
  return new Request(url, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}), ...headers }, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
function setup(response = () => new Response('{}', { status: 201 })) {
  const calls = [];
  const handler = createFeedbackHandler({ repo: 'owner/fixed-repo' }, {
    keys: value => { assert.equal(value, issuer); return localKeys; },
    fetcher: async (...args) => { calls.push(args); return response(); },
  });
  return { calls, run: (req = request(), bindings = env) => handler({ request: req, env: bindings }) };
}

test('authenticated submission commits Japanese text to a server-chosen feedback path', async () => {
  const { run, calls } = setup();
  const result = await run();
  assert.equal(result.status, 201);
  const data = await result.json();
  assert.match(data.path, /^feedback\/015\.5-\d{8}-\d{6}-[\da-f-]{36}\.md$/);
  assert.equal(calls[0][0], `https://api.github.com/repos/owner/fixed-repo/contents/${data.path}`);
  assert.equal(calls[0][1].headers.Authorization, `Bearer ${env.FEEDBACK_GITHUB_TOKEN}`);
  const saved = JSON.parse(calls[0][1].body);
  assert.equal(saved.branch, 'main');
  assert.equal(saved.sha, undefined); // creation only; never overwrite an existing file
  assert.equal(Buffer.from(saved.content, 'base64').toString(), '# 修正指示\n\n会話を増やす。🐈');
  assert.equal(JSON.stringify(data).includes(env.FEEDBACK_GITHUB_TOKEN), false);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.notEqual((await (await run()).json()).path, data.path);
});

for (const [name, overrides] of Object.entries({ expired: { exp: 1 }, wrongAudience: { aud: 'other-app' }, wrongIssuer: { iss: 'https://other.cloudflareaccess.com' }, missingExpiry: { exp: undefined }, missingEmail: { email: undefined } })) {
  test(`rejects ${name} Google Access assertion before contacting GitHub`, async () => {
    const { run, calls } = setup();
    assert.equal((await run(request({ jwt: await token(overrides) }))).status, 401);
    assert.equal(calls.length, 0);
  });
}
test('rejects missing and forged assertions, including a spoofed email header', async () => {
  const { run, calls } = setup();
  for (const jwt of ['', 'forged.jwt.value']) {
    assert.equal((await run(request({ jwt, headers: { 'Cf-Access-Authenticated-User-Email': 'reader@example.com' } }))).status, 401);
  }
  const { privateKey: wrongKey } = await generateKeyPair('RS256');
  const forged = await new SignJWT({ iss: issuer, aud: env.ACCESS_AUD, exp: Math.floor(Date.now() / 1000) + 60, sub: 'reader-id', email: 'reader@example.com' }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(wrongKey);
  assert.equal((await run(request({ jwt: forged }))).status, 401);
  assert.equal(calls.length, 0);
});
test('fails closed for missing site secrets or malformed issuer configuration', async () => {
  const { run, calls } = setup();
  for (const key of Object.keys(env)) assert.equal((await run(request(), { ...env, [key]: '' })).status, 503);
  assert.equal((await run(request(), { ...env, ACCESS_TEAM_DOMAIN: 'evil.example/path' })).status, 503);
  assert.equal(calls.length, 0);
});
test('connection status exposes no token and does not write to GitHub', async () => {
  const { run, calls } = setup();
  assert.deepEqual(await (await run(request({ method: 'GET' }))).json(), { configured: true, repo: 'owner/fixed-repo', branch: 'main' });
  assert.equal((await run(request({ method: 'GET', jwt: '' }))).status, 401);
  assert.equal(calls.length, 0);
});
test('rejects cross-origin requests and unexpected media types or methods', async () => {
  const { run, calls } = setup();
  for (const badOrigin of ['https://other.example', 'null', '']) assert.equal((await run(request({ headers: { Origin: badOrigin } }))).status, 403);
  assert.equal((await run(request({ headers: { 'Content-Type': 'text/plain' } }))).status, 415);
  assert.equal((await run(request({ method: 'DELETE' }))).status, 405);
  assert.equal(calls.length, 0);
});
test('rejects arbitrary paths, repository overrides, malformed JSON and empty content', async () => {
  const { run, calls } = setup();
  for (const body of ['{bad', null, {}, { episode: '../main/001', markdown: 'x' }, { episode: '0', markdown: 'x' }, { episode: '1', markdown: '' }, { episode: '1', markdown: 'x', repo: 'other/repo' }, { episode: '1', markdown: 'x', path: 'main/001.txt' }]) {
    assert.equal((await run(request({ body }))).status, 400);
  }
  assert.equal(calls.length, 0);
});
test('limits actual body bytes even without Content-Length', async () => {
  const { run, calls } = setup();
  assert.equal((await run(request({ body: { episode: '1', markdown: '字'.repeat(100000) } }))).status, 413);
  assert.equal(calls.length, 0);
});
for (const code of [401, 403, 404, 429, 500]) {
  test(`GitHub ${code} gives a recoverable error without forwarding secrets`, async () => {
    const { run } = setup(() => new Response(env.FEEDBACK_GITHUB_TOKEN, { status: code }));
    const response = await run();
    assert.equal(response.status, 502);
    const error = (await response.json()).error;
    assert.match(error, /下書きは残っています/);
    assert.equal(error.includes(env.FEEDBACK_GITHUB_TOKEN), false);
    if ([401, 403, 404].includes(code)) assert.match(error, /FEEDBACK_GITHUB_TOKENを更新/);
  });
}
test('network errors leave a clear recovery path', async () => {
  const { run } = setup(() => { throw new Error('network unavailable'); });
  assert.match((await (await run()).json()).error, /保存済みか確認/);
});

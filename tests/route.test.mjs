import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/feedback.js';
import { onRequest as review } from '../functions/api/review.js';

test('route fails closed when administrator repository binding is missing or malformed', async () => {
  for (const repo of ['', '../other', 'owner/repo?redirect=other']) {
    const result = await onRequest({request:new Request('https://reader.example/api/feedback'),env:{FEEDBACK_REPOSITORY:repo}});
    assert.equal(result.status,503);
  }
});
test('valid server repository configuration still requires an Access assertion', async () => {
  const result = await onRequest({request:new Request('https://reader.example/api/feedback'),env:{FEEDBACK_REPOSITORY:'owner/novel',ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test'}});
  assert.equal(result.status,401);
});

test('PR route requires server repository configuration and Access authentication', async () => {
  assert.equal((await review({ request: new Request('https://reader.example/api/review'), env: {} })).status, 503);
  assert.equal((await review({ request: new Request('https://reader.example/api/review?pr=7'), env: { FEEDBACK_REPOSITORY: 'owner/novel', ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'test' } })).status, 401);
});

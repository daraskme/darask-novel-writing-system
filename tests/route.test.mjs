import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/feedback.js';

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

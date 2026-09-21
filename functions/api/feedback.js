import { createFeedbackHandler } from '../../server/feedback.js';

export const onRequest = (context) => {
  const repo = (context.env.FEEDBACK_REPOSITORY || '').trim();
  const branch = (context.env.FEEDBACK_BRANCH || 'main').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !branch) {
    return Response.json({ error: '管理者がFEEDBACK_REPOSITORYと送信先ブランチを設定してください。' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return createFeedbackHandler({ repo, branch })(context);
};

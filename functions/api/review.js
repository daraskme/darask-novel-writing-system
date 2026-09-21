import { createReviewHandler } from '../../server/review.js';

export const onRequest = context => {
  const repo = (context.env.FEEDBACK_REPOSITORY || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return Response.json({ error: '管理者がFEEDBACK_REPOSITORYを設定してください。' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return createReviewHandler({ repo })(context);
};

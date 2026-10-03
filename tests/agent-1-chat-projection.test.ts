import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAgent1ChatStreamEvent,
  createAcceptedAgent1ChatTurn,
  resetAgent1ChatTurnAttempt,
} from '../mobile/src/ai/agent-1-chat-state';
import { projectAgent1ChatTurns } from '../mobile/src/ai/chat-list-projection';

test('Agent 1 turn projects to stable, separate user and assistant rows', () => {
  const turn = createAcceptedAgent1ChatTurn('turn-1', 'مرحبا');
  const firstProjection = projectAgent1ChatTurns([turn]);

  assert.deepEqual(firstProjection.map((row) => row.kind), ['user', 'assistant']);
  assert.equal(firstProjection[0].id, 'user:turn-1');
  assert.equal(firstProjection[1].id, 'assistant:turn-1:0');

  const afterFirstDelta = applyAgent1ChatStreamEvent([turn], turn.id, {
    type: 'text_delta',
    text: 'أهلًا',
  });
  const nextProjection = projectAgent1ChatTurns(afterFirstDelta);

  assert.equal(nextProjection[0].id, firstProjection[0].id);
  assert.strictEqual(nextProjection[0].message, firstProjection[0].message);
  assert.equal(nextProjection[1].id, firstProjection[1].id);
  assert.equal(nextProjection[1].message?.content, 'أهلًا');
});

test('regeneration changes only the assistant render-row identity', () => {
  const turn = createAcceptedAgent1ChatTurn('turn-2', 'اشرح لي');
  const nextAttempt = resetAgent1ChatTurnAttempt(
    applyAgent1ChatStreamEvent([turn], turn.id, { type: 'text_delta', text: 'رد' }),
    turn.id,
  );
  const projection = projectAgent1ChatTurns(nextAttempt);

  assert.equal(projection[0].id, 'user:turn-2');
  assert.equal(projection[1].id, 'assistant:turn-2:1');
  assert.equal(projection[1].message, null);
});

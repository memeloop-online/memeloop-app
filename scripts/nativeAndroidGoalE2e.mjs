import assert from 'node:assert/strict';

export function parseGoalFixture(input) {
  assert.ok(input && typeof input === 'object' && !Array.isArray(input), 'Goal fixture must be an object');
  assert.ok(typeof input.objective === 'string' && input.objective.trim(), 'Goal fixture objective is required');
  assert.ok(['active', 'paused', 'blocked', 'completed'].includes(input.status), 'Goal fixture status must be active, paused, blocked or completed');
  assert.ok(Number.isSafeInteger(input.round) && input.round >= 0, 'Goal fixture round must be a non-negative integer');
  if (input.status === 'completed') assert.ok(typeof input.evidence === 'string' && input.evidence.trim(), 'Completed fixture requires evidence');
  if (input.status === 'blocked') assert.ok(typeof input.blockedReason === 'string' && input.blockedReason.trim(), 'Blocked fixture requires blockedReason');
  return {
    objective: input.objective,
    status: input.status,
    round: input.round,
    ...(input.status === 'completed' ? { evidence: input.evidence } : {}),
    ...(input.status === 'blocked' ? { blockedReason: input.blockedReason } : {}),
  };
}

/** Checks only the supplied synthetic goal; no goal mutation or model turn is sent. */
export async function runNativeGoalChecks({ fixture, labels, chatActions, conversationTitle, step, tap, expect, seek, capture, back, expectChat }) {
  const fields = [
    ['status', labels.status[fixture.status]],
    ['round', labels.round(fixture.round)],
    ['objective', fixture.objective],
    ...(fixture.evidence ? [['evidence', fixture.evidence]] : []),
    ...(fixture.blockedReason ? [['blocked-reason', fixture.blockedReason]] : []),
  ];
  const open = async () => {
    await tap(chatActions);
    await tap(labels.title);
    await expect(labels.back);
    await expect(labels.description);
  };
  await step('goal-01-content', async () => {
    await open();
    for (const [name, text] of fields) {
      await seek(text);
      await expect(text);
      capture(`goal-${name}`);
    }
  });
  await step('goal-02-header-return', async () => {
    await tap(labels.back);
    await expectChat(conversationTitle);
  });
  await step('goal-03-system-return', async () => {
    await open();
    await expect(labels.status[fixture.status]);
    back();
    await expectChat(conversationTitle);
  });
}

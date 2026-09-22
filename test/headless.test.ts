import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamParser, type AssistantTurn } from '../src/cc/headless.js';

// A minimal stream-json session: init → assistant (thinking, text, tool_use blocks of one message) →
// user (tool result) → assistant (text) → result. Shapes mirror what `claude -p --output-format stream-json` emits.
const usage1 = {
  input_tokens: 10,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 5,
  output_tokens: 3,
};
const lines = [
  { type: 'system', subtype: 'init', model: 'claude-haiku-4-5-20251001' },
  { type: 'assistant', message: { id: 'm1', usage: usage1, content: [{ type: 'thinking' }] } },
  {
    type: 'assistant',
    message: { id: 'm1', usage: usage1, content: [{ type: 'text', text: 'Looking. ' }] },
  },
  {
    type: 'assistant',
    message: {
      id: 'm1',
      usage: { ...usage1, output_tokens: 40 },
      content: [{ type: 'tool_use', name: 'mcp__ts__request_tools', input: { need: 'x' } }],
    },
  },
  {
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1 } },
    },
  },
  { type: 'user', message: { content: [{ type: 'tool_result' }] } },
  {
    type: 'assistant',
    message: {
      id: 'm2',
      usage: { input_tokens: 8, output_tokens: 9 },
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Done' }],
    },
  },
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 3,
    total_cost_usd: 0.01,
    result: 'Done',
    usage: { input_tokens: 18, cache_read_input_tokens: 100, output_tokens: 49 },
    modelUsage: { 'claude-haiku-4-5-20251001': { canonicalModel: 'claude-haiku-4-5' } },
  },
].map((e) => JSON.stringify(e));

test('StreamParser reassembles turns by message id and reads the result', () => {
  const started: AssistantTurn[] = [];
  const ended: AssistantTurn[] = [];
  let clock = 1000;
  const p = new StreamParser(
    { onTurnStart: (t) => started.push(t), onTurnEnd: (t) => ended.push({ ...t }) },
    () => (clock += 500),
  );
  for (const l of lines) p.feed(l);
  p.feed('not json');
  const r = p.end();

  assert.equal(started.length, 2);
  assert.equal(ended.length, 2);
  assert.equal(ended[0]!.text, 'Looking.');
  assert.deepEqual(ended[0]!.toolUses, [{ name: 'mcp__ts__request_tools', input: { need: 'x' } }]);
  assert.equal(ended[0]!.inputTokens, 115); // input + cache read + cache creation
  assert.equal(ended[0]!.outputTokens, 40); // max across the message's block events
  assert.equal(ended[1]!.stopReason, 'end_turn');
  assert.equal(r.model, 'claude-haiku-4-5'); // canonical model from the result wins over the init alias
  assert.equal(r.subtype, 'success');
  assert.equal(r.usage.inputTokens, 118);
  assert.equal(r.rateLimit?.fiveHour?.utilization, 0.4);
  assert.equal(r.costUsd, 0.01);
});

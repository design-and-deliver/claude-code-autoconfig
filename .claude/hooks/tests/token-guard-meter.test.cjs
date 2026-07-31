// Characterization test for token-guard meter() function (substep 3.7a, 2026-07-31)
// Run: node --test .claude/hooks/tests/token-guard-meter.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { meter, priceFor } = require(HOOK);

function tmpDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

test('meter returns defaults for missing or invalid transcript path', () => {
  const res = meter('/non/existent/path/transcript.jsonl');
  assert.strictEqual(res.usd, 0);
  assert.strictEqual(res.turns, 0);
  assert.strictEqual(res.liveContext, 0);
  assert.strictEqual(res.firstContext, 0);
  assert.strictEqual(res.turnFloorUSD, 0);
  assert.strictEqual(res.maxInp, 0);
  assert.strictEqual(res.lastTs, 0);
  assert.strictEqual(res.rawLength, 0);
  assert.deepStrictEqual(res.perModel, {});
  assert.deepStrictEqual(res.tsList, []);
});

test('meter correctly parses assistant messages, calculates costs, cache splits, and deduplicates by message id', () => {
  const dir = tmpDir('tg-meter-');
  const transcript = path.join(dir, 'transcript.jsonl');

  const ts1 = '2026-07-31T10:00:00.000Z';
  const ts2 = '2026-07-31T10:05:00.000Z';
  const ts3 = '2026-07-31T10:10:00.000Z';

  const lines = [
    // Non-assistant / non-message lines (ignored)
    JSON.stringify({ type: 'user', message: { content: 'hello' } }),
    'invalid json line',

    // Assistant message 1 (First context source) - Sonnet
    JSON.stringify({
      type: 'assistant',
      timestamp: ts1,
      message: {
        id: 'msg-1',
        model: 'claude-3-5-sonnet-20241022',
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 4000,
          cache_creation: {
            ephemeral_5m_input_tokens: 3000,
            ephemeral_1h_input_tokens: 1000
          },
          server_tool_use: { web_search_requests: 2 }
        }
      }
    }),

    // Assistant message 1 duplicate (last occurrence wins for msg-1) - Sonnet
    JSON.stringify({
      type: 'assistant',
      timestamp: ts2,
      message: {
        id: 'msg-1',
        model: 'claude-3-5-sonnet-20241022',
        usage: {
          input_tokens: 1200,
          output_tokens: 250,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 4000,
          cache_creation: {
            ephemeral_5m_input_tokens: 3000,
            ephemeral_1h_input_tokens: 1000
          },
          server_tool_use: { web_search_requests: 1 }
        }
      }
    }),

    // Assistant message 2 (Live context source) - Opus
    JSON.stringify({
      type: 'assistant',
      timestamp: ts3,
      message: {
        id: 'msg-2',
        model: 'claude-3-opus-20240229',
        usage: {
          input_tokens: 2000,
          output_tokens: 400,
          cache_read_input_tokens: 10000,
          cache_creation_input_tokens: 0
        }
      }
    })
  ];

  fs.writeFileSync(transcript, lines.join('\n'));

  const res = meter(transcript);

  assert.strictEqual(res.rawLength > 0, true);
  assert.strictEqual(res.turns, 2); // msg-1 (deduped) and msg-2
  assert.strictEqual(res.lastTs, Date.parse(ts3));
  assert.deepStrictEqual(res.tsList, [Date.parse(ts1), Date.parse(ts2), Date.parse(ts3)]);

  // First context: 1000 + 5000 + 4000 = 10000 (from msg-1 first line)
  assert.strictEqual(res.firstContext, 10000);

  // Live context: 2000 + 10000 + 0 = 12000 (from msg-2 last line)
  assert.strictEqual(res.liveContext, 12000);
  assert.strictEqual(res.lastCacheWrite, 0);
  assert.strictEqual(res.lastCacheRead, 10000);

  // Pricing verification:
  // Sonnet (inp=3, out=15):
  // msg-1 deduped usage: inp=1200, out=250, cr=5000, cw5m=3000, cw1h=1000, searches=1
  // USD = (1200*3 + 250*15 + 5000*3*0.1 + 3000*3*1.25 + 1000*3*2)/1e6 + 1*0.01
  //     = (3600 + 3750 + 1500 + 11250 + 6000)/1e6 + 0.01 = 26100/1e6 + 0.01 = 0.0261 + 0.01 = 0.0361 USD
  const sonnetModel = res.perModel['claude-3-5-sonnet-20241022'];
  assert.ok(sonnetModel);
  assert.strictEqual(sonnetModel.inp, 1200);
  assert.strictEqual(sonnetModel.out, 250);
  assert.strictEqual(sonnetModel.cr, 5000);
  assert.strictEqual(sonnetModel.cw, 4000);
  assert.strictEqual(sonnetModel.searches, 1);
  assert.strictEqual(Number(sonnetModel.usd.toFixed(6)), 0.0361);

  // Opus (inp=5, out=25):
  // msg-2 usage: inp=2000, out=400, cr=10000, cw=0, searches=0
  // USD = (2000*5 + 400*25 + 10000*5*0.1 + 0)/1e6 = (10000 + 10000 + 5000)/1e6 = 25000/1e6 = 0.025 USD
  const opusModel = res.perModel['claude-3-opus-20240229'];
  assert.ok(opusModel);
  assert.strictEqual(opusModel.inp, 2000);
  assert.strictEqual(opusModel.out, 400);
  assert.strictEqual(opusModel.cr, 10000);
  assert.strictEqual(opusModel.cw, 0);
  assert.strictEqual(Number(opusModel.usd.toFixed(6)), 0.025);

  // Total USD = 0.0361 + 0.025 = 0.0611 USD
  assert.strictEqual(Number(res.usd.toFixed(6)), 0.0611);

  // maxInp across models: Opus inp = 5
  assert.strictEqual(res.maxInp, 5);

  // turnFloorUSD = (liveContext * maxInp * CACHE_READ_X) / 1e6 = (12000 * 5 * 0.1) / 1e6 = 6000 / 1e6 = 0.006 USD
  assert.strictEqual(Number(res.turnFloorUSD.toFixed(6)), 0.006);
});

test('meter respects sinceMs filtering and skips firstContext when windowed', () => {
  const dir = tmpDir('tg-meter-since-');
  const transcript = path.join(dir, 'transcript.jsonl');

  const tsOld = '2026-07-31T08:00:00.000Z';
  const tsNew = '2026-07-31T12:00:00.000Z';
  const cutoff = Date.parse('2026-07-31T10:00:00.000Z');

  const lines = [
    JSON.stringify({
      type: 'assistant',
      timestamp: tsOld,
      message: { id: 'msg-old', model: 'claude-3-5-haiku-20241022', usage: { input_tokens: 500 } }
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: tsNew,
      message: { id: 'msg-new', model: 'claude-3-5-haiku-20241022', usage: { input_tokens: 1000 } }
    })
  ];

  fs.writeFileSync(transcript, lines.join('\n'));

  const res = meter(transcript, cutoff);
  assert.strictEqual(res.turns, 1);
  assert.strictEqual(res.firstContext, 0); // Windowed sinceMs -> firstContext stays 0
  assert.strictEqual(res.liveContext, 1000);
  assert.strictEqual(res.perModel['claude-3-5-haiku-20241022'].inp, 1000);
});

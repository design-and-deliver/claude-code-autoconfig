/**
 * Meter canary — the account-window guards' fail-OPEN alarm (2026-08-05).
 *
 * R12a/R12b ride one data source: the OAuth usage endpoint (pinned beta header). On any
 * failure the fetch returns stale-or-nothing and every window guard simply stops firing —
 * indistinguishable from a calm meter. The canary dates the outage off the cache's last
 * SUCCESS and says so once per outage. These pin the verdict's edges: it must fire only on
 * a genuinely dead meter (a failed fetch THIS prompt + a stale last success), never on an
 * idle project's old cache alone, never twice for one outage, and never on a machine with
 * no prior good reading to date an outage from.
 */
const { test, assert, summary } = require('./_harness');
const { meterCanaryVerdict, meterCanaryNote } = require('../.claude/hooks/token-guard');

const H = 3600000;
const AT = 1754300000000;
const staleOff = ageH => ({ data: {}, ageMs: ageH * H, stale: true, at: AT });

test('fires once the meter has been dead past the threshold', () => {
  const cv = meterCanaryVerdict(staleOff(26), null, 24);
  assert(cv && cv.hours === 26 && cv.at === AT,
    `26h-dead meter must fire with its age, got: ${JSON.stringify(cv)}`);
});

test('a fresh reading never fires', () => {
  assert(meterCanaryVerdict({ data: {}, ageMs: 0, at: AT }, null, 24) === null,
    'a live meter must not trip the canary');
});

test('a short outage stays quiet', () => {
  assert(meterCanaryVerdict(staleOff(3), null, 24) === null,
    'a 3h-stale reading is normal churn, not an outage');
});

test('one-shot per outage, re-arms on a new last-success', () => {
  assert(meterCanaryVerdict(staleOff(26), AT, 24) === null,
    'the announced outage must not re-fire');
  const cv = meterCanaryVerdict(staleOff(26), AT - 5 * H, 24);
  assert(cv && cv.at === AT,
    'a recovered-then-stalled meter (new at) must fire again');
});

test('no prior good reading -> silent', () => {
  assert(meterCanaryVerdict(null, null, 24) === null,
    'no cache at all: no outage to date');
  assert(meterCanaryVerdict({ data: {}, ageMs: 30 * H, stale: true }, null, 24) === null,
    'a stale result without an at timestamp must stay silent');
});

test('null/0 threshold disables the canary', () => {
  assert(meterCanaryVerdict(staleOff(100), null, null) === null, 'null must disable');
  assert(meterCanaryVerdict(staleOff(100), null, 0) === null, '0 must disable');
});

test('the relayed line carries both numbers and no $ figure', () => {
  const s = meterCanaryNote(meterCanaryVerdict(staleOff(26), null, 24));
  assert(/~26h/.test(s), `the age must appear, got: ${s}`);
  assert(/past 24h/.test(s), `the threshold must appear (a number needs its threshold), got: ${s}`);
  assert(!/\$/.test(s), `window copy never carries $, got: ${s}`);
});

summary();

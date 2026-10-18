import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_POURS as pours,
  computePhase,
  defaultDrawdownAt,
  formatTime,
  shouldAutoStart,
  spiralPath,
} from "../pourover-card.js";

const at = (elapsed, weight = null, status = "running") =>
  computePhase({ status, elapsed, weight, pours });

test("formatTime", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(70), "1:10");
  assert.equal(formatTime(100.9), "1:40");
  assert.equal(formatTime(-3), "0:00");
});

test("idle, armed and done pass straight through", () => {
  assert.equal(at(0, null, "idle").phase, "idle");
  assert.equal(at(0, 0, "armed").phase, "armed");
  assert.equal(at(200, 350, "done").phase, "done");
});

test("auto-start only when armed and above the threshold", () => {
  assert.equal(shouldAutoStart("armed", 1.5, 2), false);
  assert.equal(shouldAutoStart("armed", 2.5, 2), true);
  assert.equal(shouldAutoStart("idle", 50, 2), false);
  assert.equal(shouldAutoStart("armed", null, 2), false);
});

test("time-only: phases follow the clock", () => {
  assert.deepEqual(
    [0, 39, 40, 69, 70, 99, 100].map((t) => at(t).index),
    [0, 0, 1, 1, 2, 2, 3],
  );
  assert.equal(at(0).phase, "pouring");
  assert.equal(at(20).progress, 0.5);
  assert.equal(at(20).countdown, 20);
});

test("time-only: drawdown after the last pour", () => {
  assert.equal(defaultDrawdownAt(pours), 130);
  assert.equal(at(129).phase, "pouring");
  assert.equal(at(130).phase, "drawdown");
});

test("scale: pouring until the target, then waiting", () => {
  const p = at(10, 30);
  assert.equal(p.phase, "pouring");
  assert.equal(p.index, 0);
  assert.equal(p.remaining, 20);
  assert.equal(p.progress, 0.6);

  const w = at(12, 50);
  assert.equal(w.phase, "waiting");
  assert.equal(w.index, 1);
  assert.equal(w.countdown, 28);
});

test("scale: within tolerance counts as hit", () => {
  assert.equal(at(12, 49.2).phase, "waiting");
  assert.equal(at(12, 48.5).phase, "pouring");
});

test("scale: waiting turns into the next pour at its start time", () => {
  assert.equal(at(39.9, 52).phase, "waiting");
  const p = at(40, 52);
  assert.equal(p.phase, "pouring");
  assert.equal(p.index, 1);
  assert.equal(p.progress, 0.02);
});

test("scale: mid pour 2 at 118 g", () => {
  const p = at(52, 118);
  assert.equal(p.phase, "pouring");
  assert.equal(p.index, 1);
  assert.equal(p.remaining, 32);
});

test("scale: a late pour starts as soon as the previous target is hit", () => {
  // Still finishing pour 2 well past pour 3's start time.
  assert.equal(at(80, 140).index, 1);
  const p = at(80, 150);
  assert.equal(p.phase, "pouring");
  assert.equal(p.index, 2);
});

test("scale: drawdown once the last target is hit, whatever the clock", () => {
  assert.equal(at(120, 345).phase, "pouring");
  assert.equal(at(120, 350).phase, "drawdown");
  assert.equal(at(300, 352).phase, "drawdown");
});

test("spiralPath starts at the centre", () => {
  const d = spiralPath(3);
  assert.match(d, /^M50\.00 50\.00/);
  assert.equal((d.match(/L/g) || []).length, 108);
});

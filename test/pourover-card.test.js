import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_POURS as pours,
  cleanConfig,
  computePhase,
  defaultDrawdownAt,
  findScale,
  formatTime,
  parseTime,
  shouldAutoStart,
  spiralPath,
  validatePours,
} from "../dist/pourover-card.js";

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

test("parseTime takes m:ss or seconds", () => {
  assert.equal(parseTime("1:10"), 70);
  assert.equal(parseTime("0:00"), 0);
  assert.equal(parseTime("70"), 70);
  assert.equal(parseTime(" 40 "), 40);
  assert.ok(Number.isNaN(parseTime("")));
  assert.ok(Number.isNaN(parseTime("1:75")));
  assert.ok(Number.isNaN(parseTime("abc")));
});

test("validatePours accepts the default recipe", () => {
  assert.deepEqual(validatePours(pours), []);
});

test("validatePours flags order, blanks and laps", () => {
  assert.deepEqual(validatePours([]), ["Add at least one pour"]);
  const swapped = [pours[0], { ...pours[1], start: 0 }];
  assert.deepEqual(validatePours(swapped), ["Pour 2 must start after pour 1"]);
  const lighter = [pours[0], { ...pours[1], target: 40 }];
  assert.deepEqual(validatePours(lighter), ["Pour 2 must finish heavier than pour 1"]);
  assert.match(validatePours([{ ...pours[0], start: NaN }])[0], /start/);
  assert.match(validatePours([{ ...pours[0], laps_in: 0 }])[0], /laps/);
});

test("cleanConfig drops defaults and blanks, keeps edits", () => {
  assert.deepEqual(
    cleanConfig({
      type: "custom:pourover-card",
      title: "Pourover",
      chime: true,
      tolerance: 1,
      start_threshold: 2,
      weight_entity: "",
      drawdown_at: undefined,
      pours: pours.map((p) => ({ ...p })),
    }),
    { type: "custom:pourover-card" },
  );
  const edited = pours.map((p, i) => (i === 1 ? { ...p, target: 160 } : p));
  assert.deepEqual(cleanConfig({ type: "x", chime: false, pours: edited }), {
    type: "x",
    chime: false,
    pours: edited,
  });
});

test("findScale picks a gram sensor and its tare button", () => {
  const g = (extra = {}) => ({ state: "0", attributes: { unit_of_measurement: "g", ...extra } });
  assert.deepEqual(findScale({}), {});
  assert.deepEqual(findScale({ "sensor.temp": { attributes: { unit_of_measurement: "°C" } } }), {});
  assert.deepEqual(
    findScale({ "sensor.lunar_weight": g(), "button.lunar_tare": {} }),
    { weight_entity: "sensor.lunar_weight", tare_entity: "button.lunar_tare" },
  );
  assert.deepEqual(findScale({ "sensor.flour": g(), "sensor.lunar_weight": g({ device_class: "weight" }) }), {
    weight_entity: "sensor.lunar_weight",
  });
});

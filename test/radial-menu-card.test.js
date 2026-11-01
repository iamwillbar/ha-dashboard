import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  SPREADS,
  actionConfig,
  cleanConfig,
  colorCss,
  defaultArc,
  isActive,
  itemPositions,
  minRadius,
  presetFor,
  spreadFor,
  validateButtons,
} from "../dist/radial-menu-card.js";

const xy = (p) => [p.x, p.y];

test("full circle: four items go up, right, down, left", () => {
  const pts = itemPositions(4, { start: 0, end: 360, radius: 100 });
  assert.deepEqual(pts.map(xy), [[0, -100], [100, 0], [0, 100], [-100, 0]]);
  assert.deepEqual(pts.map((p) => p.angle), [0, 90, 180, 270]);
});

test("full circle: the start angle rotates the ring", () => {
  const pts = itemPositions(2, { start: 90, end: 450, radius: 50 });
  assert.deepEqual(pts.map(xy), [[50, 0], [-50, 0]]);
});

test("arc: both endpoints are used", () => {
  const pts = itemPositions(3, { start: -90, end: 90, radius: 100 });
  assert.deepEqual(pts.map(xy), [[-100, 0], [0, -100], [100, 0]]);
});

test("arc: a single item sits mid-arc", () => {
  assert.deepEqual(itemPositions(1, { start: 0, end: 180, radius: 10 }).map(xy), [[10, 0]]);
});

test("itemPositions with no items is empty", () => {
  assert.deepEqual(itemPositions(0), []);
  assert.deepEqual(itemPositions(undefined), []);
});

test("minRadius keeps neighbours apart", () => {
  assert.equal(minRadius(1), 0);
  assert.equal(minRadius(0), 0);
  // Two items opposite each other: half the chord.
  assert.equal(minRadius(2, { itemSize: 44 }), 26);
  // Six on a full circle: chord 52 at 60° steps → r ≈ 52 (ceil may add 1).
  const six = minRadius(6, { itemSize: 44, gap: 8 });
  assert.ok(six >= 52 && six <= 53, String(six));
  // Six on a quarter arc need a lot more room than the 96 default.
  assert.ok(minRadius(6, { start: 0, end: 90, itemSize: 44 }) > 96);
  // Positions at the minimum radius really are a chord of itemSize + gap apart.
  const r = minRadius(5, { start: -90, end: 90, itemSize: 40, gap: 10 });
  const [a, b] = itemPositions(5, { start: -90, end: 90, radius: r });
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 50);
});

test("spread presets round-trip through presetFor", () => {
  for (const name of Object.keys(SPREADS)) {
    assert.equal(presetFor(...spreadFor(name)), name);
  }
  assert.equal(presetFor(10, 200), "custom");
  assert.equal(spreadFor("nope"), null);
});

test("defaultArc points into the screen from each corner", () => {
  assert.deepEqual(defaultArc("inline"), [0, 360]);
  assert.deepEqual(defaultArc("fixed", "bottom-right"), SPREADS["top-left"]);
  assert.deepEqual(defaultArc("fixed", "bottom-left"), SPREADS["top-right"]);
  assert.deepEqual(defaultArc("fixed", "top-right"), SPREADS["bottom-left"]);
  assert.deepEqual(defaultArc("fixed", "top-left"), SPREADS["bottom-right"]);
  assert.deepEqual(defaultArc("fixed", undefined), SPREADS["top-left"]);
});

test("colorCss maps theme names and passes CSS through", () => {
  assert.equal(colorCss("amber"), "var(--amber-color)");
  assert.equal(colorCss("deep-purple"), "var(--deep-purple-color)");
  assert.equal(colorCss("#ff0000"), "#ff0000");
  assert.equal(colorCss("rgb(1,2,3)"), "rgb(1,2,3)");
  assert.equal(colorCss(undefined), "var(--primary-color)");
  assert.equal(colorCss("", "x"), "x");
});

test("isActive recognises on-like states", () => {
  assert.equal(isActive({ state: "on" }), true);
  assert.equal(isActive({ state: "playing" }), true);
  assert.equal(isActive({ state: "off" }), false);
  assert.equal(isActive({ state: "unavailable" }), false);
  assert.equal(isActive(undefined), false);
});

test("actionConfig fills in HA's defaults", () => {
  assert.deepEqual(actionConfig({ icon: "mdi:star" }), { tap_action: { action: "none" } });
  assert.deepEqual(actionConfig({ entity: "light.a" }), {
    entity: "light.a",
    tap_action: { action: "more-info" },
  });
  const nav = { action: "navigate", navigation_path: "/lovelace/1" };
  assert.deepEqual(actionConfig({ icon: "mdi:cog", tap_action: nav }), { tap_action: nav });
});

test("validateButtons flags an empty list and faceless buttons", () => {
  assert.deepEqual(validateButtons([]), ["Add at least one button"]);
  assert.deepEqual(validateButtons(undefined), ["Add at least one button"]);
  assert.deepEqual(validateButtons([{ icon: "mdi:star" }, { entity: "light.a" }]), []);
  assert.deepEqual(validateButtons([{ name: "x" }]), ["Button 1: needs an icon or an entity"]);
});

test("cleanConfig drops defaults, blanks and the default arc", () => {
  const buttons = [{ icon: "mdi:star", name: "", entity: undefined, tap_action: { action: "none" } }];
  assert.deepEqual(
    cleanConfig({
      type: "custom:radial-menu-card",
      ...DEFAULTS,
      start_angle: 0,
      end_angle: 360,
      buttons,
    }),
    { type: "custom:radial-menu-card", buttons: [{ icon: "mdi:star", tap_action: { action: "none" } }] },
  );
});

test("cleanConfig keeps edits, including a non-default arc for a fixed corner", () => {
  assert.deepEqual(
    cleanConfig({ position: "fixed", corner: "bottom-left", start_angle: 0, end_angle: 90, buttons: [] }),
    { position: "fixed", corner: "bottom-left", buttons: [] },
  );
  assert.deepEqual(
    cleanConfig({ position: "fixed", start_angle: 0, end_angle: 90, radius: 120, buttons: [] }),
    { position: "fixed", start_angle: 0, end_angle: 90, radius: 120, buttons: [] },
  );
});

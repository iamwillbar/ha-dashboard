/**
 * Radial Menu Card — a round button that fans out a ring of action buttons.
 *
 * The centre button is always visible, either in the card's grid slot or
 * floating at a screen corner. Tapping it opens a full-screen overlay with
 * one round button per configured action. Tapping an item runs its standard
 * Home Assistant `tap_action` (via the `hass-action` event) and closes the
 * menu; tapping the centre, the backdrop, or pressing Escape closes it too.
 */

const VERSION = "1.2.0";

/* ------------------------------------------------------------------ */
/* Pure logic (exported for tests)                                     */
/* ------------------------------------------------------------------ */

/** Named spreads as [start, end] in degrees; 0 = up, clockwise. */
export const SPREADS = {
  full: [0, 360],
  top: [-90, 90],
  right: [0, 180],
  bottom: [90, 270],
  left: [180, 360],
  "top-right": [0, 90],
  "bottom-right": [90, 180],
  "bottom-left": [180, 270],
  "top-left": [270, 360],
};

export const CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"];

/** The quarter arc that points into the screen from each fixed corner. */
const CORNER_ARC = {
  "bottom-right": SPREADS["top-left"],
  "bottom-left": SPREADS["top-right"],
  "top-right": SPREADS["bottom-left"],
  "top-left": SPREADS["bottom-right"],
};

export function spreadFor(name) {
  return SPREADS[name] ? [...SPREADS[name]] : null;
}

/** The preset matching these angles, or "custom". */
export function presetFor(start, end) {
  const hit = Object.entries(SPREADS).find(([, [s, e]]) => s === start && e === end);
  return hit ? hit[0] : "custom";
}

/** Angles used when the config gives none. */
export function defaultArc(position, corner) {
  if (position === "fixed") return [...(CORNER_ARC[corner] ?? CORNER_ARC["bottom-right"])];
  return [...SPREADS.full];
}

const round2 = (v) => Math.round(v * 100) / 100 || 0;

/**
 * Where each of `n` items sits relative to the centre.
 * A full circle spaces items evenly without repeating the start.
 * An arc includes both endpoints; a single item sits mid-arc.
 */
export function itemPositions(n, { start = 0, end = 360, radius = 96 } = {}) {
  if (!(n > 0)) return [];
  const span = end - start;
  const full = Math.abs(span) >= 360;
  return Array.from({ length: n }, (_, i) => {
    const angle = full
      ? start + (i * Math.sign(span || 1) * 360) / n
      : n === 1
        ? start + span / 2
        : start + (i * span) / (n - 1);
    const t = (angle * Math.PI) / 180;
    return { angle, x: round2(radius * Math.sin(t)), y: round2(-radius * Math.cos(t)) };
  });
}

/**
 * The smallest radius at which `n` items of `itemSize` on this spread do not
 * touch, keeping `gap` px between neighbours.
 */
export function minRadius(n, { start = 0, end = 360, itemSize = 44, gap = 8 } = {}) {
  if (!(n > 1)) return 0;
  const span = Math.abs(end - start);
  const step = span >= 360 ? 360 / n : span / (n - 1);
  if (step <= 0) return Infinity;
  const half = Math.min(step, 180) / 2;
  return Math.ceil((itemSize + gap) / (2 * Math.sin((half * Math.PI) / 180)));
}

/** Colour names HA themes define as `--<name>-color`. */
export const THEME_COLORS = [
  "primary", "accent", "disabled", "red", "pink", "purple", "deep-purple", "indigo", "blue",
  "light-blue", "cyan", "teal", "green", "light-green", "lime", "yellow", "amber", "orange",
  "deep-orange", "brown", "light-grey", "grey", "dark-grey", "blue-grey", "black", "white",
];

/** A theme colour name → `var(--name-color)`; any other string is used as-is. */
export function colorCss(color, fallback = "var(--primary-color)") {
  if (!color) return fallback;
  return THEME_COLORS.includes(color) ? `var(--${color}-color)` : color;
}

const ACTIVE_STATES = new Set(["on", "open", "playing", "home", "unlocked"]);

export function isActive(stateObj) {
  return !!stateObj && ACTIVE_STATES.has(stateObj.state);
}

/** The config object a `hass-action` event carries for this button. */
export function actionConfig(button) {
  const out = {};
  if (button.entity) out.entity = button.entity;
  out.tap_action = button.tap_action ?? { action: button.entity ? "more-info" : "none" };
  return out;
}

/** Problems that would stop the menu working, as messages for the editor. */
export function validateButtons(buttons) {
  if (!Array.isArray(buttons) || buttons.length === 0) return ["Add at least one button"];
  const errors = [];
  buttons.forEach((b, i) => {
    if (!b || (!b.icon && !b.entity)) errors.push(`Button ${i + 1}: needs an icon or an entity`);
  });
  return errors;
}

export const DEFAULTS = {
  position: "inline",
  corner: "bottom-right",
  icon: "mdi:plus",
  color: "primary",
  size: 56,
  item_size: 44,
  radius: 96,
  show_labels: false,
};

const blank = (v) => v === undefined || v === null || v === "";

/** The smallest config that means the same thing: no defaults, no blanks. */
export function cleanConfig(config) {
  const position = config.position ?? DEFAULTS.position;
  const corner = config.corner ?? DEFAULTS.corner;
  const [ds, de] = defaultArc(position, corner);
  const out = {};
  for (const [k, v] of Object.entries(config)) {
    if (blank(v)) continue;
    if (k in DEFAULTS && v === DEFAULTS[k]) continue;
    if (k === "start_angle" && v === ds) continue;
    if (k === "end_angle" && v === de) continue;
    if (k === "buttons" && Array.isArray(v)) {
      out.buttons = v.map((b) => Object.fromEntries(Object.entries(b ?? {}).filter(([, x]) => !blank(x))));
      continue;
    }
    out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

const STYLE = `
:host { display: block; }
.wrap {
  display: flex; align-items: center; justify-content: center;
  min-height: var(--rm-size); padding: 4px; box-sizing: content-box;
}
.wrap.fixed { min-height: 0; padding: 0; }
.fab, .item {
  appearance: none; border: none; margin: 0; padding: 0; cursor: pointer;
  display: grid; place-items: center; border-radius: 50%;
  font: inherit; color: inherit;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .22), 0 0 0 1px rgba(0, 0, 0, .04);
}
.fab {
  width: var(--rm-size); height: var(--rm-size);
  background: var(--rm-color); color: var(--rm-on-color, #fff);
  --mdc-icon-size: calc(var(--rm-size) * .46);
  transition: transform .15s ease;
}
.fab:active { transform: scale(.94); }
.fab.hidden { visibility: hidden; }
.fab.fixed { position: fixed; z-index: 99; }
.fab.fixed.bottom-right { right: calc(16px + env(safe-area-inset-right)); bottom: calc(16px + env(safe-area-inset-bottom)); }
.fab.fixed.bottom-left  { left: calc(16px + env(safe-area-inset-left));  bottom: calc(16px + env(safe-area-inset-bottom)); }
.fab.fixed.top-right    { right: calc(16px + env(safe-area-inset-right)); top: calc(16px + env(safe-area-inset-top)); }
.fab.fixed.top-left     { left: calc(16px + env(safe-area-inset-left));  top: calc(16px + env(safe-area-inset-top)); }
.fab:focus-visible, .item:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 3px; }

.layer { position: fixed; inset: 0; z-index: 100; }
.scrim { position: absolute; inset: 0; background: var(--rm-scrim, rgba(0, 0, 0, .14)); }
.clone { position: absolute; transform: translate(-50%, -50%); }
.clone:active { transform: translate(-50%, -50%) scale(.94); }
.menu { position: absolute; width: 0; height: 0; }
.item {
  position: absolute; left: 0; top: 0;
  width: var(--rm-item); height: var(--rm-item);
  margin: calc(var(--rm-item) / -2) 0 0 calc(var(--rm-item) / -2);
  background: var(--rm-surface, var(--card-background-color, #fff));
  color: var(--rm-color);
  --mdc-icon-size: calc(var(--rm-item) * .5);
  transform: translate(var(--x), var(--y)) scale(1);
  opacity: 1;
  transition: transform .22s cubic-bezier(.2, .8, .2, 1.2), opacity .15s ease, background .15s, color .15s;
}
.item.enter { transform: translate(0, 0) scale(.4); opacity: 0; }
.item.active { background: var(--rm-color); color: var(--rm-on-color, #fff); }
.item .label {
  position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 5px;
  font-size: 11px; font-weight: 500; line-height: 1; white-space: nowrap; pointer-events: none;
  color: var(--primary-text-color, #212121);
  background: var(--rm-surface, var(--card-background-color, #fff));
  padding: 4px 7px; border-radius: 999px; box-shadow: 0 1px 3px rgba(0, 0, 0, .2);
}
@media (prefers-reduced-motion: reduce) {
  .item, .fab { transition: none; }
}
`;

const Base = typeof HTMLElement === "undefined" ? class {} : HTMLElement;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

class RadialMenuCard extends Base {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._layer = null;
    this._onKey = (ev) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        this._close(true);
      }
    };
    this._onViewport = () => this._close(false);
  }

  static getStubConfig() {
    return {
      buttons: [
        { icon: "mdi:lightbulb-group", name: "Lights", tap_action: { action: "none" } },
        { icon: "mdi:thermostat", name: "Climate", tap_action: { action: "none" } },
        { icon: "mdi:music", name: "Music", tap_action: { action: "none" } },
      ],
    };
  }

  static getConfigElement() {
    return document.createElement("radial-menu-card-editor");
  }

  setConfig(config) {
    const errors = validateButtons(config.buttons);
    if (errors.length) throw new Error(`radial-menu-card: ${errors[0]}`);
    const position = config.position === "fixed" ? "fixed" : "inline";
    const corner = CORNERS.includes(config.corner) ? config.corner : DEFAULTS.corner;
    const [ds, de] = defaultArc(position, corner);
    this._config = {
      ...DEFAULTS,
      ...config,
      position,
      corner,
      size: Number(config.size ?? DEFAULTS.size),
      item_size: Number(config.item_size ?? DEFAULTS.item_size),
      radius: Number(config.radius ?? DEFAULTS.radius),
      start_angle: Number(config.start_angle ?? ds),
      end_angle: Number(config.end_angle ?? de),
      show_labels: !!config.show_labels,
      buttons: config.buttons.map((b) => ({ ...b })),
    };
    this._close(false);
    this._build();
  }

  set hass(hass) {
    this._hass = hass;
    this._refreshItems();
  }

  getCardSize() {
    return 1;
  }

  getGridOptions() {
    if (this._config?.position === "fixed") return { columns: 1, rows: 1 };
    return { columns: 3, rows: (this._config?.size ?? 56) > 56 ? 2 : 1, min_columns: 2, min_rows: 1 };
  }

  disconnectedCallback() {
    this._close(false);
  }

  /* ---- DOM ---- */

  _build() {
    const c = this._config;
    const fixed = c.position === "fixed";
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="wrap ${fixed ? "fixed" : ""}" id="wrap"
           style="--rm-size:${c.size}px;--rm-item:${c.item_size}px;--rm-color:${colorCss(c.color)}">
        <button class="fab ${fixed ? `fixed ${c.corner}` : ""}" id="fab" type="button"
                aria-haspopup="menu" aria-expanded="false" aria-label="Open menu">
          <ha-icon icon="${esc(c.icon)}"></ha-icon>
        </button>
      </div>
    `;
    this._el = { wrap: this.shadowRoot.getElementById("wrap"), fab: this.shadowRoot.getElementById("fab") };
    this._el.fab.addEventListener("click", () => this._toggle());
  }

  _toggle() {
    if (this._layer) this._close(true);
    else this._open();
  }

  _iconFor(button) {
    const st = button.entity && this._hass?.states?.[button.entity];
    if (!button.icon && st) {
      const el = document.createElement("ha-state-icon");
      el.hass = this._hass;
      el.stateObj = st;
      return el;
    }
    const el = document.createElement("ha-icon");
    el.setAttribute("icon", button.icon || "mdi:help-circle-outline");
    return el;
  }

  _open() {
    if (this._layer || !this._config) return;
    const c = this._config;
    const rect = this._el.fab.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const arc = { start: c.start_angle, end: c.end_angle };
    const radius = Math.max(c.radius, minRadius(c.buttons.length, { ...arc, itemSize: c.item_size }));
    const positions = itemPositions(c.buttons.length, { ...arc, radius });

    const layer = document.createElement("div");
    layer.className = "layer";
    layer.innerHTML = `
      <div class="scrim" id="scrim"></div>
      <div class="menu" role="menu" id="menu" style="left:${cx}px;top:${cy}px"></div>
      <button class="fab clone" id="clone" type="button" aria-label="Close menu"
              style="left:${cx}px;top:${cy}px"><ha-icon icon="mdi:close"></ha-icon></button>
    `;
    const menu = layer.querySelector("#menu");
    c.buttons.forEach((b, i) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "item enter";
      item.setAttribute("role", "menuitem");
      item.dataset.i = String(i);
      const name = b.name || b.entity || `Button ${i + 1}`;
      item.setAttribute("aria-label", name);
      item.title = name;
      item.style.setProperty("--x", `${positions[i].x}px`);
      item.style.setProperty("--y", `${positions[i].y}px`);
      item.style.setProperty("--rm-color", colorCss(b.color, "var(--rm-menu-color, var(--primary-color))"));
      item.style.transitionDelay = `${i * 25}ms`;
      item.append(this._iconFor(b));
      if (c.show_labels) {
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = name;
        item.append(label);
      }
      menu.append(item);
    });

    layer.addEventListener("click", (ev) => {
      const item = ev.target.closest(".item");
      if (item) return this._activate(Number(item.dataset.i));
      if (ev.target.closest("#clone") || ev.target.closest("#scrim")) this._close(true);
    });

    this._el.wrap.append(layer);
    this._layer = layer;
    this._el.fab.classList.add("hidden");
    this._el.fab.setAttribute("aria-expanded", "true");
    this._refreshItems();

    requestAnimationFrame(() => {
      if (this._layer !== layer) return;
      layer.querySelectorAll(".item.enter").forEach((el) => el.classList.remove("enter"));
      layer.querySelector(".item")?.focus({ preventScroll: true });
      document.addEventListener("keydown", this._onKey, true);
      window.addEventListener("resize", this._onViewport);
      window.addEventListener("scroll", this._onViewport, true);
    });
  }

  _close(refocus) {
    if (!this._layer) return;
    document.removeEventListener("keydown", this._onKey, true);
    window.removeEventListener("resize", this._onViewport);
    window.removeEventListener("scroll", this._onViewport, true);
    this._layer.remove();
    this._layer = null;
    this._el?.fab.classList.remove("hidden");
    this._el?.fab.setAttribute("aria-expanded", "false");
    if (refocus) this._el?.fab.focus({ preventScroll: true });
  }

  _activate(i) {
    const button = this._config.buttons[i];
    this._close(true);
    if (!button) return;
    this.dispatchEvent(
      new CustomEvent("hass-action", {
        detail: { config: actionConfig(button), action: "tap" },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _refreshItems() {
    if (!this._layer) return;
    this._layer.querySelectorAll(".item").forEach((item) => {
      const b = this._config.buttons[Number(item.dataset.i)];
      const st = b?.entity && this._hass?.states?.[b.entity];
      item.classList.toggle("active", isActive(st));
      const icon = item.querySelector("ha-state-icon");
      if (icon && st) {
        icon.hass = this._hass;
        icon.stateObj = st;
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

const px = { min: 24, max: 400, step: 1, mode: "box", unit_of_measurement: "px" };
const deg = { min: -360, max: 720, step: 1, mode: "box", unit_of_measurement: "°" };

const select = (options) => ({ select: { mode: "dropdown", options } });

const SPREAD_LABELS = {
  full: "Full circle",
  top: "Top half",
  right: "Right half",
  bottom: "Bottom half",
  left: "Left half",
  "top-right": "Top-right quarter",
  "bottom-right": "Bottom-right quarter",
  "bottom-left": "Bottom-left quarter",
  "top-left": "Top-left quarter",
  custom: "Custom",
};

const buildSchema = (position) => [
  {
    type: "grid",
    name: "",
    schema: [
      {
        name: "position",
        selector: select([
          { value: "inline", label: "In the card" },
          { value: "fixed", label: "Floating at a corner" },
        ]),
      },
      ...(position === "fixed"
        ? [{ name: "corner", selector: select(CORNERS.map((c) => ({ value: c, label: c.replace("-", " ") }))) }]
        : []),
    ],
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "icon", selector: { icon: {} } },
      { name: "color", selector: { ui_color: {} } },
    ],
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "size", selector: { number: px } },
      { name: "item_size", selector: { number: px } },
      { name: "radius", selector: { number: px } },
    ],
  },
  {
    name: "spread",
    selector: select(Object.entries(SPREAD_LABELS).map(([value, label]) => ({ value, label }))),
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "start_angle", selector: { number: deg } },
      { name: "end_angle", selector: { number: deg } },
    ],
  },
  { name: "show_labels", selector: { boolean: {} } },
];

const BUTTON_SCHEMA = [
  {
    type: "grid",
    name: "",
    schema: [
      { name: "icon", selector: { icon: {} }, context: { icon_entity: "entity" } },
      { name: "name", selector: { text: {} } },
    ],
  },
  { name: "entity", selector: { entity: {} } },
  { name: "color", selector: { ui_color: {} } },
  { name: "tap_action", selector: { ui_action: { default_action: "more-info" } } },
];

const FORM_KEYS = [
  "position", "corner", "icon", "color", "size", "item_size", "radius",
  "start_angle", "end_angle", "show_labels",
];

const LABELS = {
  position: "Position",
  corner: "Corner",
  icon: "Icon",
  color: "Color",
  size: "Button size",
  item_size: "Item size",
  radius: "Radius",
  spread: "Spread",
  start_angle: "Start angle",
  end_angle: "End angle",
  show_labels: "Show labels",
  name: "Name",
  entity: "Entity",
  tap_action: "Tap action",
};

const HELPERS = {
  radius: "Distance from the centre to each item.",
  start_angle: "0 = up, clockwise. A span of 360 makes a full circle.",
  entity: "Optional. Used for the default icon, the default action, and active styling.",
  name: "Tooltip, screen-reader label, and label text when labels are shown.",
};

const EDITOR_STYLE = `
:host { display: block; }
h3 { margin: 20px 0 8px; font-size: 16px; font-weight: 500; }
.btn { border: 1px solid var(--divider-color, #ccc); border-radius: 12px; padding: 10px 12px 12px; margin: 10px 0; }
.btn-head { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; font-weight: 500; }
.btn-head .spacer { flex: 1; }
button {
  font: inherit; font-size: 14px; cursor: pointer; color: var(--primary-color, #03a9f4);
  background: transparent; border: 1px solid var(--divider-color, #ccc); border-radius: 999px;
  min-height: 36px; padding: 0 14px;
}
button.icon-btn { width: 32px; min-height: 32px; padding: 0; border: none; color: var(--secondary-text-color); font-size: 14px; }
button.icon-btn.remove { font-size: 18px; }
button:disabled { opacity: .35; cursor: default; }
.actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.errors { margin: 10px 0 0; padding: 0; list-style: none; color: var(--error-color, #db4437); font-size: 13px; }
.errors li { margin: 2px 0; }
`;

class RadialMenuCardEditor extends Base {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._buttons = [];
    this._emitted = "";
    this._position = DEFAULTS.position;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    this.shadowRoot?.querySelectorAll(".btn ha-form").forEach((f) => (f.hass = hass));
  }

  setConfig(config) {
    this._config = config;
    if (!this._form) this._build();
    const echo = JSON.stringify(config) === this._emitted;
    this._setFormData(this._dataFrom(config));
    // Our own edits come back through setConfig; rebuilding then would steal focus.
    if (echo) return;
    this._formData = null;
    this._buttons = (config.buttons ?? []).map((b) => ({ ...b }));
    this._renderButtons();
    this._renderErrors(validateButtons(this._buttons));
  }

  _dataFrom(config) {
    const position = config.position === "fixed" ? "fixed" : "inline";
    const corner = CORNERS.includes(config.corner) ? config.corner : DEFAULTS.corner;
    const [ds, de] = defaultArc(position, corner);
    const data = { ...DEFAULTS, ...config, position, corner };
    delete data.buttons;
    delete data.type;
    data.start_angle = config.start_angle ?? ds;
    data.end_angle = config.end_angle ?? de;
    data.spread = presetFor(data.start_angle, data.end_angle);
    return data;
  }

  _setFormData(data) {
    if (data.position !== this._position) {
      this._position = data.position;
      this._form.schema = buildSchema(data.position);
    }
    this._form.data = data;
  }

  _build() {
    this.shadowRoot.innerHTML = `
      <style>${EDITOR_STYLE}</style>
      <ha-form></ha-form>
      <h3>Buttons</h3>
      <div id="buttons"></div>
      <div class="actions"><button type="button" id="add">+ Add button</button></div>
      <ul class="errors" id="errors"></ul>
    `;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this._form = this.shadowRoot.querySelector("ha-form");
    this._form.computeLabel = (s) => LABELS[s.name] ?? s.name;
    this._form.computeHelper = (s) => HELPERS[s.name];
    this._form.schema = buildSchema(this._position);
    if (this._hass) this._form.hass = this._hass;
    this._form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._onFormChange(ev.detail.value);
    });
    this._buttonsEl = $("buttons");
    this._errorsEl = $("errors");
    this._buttonsEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-act]");
      if (!btn) return;
      const i = Number(btn.dataset.i);
      const { act } = btn.dataset;
      if (act === "remove") this._buttons.splice(i, 1);
      else if (act === "up" && i > 0) this._buttons.splice(i - 1, 0, this._buttons.splice(i, 1)[0]);
      else if (act === "down" && i < this._buttons.length - 1) this._buttons.splice(i + 1, 0, this._buttons.splice(i, 1)[0]);
      else return;
      this._renderButtons();
      this._emit();
    });
    $("add").addEventListener("click", () => {
      this._buttons.push({ icon: "mdi:star", name: "" });
      this._renderButtons();
      this._emit();
    });
  }

  _onFormChange(value) {
    const prev = this._formData ?? this._dataFrom(this._config);
    const next = { ...value };
    if (next.spread !== prev.spread && next.spread !== "custom" && SPREADS[next.spread]) {
      [next.start_angle, next.end_angle] = SPREADS[next.spread];
    } else {
      next.spread = presetFor(next.start_angle, next.end_angle);
    }
    if (next.position === "fixed" && !next.corner) next.corner = DEFAULTS.corner;
    this._formData = next;
    this._setFormData(next);
    this._emit();
  }

  _renderButtons() {
    this._buttonsEl.innerHTML = "";
    const n = this._buttons.length;
    this._buttons.forEach((b, i) => {
      const box = document.createElement("div");
      box.className = "btn";
      box.innerHTML = `
        <div class="btn-head">
          <span>Button ${i + 1}</span><span class="spacer"></span>
          <button type="button" class="icon-btn" data-act="up" data-i="${i}" aria-label="Move button ${i + 1} up" ${i === 0 ? "disabled" : ""}>▲</button>
          <button type="button" class="icon-btn" data-act="down" data-i="${i}" aria-label="Move button ${i + 1} down" ${i === n - 1 ? "disabled" : ""}>▼</button>
          <button type="button" class="icon-btn remove" data-act="remove" data-i="${i}" aria-label="Remove button ${i + 1}">✕</button>
        </div>
      `;
      const form = document.createElement("ha-form");
      form.computeLabel = (s) => LABELS[s.name] ?? s.name;
      form.computeHelper = (s) => HELPERS[s.name];
      form.schema = BUTTON_SCHEMA;
      if (this._hass) form.hass = this._hass;
      form.data = { ...b };
      form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._buttons[i] = { ...ev.detail.value };
        this._emit();
      });
      box.append(form);
      this._buttonsEl.append(box);
    });
  }

  _renderErrors(errors) {
    this._errorsEl.innerHTML = "";
    for (const msg of errors) {
      const li = document.createElement("li");
      li.textContent = msg;
      this._errorsEl.append(li);
    }
  }

  _emit() {
    const errors = validateButtons(this._buttons);
    this._renderErrors(errors);
    if (errors.length) return;

    const base = { ...this._config };
    if (this._formData) {
      for (const k of FORM_KEYS) delete base[k];
      const { spread, ...rest } = this._formData;
      Object.assign(base, rest);
    }
    const config = cleanConfig({ ...base, buttons: this._buttons });
    this._emitted = JSON.stringify(config);
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }),
    );
  }
}

if (typeof customElements !== "undefined" && !customElements.get("radial-menu-card")) {
  customElements.define("radial-menu-card", RadialMenuCard);
  customElements.define("radial-menu-card-editor", RadialMenuCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "radial-menu-card",
    name: "Radial Menu Card",
    description: "A round button that fans out a ring of actions.",
    preview: true,
  });
  console.info(`%c RADIAL-MENU-CARD %c ${VERSION} `, "background:#3f51b5;color:#fff", "");
}

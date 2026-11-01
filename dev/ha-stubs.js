/**
 * Stand-ins for Home Assistant elements, for the dev harnesses only.
 * HA never loads this file; each stub is skipped if the real element exists.
 */

const define = (name, cls) => {
  if (!customElements.get(name)) customElements.define(name, cls);
};

/* ha-form: renders plain inputs from a schema and fires value-changed. */
define(
  "ha-form",
  class extends HTMLElement {
    set data(v) { this._data = v; this._sync(); }
    get data() { return this._data; }
    set schema(v) { this._schema = v; this._render(); }
    _fields() { return (this._schema ?? []).flatMap((s) => s.schema ?? [s]); }
    _render() {
      this.innerHTML = "";
      for (const s of this._fields()) {
        const label = document.createElement("label");
        label.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;margin:6px 0;font-size:14px";
        label.textContent = this.computeLabel?.(s) ?? s.name;
        const sel = s.selector ?? {};
        let input;
        if (sel.select) {
          input = document.createElement("select");
          for (const o of sel.select.options ?? []) {
            const opt = document.createElement("option");
            opt.value = typeof o === "string" ? o : o.value;
            opt.textContent = typeof o === "string" ? o : o.label;
            input.append(opt);
          }
        } else if (sel.ui_action) {
          input = document.createElement("textarea");
          input.rows = 2;
          input.placeholder = '{"action":"toggle"}';
        } else {
          input = document.createElement("input");
          input.type = sel.boolean ? "checkbox" : sel.number ? "number" : "text";
          if (sel.icon) input.placeholder = "mdi:…";
          if (sel.entity) input.placeholder = "domain.object_id";
          if (sel.ui_color) input.placeholder = "primary, amber, #hex…";
        }
        input.name = s.name;
        input.style.cssText = "max-width:60%;font:inherit;font-size:13px";
        const read = () => {
          if (input.type === "checkbox") return input.checked;
          if (input.type === "number") return input.value === "" ? undefined : Number(input.value);
          if (input.tagName === "TEXTAREA") {
            if (input.value.trim() === "") return undefined;
            try { return JSON.parse(input.value); } catch { return this._data?.[s.name]; }
          }
          return input.value;
        };
        input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => {
          const v = read();
          const value = { ...this._data, [s.name]: v };
          if (v === undefined || v === "") delete value[s.name];
          this._data = value;
          this.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
        });
        label.append(input);
        this.append(label);
      }
      this._sync();
    }
    _sync() {
      if (!this._schema || !this._data) return;
      for (const input of this.querySelectorAll("input, select, textarea")) {
        if (input === document.activeElement) continue;
        const v = this._data[input.name];
        if (input.type === "checkbox") input.checked = !!v;
        else if (input.tagName === "TEXTAREA") input.value = v == null ? "" : JSON.stringify(v);
        else input.value = v ?? "";
      }
    }
  },
);

/* ha-icon: fetches the Material Design Icon SVG so screenshots show real icons. */
const iconCache = new Map();
const fetchIcon = (name) => {
  if (!iconCache.has(name)) {
    iconCache.set(
      name,
      fetch(`https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/${name}.svg`)
        .then((r) => (r.ok ? r.text() : ""))
        .then((svg) => /<path d="([^"]+)"/.exec(svg)?.[1] ?? "")
        .catch(() => ""),
    );
  }
  return iconCache.get(name);
};

define(
  "ha-icon",
  class extends HTMLElement {
    static get observedAttributes() { return ["icon"]; }
    set icon(v) { this.setAttribute("icon", v); }
    get icon() { return this.getAttribute("icon"); }
    attributeChangedCallback() { this._render(); }
    connectedCallback() { this._render(); }
    async _render() {
      const icon = this.getAttribute("icon") ?? "";
      const name = icon.replace(/^mdi:/, "");
      this.style.cssText = "display:inline-block;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);line-height:0";
      const path = await fetchIcon(name);
      if (this.getAttribute("icon") !== icon) return;
      this.innerHTML = path
        ? `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="${path}"/></svg>`
        : `<span style="font-size:9px;line-height:1">${name.slice(0, 3)}</span>`;
    }
  },
);

/* ha-state-icon: the entity's icon, or a domain fallback. */
const DOMAIN_ICONS = {
  light: "mdi:lightbulb",
  switch: "mdi:toggle-switch-variant",
  fan: "mdi:fan",
  media_player: "mdi:speaker",
  lock: "mdi:lock",
  cover: "mdi:window-shutter",
  scene: "mdi:palette",
  script: "mdi:script-text",
  climate: "mdi:thermostat",
  person: "mdi:account",
};

define(
  "ha-state-icon",
  class extends HTMLElement {
    set hass(v) { this._hass = v; }
    set stateObj(v) { this._stateObj = v; this._render(); }
    connectedCallback() { this._render(); }
    _render() {
      const st = this._stateObj;
      if (!st) return;
      const domain = st.entity_id?.split(".")[0];
      const icon = st.attributes?.icon ?? DOMAIN_ICONS[domain] ?? "mdi:bookmark";
      let el = this.querySelector("ha-icon");
      if (!el) {
        el = document.createElement("ha-icon");
        this.append(el);
      }
      el.setAttribute("icon", icon);
    }
  },
);

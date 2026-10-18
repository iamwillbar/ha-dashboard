/**
 * Pourover Card — a guided pourover brew card for Home Assistant.
 *
 * Walks through a multi-pour recipe (Blue Bottle's 4-pour method by default)
 * with a ring dial, an animated spiral for the pour pattern, and a timeline.
 * Optionally reads live weight from a scale entity (e.g. an Acaia via the
 * core `acaia` integration) and can press its tare button.
 */

const VERSION = "1.0.0";

export const DEFAULT_POURS = [
  { start: 0, target: 50, laps_out: 3, laps_in: 3 },
  { start: 40, target: 150, laps_out: 5, laps_in: 5 },
  { start: 70, target: 250, laps_out: 5, laps_in: 5 },
  { start: 100, target: 350, laps_out: 5, laps_in: 5 },
];

/* ------------------------------------------------------------------ */
/* Pure logic (exported for tests)                                     */
/* ------------------------------------------------------------------ */

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** When the time-only guide moves from the last pour to drawdown. */
export function defaultDrawdownAt(pours) {
  const last = pours[pours.length - 1];
  const prev = pours[pours.length - 2];
  return last.start + (prev ? last.start - prev.start : 30);
}

/** An armed brew starts once the scale sees water. */
export function shouldAutoStart(status, weight, threshold = 2) {
  return status === "armed" && weight != null && weight > threshold;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * Work out where the brew is.
 *
 * @param {object} input
 * @param {"idle"|"armed"|"running"|"paused"|"done"} input.status
 * @param {number} input.elapsed      seconds since the first pour began
 * @param {number|null} input.weight  grams from the scale, or null for time-only
 * @param {Array} input.pours
 * @param {number} [input.tolerance]  grams under target that still counts as hit
 * @param {number} [input.drawdownAt] seconds; time-only end of the last pour
 * @returns {{phase:string,index:number,progress:number,countdown?:number,remaining?:number}}
 *   phase: idle | armed | pouring | waiting | drawdown | done
 *   index: the pour being poured, or the pour being waited for
 */
export function computePhase({
  status,
  elapsed = 0,
  weight = null,
  pours,
  tolerance = 1,
  drawdownAt,
}) {
  if (status === "idle") return { phase: "idle", index: 0, progress: 0 };
  if (status === "armed") return { phase: "armed", index: 0, progress: 0 };
  if (status === "done") return { phase: "done", index: pours.length - 1, progress: 1 };

  const n = pours.length;

  if (weight != null) {
    // Scale mode: the weight says which pours are finished.
    let reached = 0;
    while (reached < n && weight >= pours[reached].target - tolerance) reached++;
    if (reached === n) return { phase: "drawdown", index: n - 1, progress: 1 };

    const pour = pours[reached];
    if (elapsed < pour.start) {
      return {
        phase: "waiting",
        index: reached,
        progress: 1,
        countdown: pour.start - elapsed,
      };
    }
    const from = reached > 0 ? pours[reached - 1].target : 0;
    return {
      phase: "pouring",
      index: reached,
      progress: clamp01((weight - from) / (pour.target - from)),
      remaining: Math.max(0, pour.target - weight),
    };
  }

  // Time-only mode: the clock says which pour is current.
  const end = drawdownAt ?? defaultDrawdownAt(pours);
  if (elapsed >= end) return { phase: "drawdown", index: n - 1, progress: 1 };
  let i = 0;
  while (i + 1 < n && elapsed >= pours[i + 1].start) i++;
  const until = i + 1 < n ? pours[i + 1].start : end;
  return {
    phase: "pouring",
    index: i,
    progress: clamp01((elapsed - pours[i].start) / (until - pours[i].start)),
    countdown: until - elapsed,
  };
}

/** An Archimedean spiral path, centred on (cx, cy), `turns` laps out to radius r. */
export function spiralPath(turns, r = 40, cx = 50, cy = 50) {
  const steps = Math.max(1, Math.round(turns * 36));
  const total = turns * Math.PI * 2;
  let d = "";
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * total;
    const rr = (t / total) * r;
    const x = cx + rr * Math.cos(t - Math.PI / 2);
    const y = cy + rr * Math.sin(t - Math.PI / 2);
    d += `${k ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

const RING_R = 88;
const RING_C = 2 * Math.PI * RING_R;
const SECONDS_PER_LAP = 1.1;

const STYLE = `
:host {
  --po-copper: #c4773b;
  --po-caramel: #e3a565;
  --po-espresso: #3b2418;
  --po-bloom: #6f9e5f;
  --po-text: var(--primary-text-color, #2b211b);
  --po-muted: var(--secondary-text-color, #7a6a5e);
  --po-track: color-mix(in srgb, var(--po-text) 9%, transparent);
  --po-surface: var(--ha-card-background, var(--card-background-color, #fffaf4));
  display: block;
}
ha-card, .card {
  display: block;
  position: relative;
  overflow: hidden;
  padding: 18px 18px 16px;
  border-radius: var(--ha-card-border-radius, 16px);
  color: var(--po-text);
  background:
    radial-gradient(120% 70% at 50% 0%, color-mix(in srgb, var(--po-copper) 14%, transparent), transparent 70%),
    var(--po-surface);
  font-variant-numeric: tabular-nums;
}
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.eyebrow {
  font-size: 12px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
  color: var(--po-copper);
}
.title { font-size: 13px; color: var(--po-muted); margin-top: 2px; }
.clock { font-size: 26px; font-weight: 600; letter-spacing: .02em; }
.clock.paused { opacity: .45; }

.dial { position: relative; width: min(100%, 260px); margin: 6px auto 0; aspect-ratio: 1; }
.dial svg { width: 100%; height: 100%; display: block; }
.track { fill: none; stroke: var(--po-track); stroke-width: 14; }
.arc {
  fill: none; stroke: url(#po-grad); stroke-width: 14; stroke-linecap: round;
  transform: rotate(-90deg); transform-origin: 100px 100px;
  transition: stroke-dashoffset .35s ease, stroke .3s;
}
.dial[data-state="hit"] .arc { stroke: var(--po-bloom); }
.dial[data-state="cue"] { animation: cue 1s ease-in-out infinite; }
@keyframes cue { 50% { transform: scale(1.035); } }
.dial[data-state="armed"] .track { animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50% { stroke: color-mix(in srgb, var(--po-copper) 45%, transparent); } }

.center {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; pointer-events: none;
}
.big { font-size: 52px; font-weight: 700; line-height: 1; letter-spacing: -.02em; }
.big small { font-size: 20px; font-weight: 600; margin-left: 2px; color: var(--po-muted); }
.of { margin-top: 6px; font-size: 14px; color: var(--po-muted); }
.of b { color: var(--po-text); font-weight: 600; }
.sub { margin-top: 8px; font-size: 13px; font-weight: 600; color: var(--po-copper); min-height: 1em; }
.sub.ok { color: var(--po-bloom); }

.pattern {
  display: flex; align-items: center; gap: 14px; margin: 6px auto 4px; padding: 10px 14px;
  max-width: 320px; border-radius: 14px;
  background: color-mix(in srgb, var(--po-text) 4%, transparent);
}
.spiral { width: 56px; height: 56px; flex: none; }
.spiral .guide { fill: none; stroke: var(--po-track); stroke-width: 2.5; stroke-linecap: round; }
.spiral .flow { fill: none; stroke: var(--po-copper); stroke-width: 3.5; stroke-linecap: round; }
.spiral .drop { fill: var(--po-caramel); }
.pattern-text { font-size: 14px; line-height: 1.35; }
.pattern-text .k { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--po-muted); }
.pattern-text b { font-weight: 600; }

.timeline { position: relative; margin: 14px 4px 0; }
.rail { position: absolute; left: 12.5%; right: 12.5%; top: 7px; height: 2px; background: var(--po-track); }
.rail-fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: 0;
  background: linear-gradient(90deg, var(--po-copper), var(--po-caramel)); transition: width .35s ease;
}
.steps { position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.step { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 12px; color: var(--po-muted); }
.dot {
  width: 12px; height: 12px; border-radius: 50%; box-sizing: border-box;
  border: 2px solid var(--po-track); background: var(--po-surface); margin-bottom: 3px;
}
.step.done .dot { background: var(--po-copper); border-color: var(--po-copper); }
.step.active { color: var(--po-text); font-weight: 600; }
.step.active .dot {
  border-color: var(--po-copper); background: var(--po-surface);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--po-copper) 22%, transparent);
}

.actions { display: flex; justify-content: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
button {
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  min-height: 40px; padding: 0 18px; border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--po-text) 16%, transparent);
  background: transparent; color: var(--po-text);
}
button.primary { background: var(--po-copper); border-color: var(--po-copper); color: #fff; min-width: 112px; }
button:focus-visible { outline: 2px solid var(--po-copper); outline-offset: 2px; }
button[hidden] { display: none; }
.hint { text-align: center; font-size: 12px; color: var(--po-muted); margin-top: 8px; min-height: 1em; }

@media (prefers-reduced-motion: reduce) {
  .dial[data-state="cue"], .dial[data-state="armed"] .track { animation: none; }
  .arc, .rail-fill { transition: none; }
}
`;

const Base = typeof HTMLElement === "undefined" ? class {} : HTMLElement;

class PouroverCard extends Base {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._status = "idle";
    this._startedAt = 0; // epoch ms when the current run segment began
    this._accum = 0; // ms accumulated before the current segment
    this._lastKey = "";
    this._spiralKey = "";
    this._timer = null;
    this._now = () => Date.now();
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    const pours = config.pours ?? DEFAULT_POURS;
    if (!Array.isArray(pours) || pours.length === 0) {
      throw new Error("pourover-card: `pours` must be a non-empty list");
    }
    pours.forEach((p, i) => {
      if (typeof p.start !== "number" || typeof p.target !== "number") {
        throw new Error(`pourover-card: pour ${i + 1} needs numeric \`start\` and \`target\``);
      }
    });
    this._config = {
      title: config.title ?? "Pourover",
      weight_entity: config.weight_entity,
      tare_entity: config.tare_entity,
      start_threshold: config.start_threshold ?? 2,
      tolerance: config.tolerance ?? 1,
      chime: config.chime ?? true,
      pours: pours.map((p) => ({
        start: p.start,
        target: p.target,
        laps_out: Number(p.laps_out ?? 5),
        laps_in: Number(p.laps_in ?? p.laps_out ?? 5),
      })),
    };
    this._config.drawdown_at = config.drawdown_at ?? defaultDrawdownAt(this._config.pours);
    this._build();
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    if (shouldAutoStart(this._status, this._weight(), this._config?.start_threshold)) {
      this._run();
    }
    this._update();
  }

  getCardSize() {
    return 9;
  }

  connectedCallback() {
    if (this._status === "running") this._tick();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = null;
  }

  /* ---- state ---- */

  _weight() {
    const id = this._config?.weight_entity;
    const st = id && this._hass?.states?.[id];
    if (!st) return null;
    const w = parseFloat(st.state);
    return Number.isFinite(w) ? w : null;
  }

  _elapsed() {
    const live = this._status === "running" ? this._now() - this._startedAt : 0;
    return (this._accum + live) / 1000;
  }

  _run() {
    this._status = "running";
    this._startedAt = this._now();
    this._tick();
  }

  _tick() {
    clearInterval(this._timer);
    this._timer = setInterval(() => this._update(), 200);
  }

  _onPrimary() {
    this._ensureAudio();
    const phase = this._phase().phase;
    if (this._status === "idle") {
      if (this._weight() != null) this._status = "armed";
      else this._run();
    } else if (this._status === "armed") {
      this._run(); // start the clock by hand
    } else if (phase === "drawdown") {
      this._accum = this._elapsed() * 1000;
      this._status = "done";
      clearInterval(this._timer);
    } else if (this._status === "running") {
      this._accum = this._elapsed() * 1000;
      this._status = "paused";
      clearInterval(this._timer);
    } else if (this._status === "paused") {
      this._run();
    } else if (this._status === "done") {
      this._reset();
    }
    this._update();
  }

  _reset() {
    clearInterval(this._timer);
    this._status = "idle";
    this._accum = 0;
    this._lastKey = "";
    this._update();
  }

  _tare() {
    const id = this._config.tare_entity;
    if (id && this._hass) this._hass.callService("button", "press", { entity_id: id });
  }

  _phase() {
    const status = this._status === "paused" ? "running" : this._status;
    return computePhase({
      status,
      elapsed: this._elapsed(),
      weight: this._weight(),
      pours: this._config.pours,
      tolerance: this._config.tolerance,
      drawdownAt: this._config.drawdown_at,
    });
  }

  /* ---- sound ---- */

  _ensureAudio() {
    if (!this._config.chime || this._audio) return;
    try {
      this._audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      this._audio = null;
    }
  }

  _chime(notes) {
    const ctx = this._audio;
    if (!ctx) return;
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  }

  /* ---- DOM ---- */

  _build() {
    const { pours } = this._config;

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card class="card">
        <div class="head">
          <div>
            <div class="eyebrow" id="eyebrow"></div>
            <div class="title" id="title"></div>
          </div>
          <div class="clock" id="clock">0:00</div>
        </div>

        <div class="dial" id="dial">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <defs>
              <linearGradient id="po-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="var(--po-caramel)"/>
                <stop offset="1" stop-color="var(--po-copper)"/>
              </linearGradient>
            </defs>
            <circle class="track" cx="100" cy="100" r="${RING_R}"/>
            <circle class="arc" id="arc" cx="100" cy="100" r="${RING_R}"
              stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/>
          </svg>
          <div class="center" role="status" aria-live="polite">
            <div class="big" id="big"></div>
            <div class="of" id="of"></div>
            <div class="sub" id="sub"></div>
          </div>
        </div>

        <div class="pattern">
          <svg class="spiral" id="spiral" viewBox="0 0 100 100" aria-hidden="true"></svg>
          <div class="pattern-text">
            <div class="k" id="pattern-k">Pour pattern</div>
            <div id="pattern"></div>
          </div>
        </div>

        <div class="timeline">
          <div class="rail"><div class="rail-fill" id="rail"></div></div>
          <div class="steps" style="--n:${pours.length}">
            ${pours
              .map(
                (p, i) => `
              <div class="step" data-i="${i}">
                <div class="dot"></div>
                <div>${formatTime(p.start)}</div>
                <div>${p.target} g</div>
              </div>`,
              )
              .join("")}
          </div>
        </div>

        <div class="actions">
          <button id="tare" type="button">Tare</button>
          <button id="primary" class="primary" type="button">Start</button>
          <button id="reset" type="button">Reset</button>
        </div>
        <div class="hint" id="hint"></div>
      </ha-card>
    `;

    const $ = (id) => this.shadowRoot.getElementById(id);
    this._el = {
      eyebrow: $("eyebrow"), title: $("title"), clock: $("clock"), dial: $("dial"),
      arc: $("arc"), big: $("big"), of: $("of"), sub: $("sub"), spiral: $("spiral"),
      patternK: $("pattern-k"), pattern: $("pattern"), rail: $("rail"),
      steps: [...this.shadowRoot.querySelectorAll(".step")],
      tare: $("tare"), primary: $("primary"), reset: $("reset"), hint: $("hint"),
    };
    this._el.primary.addEventListener("click", () => this._onPrimary());
    this._el.reset.addEventListener("click", () => this._reset());
    this._el.tare.addEventListener("click", () => this._tare());
    this._spiralKey = "";
  }

  _renderSpiral(pour, animate) {
    const key = `${pour.laps_out}/${pour.laps_in}/${animate}`;
    if (key === this._spiralKey) return;
    this._spiralKey = key;
    const d = spiralPath(Math.max(pour.laps_out, 1));
    const laps = pour.laps_out + pour.laps_in;
    const dur = `${(laps * SECONDS_PER_LAP).toFixed(1)}s`;
    const split = (pour.laps_out / laps).toFixed(3);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const moving = animate && !reduce;
    this._el.spiral.innerHTML = `
      <path class="guide" d="${d}"/>
      <path class="flow" d="${d}" pathLength="1" stroke-dasharray="1"
        stroke-dashoffset="${moving ? 1 : 0}">
        ${moving ? `<animate attributeName="stroke-dashoffset" values="1;0;1"
          keyTimes="0;${split};1" dur="${dur}" repeatCount="indefinite"/>` : ""}
      </path>
      ${moving ? `<circle class="drop" r="5">
        <animateMotion dur="${dur}" repeatCount="indefinite" path="${d}"
          keyPoints="0;1;0" keyTimes="0;${split};1" calcMode="linear"/>
      </circle>` : ""}
    `;
  }

  _update() {
    if (!this._el) return;
    const { pours } = this._config;
    const el = this._el;
    const weight = this._weight();
    const hasScale = weight != null;
    const elapsed = this._elapsed();
    const p = this._phase();
    const pour = pours[p.index];
    const total = pours[pours.length - 1].target;
    const g = (x) => `${Math.round(x)}<small>g</small>`;

    // Cues on transitions.
    const key = `${p.phase}:${p.index}`;
    if (this._lastKey && key !== this._lastKey) {
      if (p.phase === "pouring" && p.index > 0) this._chime([660, 880]);
      else if (p.phase === "waiting" || p.phase === "drawdown") this._chime([523]);
    }
    this._lastKey = key;

    el.title.textContent = this._config.title;
    el.clock.textContent = formatTime(elapsed);
    el.clock.classList.toggle("paused", this._status === "paused");

    let eyebrow, big, of, sub = "", subOk = false, ring = p.progress, state = "";
    switch (p.phase) {
      case "idle":
        eyebrow = "Ready";
        big = g(total);
        of = `${pours.length} pours · ${formatTime(this._config.drawdown_at)} + drawdown`;
        sub = hasScale ? "Place the brewer and tare" : "";
        ring = 0;
        break;
      case "armed":
        eyebrow = "Pour 1 of " + pours.length;
        big = hasScale ? g(weight) : "0:00";
        of = `pour to <b>${pour.target} g</b>`;
        sub = "Start pouring — the clock starts itself";
        ring = 0;
        state = "armed";
        break;
      case "pouring":
        eyebrow = `Pour ${p.index + 1} of ${pours.length}`;
        if (hasScale) {
          big = g(weight);
          of = `of <b>${pour.target} g</b>`;
          sub = `${Math.ceil(p.remaining)} g to go`;
        } else {
          big = g(pour.target);
          of = "pour to";
          sub = `${formatTime(Math.ceil(p.countdown))} left`;
        }
        if (elapsed - pour.start < 3 && p.index > 0) state = "cue";
        break;
      case "waiting": {
        eyebrow = `Next: pour ${p.index + 1} of ${pours.length}`;
        big = formatTime(Math.ceil(p.countdown));
        of = `then pour to <b>${pour.target} g</b>`;
        const prev = pours[p.index - 1];
        const over = prev ? weight - prev.target : 0;
        sub = over >= 5 ? `+${Math.round(over)} g over` : "Target hit — let it bloom";
        subOk = over < 5;
        state = "hit";
        break;
      }
      case "drawdown":
        eyebrow = "Drawdown";
        big = hasScale ? g(weight) : formatTime(elapsed);
        of = hasScale ? `of <b>${total} g</b>` : "let it drain";
        sub = "Tap Done when it’s dry";
        subOk = true;
        state = "hit";
        break;
      case "done":
        eyebrow = "Done";
        big = formatTime(elapsed);
        of = "total brew time";
        sub = "Enjoy your coffee";
        subOk = true;
        state = "hit";
        break;
    }

    el.eyebrow.textContent = eyebrow;
    el.big.innerHTML = big;
    el.of.innerHTML = of;
    el.sub.textContent = sub;
    el.sub.classList.toggle("ok", subOk);
    el.dial.dataset.state = state;
    el.arc.setAttribute("stroke-dashoffset", String(RING_C * (1 - ring)));

    // Pour pattern
    const showPour = p.phase === "waiting" || p.phase === "pouring" || p.phase === "armed" || p.phase === "idle";
    if (showPour) {
      el.patternK.textContent = p.phase === "waiting" ? "Next pattern" : "Pour pattern";
      el.pattern.innerHTML = `Spiral <b>${pour.laps_out} out</b>, then <b>${pour.laps_in} in</b>`;
    } else {
      el.patternK.textContent = "Pour pattern";
      el.pattern.innerHTML = "Hands off — let it drain";
    }
    this._renderSpiral(pour, p.phase === "pouring" && this._status === "running");

    // Timeline
    const doneCount =
      p.phase === "pouring" || p.phase === "armed" ? p.index
        : p.phase === "waiting" ? p.index
        : p.phase === "idle" ? 0 : pours.length;
    el.steps.forEach((s, i) => {
      s.classList.toggle("done", i < doneCount);
      s.classList.toggle("active", (p.phase === "pouring" || p.phase === "armed") && i === p.index);
    });
    const span = pours.length - 1 || 1;
    const railPos =
      p.phase === "idle" || p.phase === "armed" ? 0
        : p.phase === "pouring" ? (p.index + (p.index < span ? p.progress : 0)) / span
        : p.phase === "waiting" && p.index > 0
          ? (p.index - 1 + (1 - p.countdown / (pour.start - pours[p.index - 1].start))) / span
        : p.phase === "waiting" ? 0
        : 1;
    el.rail.style.width = `${Math.min(1, Math.max(0, railPos)) * 100}%`;

    // Buttons
    const label = {
      idle: "Start",
      armed: "Start now",
      done: "New brew",
    }[p.phase] ?? (p.phase === "drawdown" ? "Done" : this._status === "paused" ? "Resume" : "Pause");
    el.primary.textContent = label;
    el.tare.hidden = !this._config.tare_entity;
    el.reset.hidden = this._status === "idle";
    el.hint.textContent =
      p.phase === "idle" && hasScale ? "The clock starts when the first water hits the scale"
        : p.phase === "idle" ? "No scale connected — guided by time"
        : this._config.weight_entity && !hasScale && this._status !== "idle" ? "Scale unavailable — guiding by time"
        : "";
  }
}

if (typeof customElements !== "undefined" && !customElements.get("pourover-card")) {
  customElements.define("pourover-card", PouroverCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "pourover-card",
    name: "Pourover Card",
    description: "Guided pourover brewing with an optional scale.",
    preview: true,
  });
  console.info(`%c POUROVER-CARD %c ${VERSION} `, "background:#c4773b;color:#fff", "");
}

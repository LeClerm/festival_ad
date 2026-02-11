(() => {
  const config = {
    duration: 10.0,
    stats: [
      { value: 5,   label: "Conférences" },
      { value: 23,  label: "Photographes" },
      { value: 400, label: "Photos" }
    ],
    roll: { minTurns: 2, maxTurns: 5, overshoot: 0.12 },
    beats: {
      // Header
      titleInStart: 0.10, titleInEnd: 0.55,
      dateInStart:  0.35, dateInEnd:  0.85,
      urlInStart:   0.75, urlInEnd:   1.25,

      // Title "founding moment" accent (subtle pulse)
      titleAccentStart: 0.32,
      titleAccentEnd:   0.78,

      // Stats (same structure, slightly tuned for rhythm + payoff)
      s1In: 1.20, s1RollEnd: 2.10, s1HoldEnd: 2.45, s1Out: 2.75,
      s2In: 2.90, s2RollEnd: 3.80, s2HoldEnd: 4.15, s2Out: 4.45,

      // Payoff: longer hold for "400 Photos"
      s3In: 4.60, s3RollEnd: 5.55, s3HoldEnd: 6.55, s3Out: 6.95,

      // Breath (no middle content changes)
      pauseStart: 6.95,
      pauseEnd:   7.40,

      // Theme lands later and slower (emotional landing)
      themeIn: 7.40, themeFull: 8.35,
      prefixOutStart: 8.75, prefixOutEnd: 9.25
    }
  };

  const params = new URLSearchParams(location.search);
  const isRender = params.get("render") === "1";
  const mode = params.get("mode") || "video";
  const isStillMode = mode === "still";
  document.documentElement.dataset.mode = mode;

  // Auto-fit preview scaling (9:16)
  function updateScale() {
    if (isRender) {
      document.documentElement.style.setProperty("--scale", "1");
      return;
    }
    const W = 1080, H = 1920;
    const pad = 24;
    const sx = (window.innerWidth - pad) / W;
    const sy = (window.innerHeight - pad) / H;
    const scale = Math.min(sx, sy, 1);
    document.documentElement.style.setProperty("--scale", String(scale));
  }
  window.addEventListener("resize", updateScale);
  updateScale();

  // Elements
  const titleEl = document.getElementById("title");
  const dateEl = document.getElementById("date");
  const urlEl = document.getElementById("url");
  const accentBarEl = document.getElementById("accentBar");

  const stack = document.getElementById("stack");
  const themeEl = document.getElementById("theme");
  const themePrefixEl = document.getElementById("themePrefix");
  const themeMainEl = document.getElementById("themeMain");

  // Build stat lines
  const lines = config.stats.map((s, idx) => {
    const stat = document.createElement("div");
    stat.className = "stat";
    stat.dataset.index = String(idx);

    const number = document.createElement("div");
    number.className = "number";

    const odo = document.createElement("div");
    odo.className = "odo";

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = s.label;

    number.appendChild(odo);
    stat.appendChild(number);
    stat.appendChild(label);
    stack.appendChild(stat);

    return { stat, odo, target: s.value };
  });

  // Helpers
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const lerp = (a,b,t) => a + (b-a)*t;

  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t){
    return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;
  }

  function clamp(x, a, b){ return Math.min(b, Math.max(a, x)); }
  // Damped “fabric hit” bounce: down impulse, overshoot, settle
  function fabricHit(u){
    // u in [0,1]
    // Make an impulse down, then damped oscillation back to 0
    const w = 10.5;              // angular frequency (tune feel)
    const d = 7.0;               // damping (higher = quicker settle)
    const impulse = -0.90 * Math.sin(Math.PI * clamp(u / 0.18, 0, 1)); // quick hit down
    const tailU = clamp((u - 0.12) / 0.88, 0, 1);
    const tail = Math.exp(-d * tailU) * Math.sin(w * tailU);
    return impulse + 0.55 * tail;
  }

  // Odometer DOM
  function makeDigitCol() {
    const digit = document.createElement("div");
    digit.className = "digit";
    const col = document.createElement("div");
    col.className = "digitCol";
    digit.appendChild(col);
    return { digit, col };
  }

  function fillDigitCol(colEl, repeats = 10) {
    colEl.innerHTML = "";
    for (let r = 0; r < repeats; r++) {
      for (let d = 0; d <= 9; d++) {
        const row = document.createElement("div");
        row.className = "digitRow";
        row.textContent = String(d);
        colEl.appendChild(row);
      }
    }
  }

  function makeDigits(odoEl, target) {
    odoEl.innerHTML = "";
    const digits = String(target).split("").map(d => parseInt(d, 10));
    const cols = digits.map(() => makeDigitCol());
    cols.forEach(c => {
      fillDigitCol(c.col, 10);
      odoEl.appendChild(c.digit);
    });
    return { digits, cols };
  }

  const odoState = lines.map(l => makeDigits(l.odo, l.target));

  function seededTurns(lineIdx, digitIdx) {
    const seed = (lineIdx + 1) * 97 + (digitIdx + 1) * 131;
    const x = Math.sin(seed) * 10000;
    const r = x - Math.floor(x);
    return Math.floor(lerp(config.roll.minTurns, config.roll.maxTurns + 1, r));
  }

  const windows = [
    { in: config.beats.s1In, rollEnd: config.beats.s1RollEnd, holdEnd: config.beats.s1HoldEnd, out: config.beats.s1Out },
    { in: config.beats.s2In, rollEnd: config.beats.s2RollEnd, holdEnd: config.beats.s2HoldEnd, out: config.beats.s2Out },
    { in: config.beats.s3In, rollEnd: config.beats.s3RollEnd, holdEnd: config.beats.s3HoldEnd, out: config.beats.s3Out }
  ];

  function fadeSlide(el, t, t0, t1, y=8) {
    const p = clamp01((t - t0) / (t1 - t0));
    const e = easeOutCubic(p);
    el.style.opacity = String(e);
    el.style.transform = `translateY(${(1 - e) * y}px)`;
  }

  function titleAccent(t) {
    // subtle pulse: scale + brightness/saturation, returns identity outside window
    const a0 = config.beats.titleAccentStart;
    const a1 = config.beats.titleAccentEnd;

    if (t < a0 || t > a1) {
      titleEl.style.filter = "none";
      return 1;
    }

    const p = clamp01((t - a0) / (a1 - a0)); // 0..1
    // bell curve pulse
    const bell = Math.sin(Math.PI * p); // 0..1..0
    const scale = 1 + 0.02 * bell;      // +2% at peak
    const bright = 1 + 0.10 * bell;     // +10% at peak
    const sat = 1 + 0.15 * bell;        // +15% at peak
    titleEl.style.filter = `brightness(${bright}) saturate(${sat})`;
    return scale;
  }

  function renderHeader(t) {
    // Title
    if (t <= config.beats.titleInStart) {
      titleEl.style.opacity = "0";
      titleEl.style.transform = "translateY(10px)";
      titleEl.style.filter = "none";
    } else {
      const scale = titleAccent(t);
      const p = clamp01((t - config.beats.titleInStart) / (config.beats.titleInEnd - config.beats.titleInStart));
      const e = easeOutCubic(p);
      titleEl.style.opacity = String(e);
      titleEl.style.transform = `translateY(${(1 - e) * 12}px) scale(${scale})`;
    }

    // Date
    if (t <= config.beats.dateInStart) {
      dateEl.style.opacity = "0";
      dateEl.style.transform = "translateY(8px)";
    } else {
      fadeSlide(dateEl, t, config.beats.dateInStart, config.beats.dateInEnd, 10);
    }

    // URL
    if (t <= config.beats.urlInStart) {
      urlEl.style.opacity = "0";
      urlEl.style.transform = "translateY(8px)";
    } else {
      fadeSlide(urlEl, t, config.beats.urlInStart, config.beats.urlInEnd, 10);
    }
  }

  function getFullHeight() {
    const frame = document.getElementById("frame");
    return frame ? frame.clientHeight : 1920;
  }

  // Full-height bar (top=0 to bottom=frame height)
  function renderAccentBar(t) {
    const fullHeight = getFullHeight();
    const p = clamp01(t / config.duration);
    const e = easeOutCubic(p);
    accentBarEl.style.height = `${Math.round(fullHeight * e)}px`;
  }

  function statVisibility(t, w) {
    if (t < w.in || t > w.out) return 0;

    if (t <= w.in + 0.22) return clamp01((t - w.in) / 0.22);
    if (t >= w.holdEnd) return 1 - clamp01((t - w.holdEnd) / (w.out - w.holdEnd));
    return 1;
  }

  function statRollProgress(t, w) {
    return clamp01((t - w.in) / (w.rollEnd - w.in));
  }

  function renderStats(t) {
    lines.forEach((ln, idx) => {
      const w = windows[idx];

      const visRaw = statVisibility(t, w);
      const vis = easeOutCubic(clamp01(visRaw));

      if (vis > 0) ln.stat.classList.add("isVisible");
      else ln.stat.classList.remove("isVisible");

      ln.stat.style.opacity = String(vis);
      ln.stat.style.transform = `translateY(${(1 - vis) * 10}px)`;

      const p = statRollProgress(t, w);
      const e = easeInOutCubic(p);

      const { digits, cols } = odoState[idx];

      cols.forEach((c, dIdx) => {
        const targetDigit = digits[dIdx];
        const turns = seededTurns(idx, dIdx);
        const totalSteps = turns * 10 + targetDigit;
        const overshootSteps = config.roll.overshoot * 10;

        const steps = e < 0.92
          ? lerp(0, totalSteps + overshootSteps, easeOutCubic(clamp01(e / 0.92)))
          : lerp(totalSteps + overshootSteps, totalSteps, easeOutCubic(clamp01((e - 0.92) / 0.08)));

        // Snap to exact integer rows (each row is exactly 1em tall)
        const snapped = Math.round(steps);
        c.col.style.transform = `translateY(${-snapped}em)`;
      });
    });
  }

function renderTheme(t) {
  if (t < config.beats.themeIn) {
    themeEl.style.opacity = "0";
    if (themeMainEl) themeMainEl.style.transform = "translateY(0px) scaleX(1) scaleY(1)";
    return;
  }

  // Fade-in theme block
  const p = clamp01((t - config.beats.themeIn) / (config.beats.themeFull - config.beats.themeIn));
  const e = easeOutCubic(p);
  themeEl.style.opacity = String(e);

  // Prefix fade-out
  if (t < config.beats.prefixOutStart) {
    themePrefixEl.style.opacity = "1";
    themePrefixEl.style.transform = "translateY(0)";
  } else {
    const q = clamp01((t - config.beats.prefixOutStart) / (config.beats.prefixOutEnd - config.beats.prefixOutStart));
    const f = 1 - easeOutCubic(q);
    themePrefixEl.style.opacity = String(f);
    themePrefixEl.style.transform = `translateY(${(1 - f) * 6}px)`;
  }

  // --- Fabric-hit bounce on theme main line ---
  if (themeMainEl) {
    const t0 = 9.283;
    const t1 = 9.513;

    // Damped hit: quick impulse down, then damped oscillation to rest
    const fabricHit = (u) => {
      // u in [0,1]
      const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

      const w = 10.5; // frequency
      const d = 7.0;  // damping

      // Fast down impulse during first ~18% of the window
      const impulsePhase = clamp(u / 0.18, 0, 1);
      const impulse = -0.90 * Math.sin(Math.PI * impulsePhase);

      // Damped oscillation tail
      const tailU = clamp((u - 0.12) / 0.88, 0, 1);
      const tail = Math.exp(-d * tailU) * Math.sin(w * tailU);

      return impulse + 0.55 * tail;
    };

    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0); // 0..1
      const b = fabricHit(u);

      // Translate in px for consistent feel (tune 22–34)
      const y = b * 28;

      // Subtle squash/stretch sells the “fabric” hit
      const mag = Math.min(1, Math.abs(b));
      const sx = 1 - mag * 0.035;
      const sy = 1 + mag * 0.060;

      themeMainEl.style.transform = `translateY(${y}px) scaleX(${sx}) scaleY(${sy})`;
    } else {
      themeMainEl.style.transform = "translateY(0px) scaleX(1) scaleY(1)";
    }
  }
}


  // Hard-reset of middle elements to avoid any initial flash
  function hardResetMiddle() {
    lines.forEach((ln) => {
      ln.stat.classList.remove("isVisible");
      ln.stat.style.opacity = "0";
      ln.stat.style.transform = "translateY(10px)";
    });

    themeEl.style.opacity = "0";
    themePrefixEl.style.opacity = "1";
    themePrefixEl.style.transform = "translateY(0)";
  }


  function showFinalHeader() {
    titleEl.style.opacity = "1";
    titleEl.style.transform = "translateY(0px) scale(1)";
    titleEl.style.filter = "none";

    dateEl.style.opacity = "1";
    dateEl.style.transform = "translateY(0px)";

    urlEl.style.opacity = "1";
    urlEl.style.transform = "translateY(0px)";
  }

  function hideStats() {
    lines.forEach((ln) => {
      ln.stat.classList.remove("isVisible");
      ln.stat.style.opacity = "0";
      ln.stat.style.transform = "translateY(10px)";
    });
  }

  function renderStillState() {
    accentBarEl.style.height = `${Math.round(getFullHeight())}px`;
    showFinalHeader();
    hideStats();

    themeEl.style.opacity = "1";
    themePrefixEl.style.opacity = "1";
    themePrefixEl.style.transform = "translateY(0)";
    if (themeMainEl) {
      themeMainEl.style.transform = "translateY(0px) scaleX(1) scaleY(1)";
    }
  }

  function renderAt(t) {
    // Clean lead-in to prevent any flash of middle content on load/first paint
    if (t < 0.20) {
      hardResetMiddle();
      renderAccentBar(t);
      renderHeader(t);
      return;
    }

    renderAccentBar(t);
    renderHeader(t);

    // During the "breath" window, freeze middle layer (no stats, no theme yet)
    if (t < config.beats.pauseStart) {
      renderStats(t);
    } else if (t < config.beats.pauseEnd) {
      // Ensure stats are fully gone during the breath (no accidental hold)
      lines.forEach((ln) => {
        ln.stat.classList.remove("isVisible");
        ln.stat.style.opacity = "0";
        ln.stat.style.transform = "translateY(10px)";
      });
    }

    renderTheme(t);
  }

  // Deterministic renderer for capture
  window.__renderAt = renderAt;
  window.__renderStill = renderStillState;
  window.__duration = config.duration;

  if (isStillMode) {
    renderStillState();
    return;
  }

  // In render mode: set the very first frame deterministically and DO NOT run the live loop
  if (isRender) {
    renderAt(0);
    return;
  }

  // Live preview (browser)
  const start = performance.now();
  function tick(now) {
    const t = (now - start) / 1000;
    renderAt(Math.min(t, config.duration));
    if (t < config.duration) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

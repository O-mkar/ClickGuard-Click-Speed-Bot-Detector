/* click-test-engine.js — state, data collection, tick loop, clock profiler */

// ── Math helpers (shared with detector) ──
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(x => (x - m) ** 2)));
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ── State ──
let running = false, sessionDone = false, startTime = 0, endTime = 0, tickTimer = null;
let clickTimes = [], clickPositions = [], lastSecondClicks = [], maxRtCps = 0;
let mouseMovements = [], lastMoveTime = 0;
let tickDrifts = [], tickCount = 0;
let clockQuantum = 0.1;
let configuredDuration = 10;
let pointerTypes = new Set();
let dominantPointerType = "mouse";

const labels = [], rtData = [], avgData = [];

// ── Clock quantum profiler ──
function measureClockQuantum() {
  const samples = [];
  let prev = performance.now();
  for (let i = 0; i < 200; i++) {
    const now = performance.now();
    const delta = now - prev;
    if (delta > 0) samples.push(delta);
    prev = now;
  }
  if (samples.length > 0) {
    samples.sort((a, b) => a - b);
    clockQuantum = samples[0];
    if (clockQuantum < 0.001) clockQuantum = 0.001;
  }
  return clockQuantum;
}

// ── DOM refs ──
const durationInput = document.getElementById("duration");
const resetBtn      = document.getElementById("resetBtn");
const clickArea     = document.getElementById("clickArea");
const timeLeftEl    = document.getElementById("timeLeftEl");

const totalClicksEl  = document.getElementById("totalClicks");
const runningCpsEl   = document.getElementById("runningCps");
const sessionCpsEl   = document.getElementById("sessionCps");
const activeCpsEl    = document.getElementById("activeCps");
const maxCpsEl       = document.getElementById("maxCps");
const avgIntervalEl  = document.getElementById("avgInterval");
const minIntervalEl  = document.getElementById("minInterval");
const statusPillEl   = document.getElementById("statusPill");
const pointerBadgeEl = document.getElementById("pointerBadge");

const caIdleEl    = document.getElementById("caIdle");
const caRunningEl = document.getElementById("caRunning");
const caDoneEl    = document.getElementById("caDone");
const countdownEl = document.getElementById("countdown");
const caClicksEl  = document.getElementById("caClicks");
const progressBarEl = document.getElementById("progressBar");

// ── Chart ──
const chart = new Chart(document.getElementById("chart"), {
  type: "line",
  data: {
    labels,
    datasets: [
      {
        label: "Live CPS", data: rtData,
        borderColor: "#20d088", backgroundColor: "rgba(32,208,136,.06)",
        fill: true, borderWidth: 2.5, pointRadius: 0, tension: 0.35
      },
      {
        label: "Avg CPS", data: avgData,
        borderColor: "#9b6bff", backgroundColor: "transparent",
        borderDash: [5, 3], borderWidth: 2, pointRadius: 0, tension: 0.35
      }
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: {
      legend: { labels: { color: "#7d99bc", font: { size: 11 }, boxWidth: 16 } },
      tooltip: { mode: "index", intersect: false }
    },
    scales: {
      x: {
        ticks: { color: "#5e7a9a", maxTicksLimit: 7, font: { size: 10 } },
        grid: { color: "rgba(255,255,255,.045)" },
        title: { display: true, text: "Time (s)", color: "#5e7a9a", font: { size: 10 } }
      },
      y: {
        beginAtZero: true, suggestedMax: 12,
        ticks: { color: "#5e7a9a", font: { size: 10 } },
        grid: { color: "rgba(255,255,255,.045)" },
        title: { display: true, text: "CPS", color: "#5e7a9a", font: { size: 10 } }
      }
    }
  }
});

// ── Status pill ──
function setStatus(state) {
  const map = {
    idle:     ["Idle", ""],
    running:  ["Running", "running"],
    finished: ["Finished", "finished"]
  };
  const [label, cls] = map[state];
  statusPillEl.className = "pill " + cls;
  statusPillEl.innerHTML = cls === "running"
    ? `<span class="dot"></span>${label}` : label;
}

// ── Reset ──
function resetAll() {
  running = false; sessionDone = false; startTime = 0; endTime = 0; maxRtCps = 0;
  clickTimes = []; clickPositions = []; mouseMovements = []; lastMoveTime = 0;
  lastSecondClicks = []; tickDrifts = []; tickCount = 0;
  pointerTypes = new Set(); dominantPointerType = "mouse";
  clearInterval(tickTimer); tickTimer = null;

  labels.length = 0; rtData.length = 0; avgData.length = 0;
  chart.update();

  totalClicksEl.textContent  = "0";
  runningCpsEl.textContent   = "0.0";
  sessionCpsEl.textContent   = "0.0";
  activeCpsEl.textContent    = "0.0";
  maxCpsEl.textContent       = "0.0";
  avgIntervalEl.textContent  = "—";
  minIntervalEl.textContent  = "";
  progressBarEl.style.width  = "0%";
  const dur = Math.max(1, Number(durationInput.value || 10));
  timeLeftEl.innerHTML = `${dur}<span class="unit">s</span>`;
  setStatus("idle");
  pointerBadgeEl.textContent = "";
  pointerBadgeEl.style.display = "none";

  clickArea.classList.remove("active", "done");
  caIdleEl.style.display    = "";
  caRunningEl.style.display = "none";
  caDoneEl.style.display    = "none";

  const verdictCardEl      = document.getElementById("verdictCard");
  const domainBreakdownEl  = document.getElementById("domainBreakdown");
  const signalsWrapEl      = document.getElementById("signalsWrap");
  const footerNoteEl       = document.getElementById("footerNote");
  const idleHintEl         = document.getElementById("idleHint");
  const clockProfileEl     = document.getElementById("clockProfile");
  const diagPanelEl        = document.getElementById("diagPanel");

  verdictCardEl.style.display     = "none";
  domainBreakdownEl.style.display = "none";
  signalsWrapEl.style.display     = "none";
  footerNoteEl.style.display      = "none";
  idleHintEl.style.display        = "";
  clockProfileEl.style.display    = "none";
  if (diagPanelEl) diagPanelEl.style.display = "none";
}

// ── Start ──
function start() {
  configuredDuration = Math.max(1, Number(durationInput.value || 10));
  measureClockQuantum();

  running = true;
  sessionDone = false;
  startTime = performance.now();
  endTime   = startTime + configuredDuration * 1000;
  tickCount = 0;
  tickDrifts = [];
  setStatus("running");

  clickArea.classList.add("active");
  caIdleEl.style.display    = "none";
  caRunningEl.style.display = "";
  countdownEl.textContent   = configuredDuration;
  caClicksEl.textContent    = "0 clicks";

  tickTimer = setInterval(tick, 100);
  setTimeout(() => { if (running) finish(); }, configuredDuration * 1000 + 60);
}

// ── Tick ──
function tick() {
  tickCount++;
  const now      = performance.now();
  const elapsed  = now - startTime;
  const total    = endTime - startTime;
  const elapsedS = Math.max(0.001, elapsed / 1000);

  const expectedTime = startTime + tickCount * 100;
  tickDrifts.push(now - expectedTime);

  while (lastSecondClicks.length && (now - lastSecondClicks[0]) > 1000)
    lastSecondClicks.shift();

  const rtCps     = lastSecondClicks.length;
  const sessCps   = clickTimes.length / configuredDuration;
  const elapsedAvgCps = clickTimes.length / elapsedS;
  const activeCps = clickTimes.length >= 2
    ? (clickTimes.length - 1) / ((clickTimes[clickTimes.length - 1] - clickTimes[0]) / 1000)
    : 0;
  maxRtCps = Math.max(maxRtCps, rtCps);

  totalClicksEl.textContent = clickTimes.length;
  runningCpsEl.textContent  = rtCps.toFixed(1);
  sessionCpsEl.textContent  = sessCps.toFixed(1);
  activeCpsEl.textContent   = activeCps.toFixed(1);
  maxCpsEl.textContent      = maxRtCps.toFixed(1);

  if (clickTimes.length >= 2) {
    const intervals = [];
    for (let i = 1; i < clickTimes.length; i++) intervals.push(clickTimes[i] - clickTimes[i - 1]);
    const m = mean(intervals);
    const minDt = Math.min(...intervals);
    avgIntervalEl.innerHTML   = `${m.toFixed(0)}<span class="unit">ms</span>`;
    minIntervalEl.textContent = `min ${minDt.toFixed(0)} ms`;
  }

  progressBarEl.style.width = Math.min(100, (elapsed / total) * 100) + "%";
  const secsLeft = Math.max(0, Math.ceil((endTime - now) / 1000));
  countdownEl.textContent = secsLeft;
  timeLeftEl.innerHTML    = `${secsLeft}<span class="unit">s</span>`;
  caClicksEl.textContent  = clickTimes.length + " click" + (clickTimes.length !== 1 ? "s" : "");

  labels.push((elapsed / 1000).toFixed(1));
  rtData.push(+rtCps.toFixed(2));
  avgData.push(+elapsedAvgCps.toFixed(2));
  if (labels.length > 300) { labels.shift(); rtData.shift(); avgData.shift(); }
  chart.update();

  if (now >= endTime) finish();
}

// ── Finish ──
function finish() {
  running = false;
  sessionDone = true;
  clearInterval(tickTimer); tickTimer = null;
  progressBarEl.style.width = "100%";
  timeLeftEl.innerHTML      = `0<span class="unit">s</span>`;
  setStatus("finished");

  clickArea.classList.remove("active");
  clickArea.classList.add("done");
  caRunningEl.style.display = "none";
  caDoneEl.style.display    = "";
  document.getElementById("idleHint").style.display = "none";

  if (pointerTypes.size > 0) {
    const counts = {};
    for (const pt of pointerTypes) counts[pt] = (counts[pt] || 0) + 1;
    dominantPointerType = [...pointerTypes][0];
    pointerBadgeEl.textContent = dominantPointerType;
    pointerBadgeEl.style.display = "";
  }

  runDetector();
}

// ── Click handler ──
function onUserClick(e) {
  if (sessionDone) return;
  if (!running) start();

  const t = performance.now();
  clickTimes.push(t);
  lastSecondClicks.push(t);

  if (e.pointerType) pointerTypes.add(e.pointerType);
  else if (e.type === "touchstart") pointerTypes.add("touch");
  else pointerTypes.add("mouse");

  const rect = clickArea.getBoundingClientRect();
  const cx = e.clientX ?? (e.touches?.[0]?.clientX ?? rect.left + rect.width / 2);
  const cy = e.clientY ?? (e.touches?.[0]?.clientY ?? rect.top  + rect.height / 2);
  const rx = cx - rect.left, ry = cy - rect.top;
  clickPositions.push({ x: rx, y: ry });
  addRipple(rx, ry);
}

function addRipple(x, y) {
  const r = document.createElement("span");
  r.className = "ripple";
  r.style.cssText = `left:${x}px;top:${y}px;width:44px;height:44px;margin-left:-22px;margin-top:-22px`;
  clickArea.appendChild(r);
  setTimeout(() => r.remove(), 650);
}

// ── Mouse dynamics tracking (~60 fps) ──
function onPointerMove(e) {
  if (!running) return;
  const now = performance.now();
  if (now - lastMoveTime < 16) return;
  lastMoveTime = now;
  const rect = clickArea.getBoundingClientRect();
  const cx = e.clientX ?? (e.touches?.[0]?.clientX ?? null);
  const cy = e.clientY ?? (e.touches?.[0]?.clientY ?? null);
  if (cx === null) return;
  mouseMovements.push({ x: cx - rect.left, y: cy - rect.top, t: now });
}

// ── Events ──
resetBtn.addEventListener("click", resetAll);
clickArea.addEventListener("mousedown", e => { e.preventDefault(); onUserClick(e); });
clickArea.addEventListener("touchstart", e => { e.preventDefault(); onUserClick(e); }, { passive: false });
clickArea.addEventListener("mousemove", onPointerMove);
clickArea.addEventListener("touchmove", onPointerMove, { passive: true });
durationInput.addEventListener("input", () => {
  if (!running && !sessionDone) {
    const s = Math.max(1, Number(durationInput.value || 10));
    timeLeftEl.innerHTML = `${s}<span class="unit">s</span>`;
  }
});

resetAll();

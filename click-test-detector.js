/* click-test-detector.js — 14 signals, dual scoring, confidence, diagnostics */

// ── DOM refs for results ──
const verdictCardEl     = document.getElementById("verdictCard");
const vcVerdictEl       = document.getElementById("vcVerdict");
const vcSubEl           = document.getElementById("vcSub");
const autoScoreNumEl    = document.getElementById("autoScoreNum");
const autoScoreBarEl    = document.getElementById("autoScoreBar");
const humanScoreNumEl   = document.getElementById("humanScoreNum");
const humanScoreBarEl   = document.getElementById("humanScoreBar");
const domainBreakdownEl = document.getElementById("domainBreakdown");
const domainListEl      = document.getElementById("domainList");
const signalsWrapEl     = document.getElementById("signalsWrap");
const signalListEl      = document.getElementById("signalList");
const footerNoteEl      = document.getElementById("footerNote");
const clockProfileEl    = document.getElementById("clockProfile");
const cpQuantumEl       = document.getElementById("cpQuantum");
const cpFracDistEl      = document.getElementById("cpFracDist");

// ── Diagnostic chart instances ──
let histChart = null, acChart = null, specChart = null;

// ── Helpers ──
function confidence(n, minLow, minMed) {
  if (n < (minLow || 20)) return 0.3;
  if (n < (minMed || 50)) return 0.6;
  return 1.0;
}
function confClass(c) {
  return c >= 1 ? "high" : c >= 0.6 ? "med" : "";
}

function trimmed(arr, pct) {
  if (arr.length < 4) return arr.slice();
  const sorted = arr.slice().sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(sorted.length * pct));
  return sorted.slice(cut, sorted.length - cut);
}

function freedmanDiaconisBinWidth(arr) {
  if (arr.length < 4) return 5;
  const sorted = arr.slice().sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  if (iqr <= 0) return 5;
  return Math.max(0.5, 2 * iqr * Math.pow(sorted.length, -1 / 3));
}

function excessKurtosis(arr) {
  if (arr.length < 4) return 0;
  const m = mean(arr), s = std(arr);
  if (s < 1e-9) return 0;
  const n = arr.length;
  const sum4 = arr.reduce((a, x) => a + ((x - m) / s) ** 4, 0);
  return (sum4 / n) - 3;
}

// ── Main Detector ──
function runDetector() {
  const n = clickTimes.length;

  if (n < 15) {
    verdictCardEl.style.display = "flex";
    vcVerdictEl.textContent = "Not enough data";
    vcVerdictEl.className   = "vc-verdict warn";
    vcSubEl.textContent     = `Only ${n} click${n !== 1 ? "s" : ""} — need at least 15`;
    autoScoreNumEl.textContent  = "—";
    autoScoreNumEl.className    = "score-num";
    autoScoreBarEl.style.width  = "0%";
    humanScoreNumEl.textContent = "—";
    humanScoreNumEl.className   = "score-num";
    humanScoreBarEl.style.width = "0%";
    return;
  }

  const dt = [];
  for (let i = 1; i < n; i++) dt.push(clickTimes[i] - clickTimes[i - 1]);
  const nd = dt.length;
  const m  = mean(dt);
  const s  = std(dt);

  const isTouch = dominantPointerType === "touch";
  const mouseDisabled = isTouch || mouseMovements.length < 10;

  // ── Clock Profile ──
  clockProfileEl.style.display = "";
  cpQuantumEl.textContent = clockQuantum.toFixed(3) + " ms";
  const fracBuckets = new Array(10).fill(0);
  for (const d of dt) {
    const frac = d - Math.floor(d);
    fracBuckets[Math.min(9, Math.floor(frac * 10))]++;
  }
  const maxFB = Math.max(1, ...fracBuckets);
  cpFracDistEl.innerHTML = fracBuckets.map(c =>
    `<span style="height:${Math.round((c / maxFB) * 14)}px"></span>`
  ).join("");

  // ══════════════════════════════════════════════
  //  SIGNAL 1: Superhuman Speed (18 pts) — Automation
  // ══════════════════════════════════════════════
  const sessionCps = n / configuredDuration;
  const clickSpan  = (clickTimes[n - 1] - clickTimes[0]) / 1000;
  const activeCps  = clickSpan > 0 ? (n - 1) / clickSpan : 0;
  const totalDur   = configuredDuration;

  const sf = totalDur >= 15 ? 0.65
           : totalDur >= 10 ? 0.75
           : totalDur >= 5  ? 0.85 : 1.0;

  let hsPts, hsRisk, speedOverride = false;
  if      (sessionCps > 24) { hsPts = 18; hsRisk = "bad"; speedOverride = true; }
  else if (sessionCps > 20 * sf) { hsPts = 16; hsRisk = "bad"; }
  else if (sessionCps > 16 * sf) { hsPts = 12; hsRisk = "bad"; }
  else if (sessionCps > 12 * sf) { hsPts = 6;  hsRisk = "warn"; }
  else if (sessionCps > 9  * sf) { hsPts = 2;  hsRisk = "warn"; }
  else                           { hsPts = 0;  hsRisk = "ok"; }

  let peakWindowCps = 0;
  for (let i = 0; i < n; i++) {
    let cnt = 0;
    for (let j = i; j < n && clickTimes[j] - clickTimes[i] <= 1000; j++) cnt++;
    if (cnt > peakWindowCps) peakWindowCps = cnt;
  }
  const hsConf = confidence(n, 15, 30);

  // ══════════════════════════════════════════════
  //  SIGNAL 2: CV — Trimmed (7 pts) — Automation
  // ══════════════════════════════════════════════
  const rawCV = m > 0 ? s / m : 0;
  const trimmedDt = trimmed(dt, 0.05);
  const trimM = mean(trimmedDt);
  const trimS = std(trimmedDt);
  const trimCV = trimM > 0 ? trimS / trimM : 0;

  let cvPts, cvRisk;
  if      (trimCV < 0.03) { cvPts = 7; cvRisk = "bad"; }
  else if (trimCV < 0.06) { cvPts = 5; cvRisk = "bad"; }
  else if (trimCV < 0.10) { cvPts = 2; cvRisk = "warn"; }
  else if (trimCV < 0.16) { cvPts = 1; cvRisk = "warn"; }
  else                    { cvPts = 0; cvRisk = "ok"; }
  const cvConf = confidence(nd, 20, 50);

  // ══════════════════════════════════════════════
  //  SIGNAL 3: Repeat Ratio — clockQuantum tol (7 pts) — Automation
  // ══════════════════════════════════════════════
  const repeatTol = Math.max(clockQuantum, 0.5);
  let repeats = 0;
  for (let i = 1; i < nd; i++) {
    if (Math.abs(dt[i] - dt[i - 1]) <= repeatTol) repeats++;
  }
  const repeatRatio = nd > 1 ? repeats / (nd - 1) : 0;
  let rrPts, rrRisk;
  if      (repeatRatio > 0.55) { rrPts = 7; rrRisk = "bad"; }
  else if (repeatRatio > 0.35) { rrPts = 4; rrRisk = "bad"; }
  else if (repeatRatio > 0.18) { rrPts = 2; rrRisk = "warn"; }
  else                         { rrPts = 0; rrRisk = "ok"; }
  const rrConf = confidence(nd, 20, 50);

  // ══════════════════════════════════════════════
  //  SIGNAL 4: Shannon Entropy — Freedman-Diaconis (6 pts) — Automation
  // ══════════════════════════════════════════════
  const binW = freedmanDiaconisBinWidth(dt);
  const bins = {};
  for (const d of dt) { const b = Math.floor(d / binW); bins[b] = (bins[b] || 0) + 1; }
  const probs = Object.values(bins).map(c => c / nd);
  const rawH  = -probs.reduce((a, p) => a + p * Math.log2(p + 1e-12), 0);
  const nBins = Object.keys(bins).length;
  const normH = nBins > 1 ? rawH / Math.log2(nBins) : 0;

  let entPts, entRisk;
  if      (normH < 0.12) { entPts = 6; entRisk = "bad"; }
  else if (normH < 0.30) { entPts = 4; entRisk = "bad"; }
  else if (normH < 0.50) { entPts = 1; entRisk = "warn"; }
  else                   { entPts = 0; entRisk = "ok"; }
  const entConf = confidence(nd, 20, 50);

  // ══════════════════════════════════════════════
  //  SIGNAL 5: Multi-Lag Autocorrelation (5 pts) — Automation
  // ══════════════════════════════════════════════
  const maxLag = Math.min(10, nd - 1);
  let maxAC = 0, maxACLag = 1;
  const acValues = [];
  for (let lag = 1; lag <= maxLag; lag++) {
    if (s < 0.001) {
      acValues.push(1);
      maxAC = 1; maxACLag = lag;
      continue;
    }
    let num = 0;
    for (let i = 0; i < nd - lag; i++) num += (dt[i] - m) * (dt[i + lag] - m);
    const ac = clamp(num / ((nd - lag) * s * s), -1, 1);
    acValues.push(ac);
    if (Math.abs(ac) > Math.abs(maxAC)) { maxAC = ac; maxACLag = lag; }
  }
  const absMaxAC = Math.abs(maxAC);
  let acPts, acRisk;
  if      (absMaxAC > 0.85) { acPts = 5; acRisk = "bad"; }
  else if (absMaxAC > 0.65) { acPts = 3; acRisk = "bad"; }
  else if (absMaxAC > 0.40) { acPts = 1; acRisk = "warn"; }
  else                      { acPts = 0; acRisk = "ok"; }
  const acConf = confidence(nd, 30, 80);

  // ══════════════════════════════════════════════
  //  SIGNAL 6: Spectral Peak — Hann window DFT (8 pts) — Automation
  // ══════════════════════════════════════════════
  const centered = dt.map((d, i) => {
    const hann = 0.5 * (1 - Math.cos(2 * Math.PI * i / (nd - 1)));
    return (d - m) * hann;
  });
  let maxPow = 0, totalPow = 0, peakK = 0;
  const halfN = Math.floor(nd / 2);
  const specMag = [];
  for (let k = 1; k <= halfN; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < nd; i++) {
      const ang = 2 * Math.PI * k * i / nd;
      re += centered[i] * Math.cos(ang);
      im -= centered[i] * Math.sin(ang);
    }
    const pow = re * re + im * im;
    specMag.push(Math.sqrt(pow));
    totalPow += pow;
    if (pow > maxPow) { maxPow = pow; peakK = k; }
  }
  const peakRatio = totalPow > 0 ? maxPow / totalPow : 0;
  const meanIntervalSec = m / 1000;
  const peakFreqHz = (meanIntervalSec > 0 && nd > 0)
    ? peakK / (nd * meanIntervalSec) : 0;

  let spPts, spRisk;
  if      (peakRatio > 0.55) { spPts = 8; spRisk = "bad"; }
  else if (peakRatio > 0.40) { spPts = 5; spRisk = "bad"; }
  else if (peakRatio > 0.25) { spPts = 2; spRisk = "warn"; }
  else                       { spPts = 0; spRisk = "ok"; }
  const spConf = confidence(nd, 30, 100);

  // ══════════════════════════════════════════════
  //  SIGNAL 7: Click Position — Exact Repetition Rate (5 pts) — Human-likeness (inverted)
  // ══════════════════════════════════════════════
  let coordRepeatRate = 0, uniquePixels = 0, posPts = 0, posRisk = "ok", posConf = 0.3;
  if (!mouseDisabled && clickPositions.length >= 10) {
    const pixelSet = new Set();
    const pixelCounts = {};
    for (const p of clickPositions) {
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      pixelSet.add(key);
      pixelCounts[key] = (pixelCounts[key] || 0) + 1;
    }
    uniquePixels = pixelSet.size;
    let exactRepeats = 0;
    for (const c of Object.values(pixelCounts)) {
      if (c > 1) exactRepeats += (c - 1);
    }
    coordRepeatRate = exactRepeats / clickPositions.length;

    if      (coordRepeatRate > 0.60) { posPts = 5; posRisk = "bad"; }
    else if (coordRepeatRate > 0.35) { posPts = 3; posRisk = "bad"; }
    else if (coordRepeatRate > 0.15) { posPts = 1; posRisk = "warn"; }
    else                             { posPts = 0; posRisk = "ok"; }
    posConf = confidence(clickPositions.length, 10, 30);
  } else if (mouseDisabled) {
    posRisk = "na";
  }

  // ══════════════════════════════════════════════
  //  SIGNAL 8: Micro-Jitter — Direction Changes (7 pts) — Human-likeness (inverted)
  // ══════════════════════════════════════════════
  let dirChangeRate = 0, mjPts = 0, mjRisk = "ok", mjConf = 0.3;
  if (!mouseDisabled && mouseMovements.length >= 10) {
    let dirChanges = 0, segments = 0;
    for (let i = 2; i < mouseMovements.length; i++) {
      const dx1 = mouseMovements[i - 1].x - mouseMovements[i - 2].x;
      const dy1 = mouseMovements[i - 1].y - mouseMovements[i - 2].y;
      const dx2 = mouseMovements[i].x - mouseMovements[i - 1].x;
      const dy2 = mouseMovements[i].y - mouseMovements[i - 1].y;
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      if (len1 > 0.01 && len2 > 0.01) {
        const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
        const angle = Math.acos(clamp(dot, -1, 1));
        if (angle > 0.3) dirChanges++;
        segments++;
      }
    }
    dirChangeRate = segments > 0 ? dirChanges / segments : 0;

    if      (dirChangeRate < 0.05) { mjPts = 7; mjRisk = "bad"; }
    else if (dirChangeRate < 0.15) { mjPts = 4; mjRisk = "bad"; }
    else if (dirChangeRate < 0.30) { mjPts = 1; mjRisk = "warn"; }
    else                           { mjPts = 0; mjRisk = "ok"; }
    mjConf = confidence(mouseMovements.length, 20, 80);
  } else if (mouseDisabled) {
    mjRisk = "na";
  }

  // ══════════════════════════════════════════════
  //  SIGNAL 9: Pre-Click Movement (8 pts) — Human-likeness (inverted)
  // ══════════════════════════════════════════════
  let preClickAvgDisp = 0, mpPts = 0, mpRisk = "ok", mpConf = 0.3;
  if (!mouseDisabled && mouseMovements.length >= 5 && clickTimes.length >= 5) {
    const disps = [];
    for (const ct of clickTimes) {
      let totalDisp = 0, count = 0;
      for (let j = mouseMovements.length - 1; j >= 0; j--) {
        const mv = mouseMovements[j];
        if (mv.t > ct) continue;
        if (ct - mv.t > 200) break;
        if (j > 0) {
          const prev = mouseMovements[j - 1];
          const dx = mv.x - prev.x, dy = mv.y - prev.y;
          totalDisp += Math.sqrt(dx * dx + dy * dy);
          count++;
        }
      }
      disps.push(count > 0 ? totalDisp / count : 0);
    }
    preClickAvgDisp = mean(disps);

    if      (preClickAvgDisp < 0.05)  { mpPts = 8; mpRisk = "bad"; }
    else if (preClickAvgDisp < 0.3)   { mpPts = 4; mpRisk = "bad"; }
    else if (preClickAvgDisp < 0.8)   { mpPts = 1; mpRisk = "warn"; }
    else                              { mpPts = 0; mpRisk = "ok"; }
    mpConf = confidence(Math.min(mouseMovements.length, clickTimes.length), 10, 40);
  } else if (mouseDisabled) {
    mpRisk = "na";
  }

  // ══════════════════════════════════════════════
  //  SIGNAL 10: Acceleration CV (5 pts) — Human-likeness (inverted)
  // ══════════════════════════════════════════════
  let accelCV = 0, vvPts = 0, vvRisk = "ok", vvConf = 0.3;
  if (!mouseDisabled && mouseMovements.length >= 12) {
    const vels = [];
    for (let i = 1; i < mouseMovements.length; i++) {
      const dx = mouseMovements[i].x - mouseMovements[i - 1].x;
      const dy = mouseMovements[i].y - mouseMovements[i - 1].y;
      const dtm = mouseMovements[i].t - mouseMovements[i - 1].t;
      if (dtm > 0) vels.push(Math.sqrt(dx * dx + dy * dy) / dtm);
    }
    const accels = [];
    for (let i = 1; i < vels.length; i++) accels.push(Math.abs(vels[i] - vels[i - 1]));

    const am = mean(accels);
    accelCV = am > 0 ? std(accels) / am : 0;

    if      (accelCV < 0.05) { vvPts = 5; vvRisk = "bad"; }
    else if (accelCV < 0.20) { vvPts = 3; vvRisk = "bad"; }
    else if (accelCV < 0.50) { vvPts = 1; vvRisk = "warn"; }
    else                     { vvPts = 0; vvRisk = "ok"; }
    vvConf = confidence(mouseMovements.length, 20, 80);
  } else if (mouseDisabled) {
    vvRisk = "na";
  }

  // ══════════════════════════════════════════════
  //  SIGNAL 11: Digit Uniformity — Timer Artifact (5 pts) — Automation
  // ══════════════════════════════════════════════
  const digitCounts = new Array(10).fill(0);
  for (const d of dt) digitCounts[Math.floor(Math.abs(d)) % 10]++;
  const expected = nd / 10;
  const chi2 = digitCounts.reduce((a, o) => a + (o - expected) ** 2 / expected, 0);
  const reducedChi2 = chi2 / 9;

  const dgMaxPts = clockQuantum >= 1 ? 2 : 5;
  let dgPts, dgRisk;
  if      (reducedChi2 > 10) { dgPts = dgMaxPts; dgRisk = "bad"; }
  else if (reducedChi2 > 5)  { dgPts = Math.min(3, dgMaxPts); dgRisk = "bad"; }
  else if (reducedChi2 > 2.5){ dgPts = Math.min(1, dgMaxPts); dgRisk = "warn"; }
  else                       { dgPts = 0; dgRisk = "ok"; }
  const dgConf = confidence(nd, 20, 50);

  const digitMax = Math.max(1, ...digitCounts);
  const digitSparkHtml = digitCounts.map(c =>
    `<span style="height:${Math.round((c / digitMax) * 14)}px"></span>`
  ).join("");

  // ══════════════════════════════════════════════
  //  SIGNAL 12: Burstiness + Rolling Stability (5 pts) — Human-likeness (inverted)
  // ══════════════════════════════════════════════
  const B = (s + m) > 0 ? (s - m) / (s + m) : 0;
  let rollingBStd = 0;
  if (nd >= 10) {
    const windowSize = Math.min(20, Math.floor(nd / 2));
    const rollingBs = [];
    for (let i = 0; i <= nd - windowSize; i++) {
      const win = dt.slice(i, i + windowSize);
      const wm = mean(win), ws = std(win);
      if (wm + ws > 0) rollingBs.push((ws - wm) / (ws + wm));
    }
    if (rollingBs.length > 1) rollingBStd = std(rollingBs);
  }

  let buPts, buRisk;
  if      (B < -0.80) { buPts = 5; buRisk = "bad"; }
  else if (B < -0.60) { buPts = 3; buRisk = "bad"; }
  else if (B < -0.40) { buPts = 1; buRisk = "warn"; }
  else                { buPts = 0; buRisk = "ok"; }
  if (rollingBStd < 0.01 && nd >= 20 && buPts < 3) { buPts = Math.min(buPts + 2, 5); }
  const buConf = confidence(nd, 20, 50);

  // ══════════════════════════════════════════════
  //  SIGNAL 13: Excess Kurtosis (7 pts) — Human-likeness (inverted)
  // ══════════════════════════════════════════════
  const kurt = excessKurtosis(dt);
  let kuPts, kuRisk;
  if      (Math.abs(kurt) < 0.3) { kuPts = 7; kuRisk = "bad"; }
  else if (Math.abs(kurt) < 0.8) { kuPts = 3; kuRisk = "warn"; }
  else if (Math.abs(kurt) < 1.5) { kuPts = 1; kuRisk = "warn"; }
  else                           { kuPts = 0; kuRisk = "ok"; }
  const kuConf = confidence(nd, 30, 80);

  // ══════════════════════════════════════════════
  //  SIGNAL 14: Sub-ms Jitter — Timer Artifact (7 pts) — Automation
  // ══════════════════════════════════════════════
  const fracs = dt.map(d => d - Math.floor(d));
  const fracStd = std(fracs);
  const jMaxPts = clockQuantum >= 1 ? 2 : 7;

  let jPts, jRisk;
  if      (fracStd < 0.03) { jPts = jMaxPts; jRisk = "bad"; }
  else if (fracStd < 0.08) { jPts = Math.min(4, jMaxPts); jRisk = "bad"; }
  else if (fracStd < 0.15) { jPts = Math.min(2, jMaxPts); jRisk = "warn"; }
  else                     { jPts = 0; jRisk = "ok"; }
  const jConf = confidence(nd, 20, 50);

  const jFracBuckets = new Array(10).fill(0);
  for (const f of fracs) jFracBuckets[Math.min(9, Math.floor(f * 10))]++;
  const fracMax = Math.max(1, ...jFracBuckets);
  const fracSparkHtml = jFracBuckets.map(c =>
    `<span style="height:${Math.round((c / fracMax) * 14)}px"></span>`
  ).join("");

  // ══════════════════════════════════════════════
  //  DUAL SCORING
  // ══════════════════════════════════════════════
  const autoSignals  = [
    { pts: hsPts, max: 18 },
    { pts: cvPts, max: 7 },
    { pts: rrPts, max: 7 },
    { pts: entPts, max: 6 },
    { pts: acPts, max: 5 },
    { pts: spPts, max: 8 },
    { pts: dgPts, max: dgMaxPts },
    { pts: jPts,  max: jMaxPts }
  ];
  const humanSignals = [
    { pts: posPts, max: mouseDisabled ? 0 : 5 },
    { pts: mjPts,  max: mouseDisabled ? 0 : 7 },
    { pts: mpPts,  max: mouseDisabled ? 0 : 8 },
    { pts: vvPts,  max: mouseDisabled ? 0 : 5 },
    { pts: buPts,  max: 5 },
    { pts: kuPts,  max: 7 }
  ];

  const autoRawPts = autoSignals.reduce((a, s) => a + s.pts, 0);
  const autoMaxPts = autoSignals.reduce((a, s) => a + s.max, 0);
  const humanRawPts = humanSignals.reduce((a, s) => a + s.pts, 0);
  const humanMaxPts = humanSignals.reduce((a, s) => a + s.max, 0);

  const autoScore  = autoMaxPts > 0 ? Math.round((autoRawPts / autoMaxPts) * 100) : 0;
  const humanScore = humanMaxPts > 0
    ? Math.round(100 - (humanRawPts / humanMaxPts) * 100)
    : 50;

  // ── Verdict ──
  let verdict, vClass, sub;
  if (speedOverride) {
    verdict = "BOT — Superhuman Speed";
    vClass  = "bad";
    sub     = `${sessionCps.toFixed(1)} CPS over ${totalDur}s is physically impossible — instant bot verdict`;
  } else if (autoScore >= 60) {
    verdict = "Likely BOT / Autoclicker";
    vClass  = "bad";
    sub     = "High automation score — timing regularity + spectral periodicity = machine behavior";
  } else if (autoScore >= 30 && humanScore < 40) {
    verdict = "Borderline — Possibly Tool-Assisted";
    vClass  = "warn";
    sub     = "Moderate automation signals with low human-likeness — could be jitter-randomized bot";
  } else if (autoScore >= 30) {
    verdict = "Borderline — Some Suspicious Patterns";
    vClass  = "warn";
    sub     = "Some automation signals detected, but human-likeness is present";
  } else {
    verdict = "Likely Human";
    vClass  = "ok";
    sub     = "Natural variability, organic timing, and cursor dynamics — looks human";
  }

  const effectiveAutoScore = speedOverride ? Math.max(autoScore, 90) : autoScore;
  const scoreClass = c => c >= 60 ? "bad" : c >= 30 ? "warn" : "ok";
  const scoreColor = c => c >= 60 ? "#ff4f6e" : c >= 30 ? "#ffc233" : "#20d088";
  const humanClass = c => c >= 60 ? "ok" : c >= 30 ? "warn" : "bad";
  const humanColor = c => c >= 60 ? "#20d088" : c >= 30 ? "#ffc233" : "#ff4f6e";

  verdictCardEl.style.display = "flex";
  vcVerdictEl.textContent     = verdict;
  vcVerdictEl.className       = "vc-verdict " + vClass;
  vcSubEl.textContent         = sub;

  autoScoreNumEl.textContent  = effectiveAutoScore;
  autoScoreNumEl.className    = "score-num " + scoreClass(effectiveAutoScore);
  autoScoreBarEl.style.width  = effectiveAutoScore + "%";
  autoScoreBarEl.style.background = scoreColor(effectiveAutoScore);

  humanScoreNumEl.textContent = humanScore;
  humanScoreNumEl.className   = "score-num " + humanClass(humanScore);
  humanScoreBarEl.style.width = humanScore + "%";
  humanScoreBarEl.style.background = humanColor(humanScore);

  // ── Domain totals ──
  const domains = [
    { name: "Physical Limits",   pts: hsPts, max: 18 },
    { name: "Time-Domain",       pts: cvPts + rrPts + entPts, max: 20 },
    { name: "Frequency",         pts: acPts + spPts, max: 13 },
    { name: "Mouse Dynamics",    pts: posPts + mjPts + mpPts + vvPts, max: mouseDisabled ? 0 : 25 },
    { name: "Timer Environment", pts: dgPts + jPts, max: dgMaxPts + jMaxPts },
    { name: "Distribution",      pts: buPts + kuPts, max: 12 }
  ];

  function domRisk(pts, max) {
    const pct = max > 0 ? pts / max : 0;
    return pct >= 0.5 ? "bad" : pct >= 0.2 ? "warn" : "ok";
  }
  function domColor(risk) {
    return risk === "bad" ? "#ff4f6e" : risk === "warn" ? "#ffc233" : "#20d088";
  }

  domainListEl.innerHTML = domains.map(d => {
    if (d.max === 0) return `
      <div class="domain-row">
        <div class="dom-name">${d.name}</div>
        <div class="dom-bar-wrap"><div class="dom-bar" style="width:0%"></div></div>
        <div class="dom-score" style="color:var(--muted)">n/a</div>
      </div>`;
    const risk = domRisk(d.pts, d.max);
    const pct  = (d.pts / d.max * 100);
    return `
      <div class="domain-row">
        <div class="dom-name">${d.name}</div>
        <div class="dom-bar-wrap">
          <div class="dom-bar" style="width:${pct}%;background:${domColor(risk)}"></div>
        </div>
        <div class="dom-score ${risk}">${d.pts}/${d.max}</div>
      </div>`;
  }).join("");
  domainBreakdownEl.style.display = "";

  // ── Signal detail ──
  const naLabel = (risk) => risk === "na";
  const signals = [
    { cat: "PHYSICAL LIMITS" },
    {
      name: "Superhuman Speed",
      hint: `session ${sessionCps.toFixed(1)} CPS · active ${activeCps.toFixed(1)} CPS · peak ${peakWindowCps} CPS/s · override > 24 absolute`,
      val: sessionCps.toFixed(1) + " CPS", pts: hsPts, max: 18, risk: hsRisk, conf: hsConf
    },
    { cat: "TIME-DOMAIN" },
    {
      name: "CV — Interval Regularity",
      hint: `raw ${rawCV.toFixed(4)} · trimmed(5%) ${trimCV.toFixed(4)}`,
      val: trimCV.toFixed(4), pts: cvPts, max: 7, risk: cvRisk, conf: cvConf
    },
    {
      name: `Repeat Ratio (±${repeatTol.toFixed(1)} ms)`,
      hint: `tolerance based on clock quantum ${clockQuantum.toFixed(3)}ms`,
      val: repeatRatio.toFixed(4), pts: rrPts, max: 7, risk: rrRisk, conf: rrConf
    },
    {
      name: "Shannon Entropy (adaptive bins)",
      hint: `Freedman-Diaconis bin width ${binW.toFixed(1)}ms · ${nBins} bins`,
      val: normH.toFixed(4), pts: entPts, max: 6, risk: entRisk, conf: entConf
    },
    { cat: "FREQUENCY" },
    {
      name: "Multi-Lag Autocorrelation",
      hint: `max |r| at lag ${maxACLag} of ${maxLag} lags`,
      val: maxAC.toFixed(4), pts: acPts, max: 5, risk: acRisk, conf: acConf
    },
    {
      name: "Spectral Peak (Hann DFT)",
      hint: `peak freq ${peakFreqHz.toFixed(2)} Hz (click rhythm)`,
      val: peakRatio.toFixed(4), pts: spPts, max: 8, risk: spRisk, conf: spConf
    },
    { cat: "MOUSE DYNAMICS" },
    {
      name: "Coord Repetition Rate",
      hint: mouseDisabled ? "disabled (touch / insufficient data)" : `${uniquePixels} unique pixels · ${(coordRepeatRate * 100).toFixed(1)}% repeats`,
      val: mouseDisabled ? "n/a" : (coordRepeatRate * 100).toFixed(1) + "%",
      pts: posPts, max: mouseDisabled ? 0 : 5, risk: posRisk, conf: posConf
    },
    {
      name: "Micro-Jitter (direction changes)",
      hint: mouseDisabled ? "disabled (touch / insufficient data)" : `${(dirChangeRate * 100).toFixed(1)}% of segments change direction`,
      val: mouseDisabled ? "n/a" : (dirChangeRate * 100).toFixed(1) + "%",
      pts: mjPts, max: mouseDisabled ? 0 : 7, risk: mjRisk, conf: mjConf
    },
    {
      name: "Pre-Click Movement",
      hint: mouseDisabled ? "disabled (touch / insufficient data)" : `avg displacement in 200ms before click`,
      val: mouseDisabled ? "n/a" : preClickAvgDisp.toFixed(2) + " px",
      pts: mpPts, max: mouseDisabled ? 0 : 8, risk: mpRisk, conf: mpConf
    },
    {
      name: "Acceleration CV",
      hint: mouseDisabled ? "disabled (touch / insufficient data)" : `velocity→acceleration jerkiness`,
      val: mouseDisabled ? "n/a" : accelCV.toFixed(3),
      pts: vvPts, max: mouseDisabled ? 0 : 5, risk: vvRisk, conf: vvConf
    },
    { cat: "TIMER ENVIRONMENT" },
    {
      name: "Digit Uniformity (χ²/dof)",
      hint: `timer artifact · quantum ${clockQuantum.toFixed(3)}ms${clockQuantum >= 1 ? " — reduced weight" : ""}`,
      val: reducedChi2.toFixed(2) + ` <span class="digit-spark">${digitSparkHtml}</span>`,
      pts: dgPts, max: dgMaxPts, risk: dgRisk, conf: dgConf
    },
    {
      name: "Sub-ms Jitter Std",
      hint: `timer artifact · fractional precision${clockQuantum >= 1 ? " — reduced weight" : ""}`,
      val: fracStd.toFixed(4) + ` <span class="digit-spark">${fracSparkHtml}</span>`,
      pts: jPts, max: jMaxPts, risk: jRisk, conf: jConf
    },
    { cat: "DISTRIBUTION" },
    {
      name: "Burstiness Index",
      hint: `B=${B.toFixed(4)} · rolling σ(B)=${rollingBStd.toFixed(4)}${rollingBStd < 0.01 && nd >= 20 ? " — stable=suspicious" : ""}`,
      val: B.toFixed(4), pts: buPts, max: 5, risk: buRisk, conf: buConf
    },
    {
      name: "Excess Kurtosis",
      hint: `near zero = too mesokurtic for human (expect fat tails)`,
      val: kurt.toFixed(3), pts: kuPts, max: 7, risk: kuRisk, conf: kuConf
    }
  ];

  signalListEl.innerHTML = signals.map(sig => {
    if (sig.cat) return `<div class="sig-cat">${sig.cat}</div>`;
    const badgeClass = sig.risk === "na" ? "na" : sig.risk;
    const badgeText  = sig.risk === "na" ? "n/a" : `${sig.pts}/${sig.max}`;
    const confDot = sig.conf !== undefined
      ? `<span class="conf-dot ${confClass(sig.conf)}" title="confidence: ${(sig.conf * 100).toFixed(0)}%"></span>` : "";
    return `
      <div class="signal-row">
        <div class="sig-left">
          <div class="sig-name">${confDot}${sig.name}</div>
          <div class="sig-hint">${sig.hint}</div>
        </div>
        <div class="sig-right">
          <div class="sig-val">${sig.val}</div>
          <div class="sig-badge ${badgeClass}">${badgeText}</div>
        </div>
      </div>`;
  }).join("");
  signalsWrapEl.style.display = "";

  footerNoteEl.style.display = "";
  const totalFlagged = [hsPts,cvPts,rrPts,entPts,acPts,spPts,posPts,mjPts,mpPts,vvPts,dgPts,buPts,kuPts,jPts].filter(p => p > 0).length;
  if (speedOverride) {
    footerNoteEl.textContent = `Automation ${effectiveAutoScore}/100 · Human-likeness ${humanScore}/100. Speed override: ${sessionCps.toFixed(1)} session CPS exceeds 24 — physically impossible.`;
  } else {
    footerNoteEl.textContent = `Automation ${effectiveAutoScore}/100 · Human-likeness ${humanScore}/100. ${totalFlagged} of 14 signals flagged. Pointer: ${dominantPointerType}. Clock quantum: ${clockQuantum.toFixed(3)}ms.`;
  }

  // ── Diagnostic Charts ──
  renderDiagnostics(dt, nd, m, acValues, maxLag, specMag, halfN, meanIntervalSec);
}

// ── Diagnostics rendering ──
function renderDiagnostics(dt, nd, m, acValues, maxLag, specMag, halfN, meanIntervalSec) {
  const diagPanel = document.getElementById("diagPanel");
  if (!diagPanel) return;
  diagPanel.style.display = "";

  const toggle = document.getElementById("diagToggle");
  const charts = document.getElementById("diagCharts");
  if (!toggle._bound) {
    toggle.addEventListener("click", () => {
      toggle.classList.toggle("open");
      charts.classList.toggle("open");
    });
    toggle._bound = true;
  }

  // 1. Interval Histogram
  const binW = freedmanDiaconisBinWidth(dt);
  const histBins = {};
  let minBin = Infinity, maxBin = -Infinity;
  for (const d of dt) {
    const b = Math.floor(d / binW);
    histBins[b] = (histBins[b] || 0) + 1;
    if (b < minBin) minBin = b;
    if (b > maxBin) maxBin = b;
  }
  const histLabels = [], histData = [];
  for (let b = minBin; b <= maxBin; b++) {
    histLabels.push((b * binW).toFixed(0));
    histData.push(histBins[b] || 0);
  }

  const histCtx = document.getElementById("histChart").getContext("2d");
  if (histChart) histChart.destroy();
  histChart = new Chart(histCtx, {
    type: "bar",
    data: {
      labels: histLabels,
      datasets: [{ data: histData, backgroundColor: "rgba(32,208,136,.4)", borderRadius: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#5e7a9a", font: { size: 9 }, maxTicksLimit: 12 }, grid: { display: false },
             title: { display: true, text: "Interval (ms)", color: "#5e7a9a", font: { size: 9 } } },
        y: { ticks: { color: "#5e7a9a", font: { size: 9 } }, grid: { color: "rgba(255,255,255,.04)" },
             title: { display: true, text: "Count", color: "#5e7a9a", font: { size: 9 } } }
      }
    }
  });

  // 2. Autocorrelation Plot
  const acLabels = [];
  for (let i = 1; i <= maxLag; i++) acLabels.push("Lag " + i);

  const acCtx = document.getElementById("acChart").getContext("2d");
  if (acChart) acChart.destroy();
  acChart = new Chart(acCtx, {
    type: "line",
    data: {
      labels: acLabels,
      datasets: [{
        data: acValues.slice(0, maxLag),
        borderColor: "#9b6bff", backgroundColor: "rgba(155,107,255,.08)",
        fill: true, borderWidth: 2, pointRadius: 3, pointBackgroundColor: "#9b6bff", tension: 0.2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#5e7a9a", font: { size: 9 } }, grid: { display: false } },
        y: { min: -1, max: 1, ticks: { color: "#5e7a9a", font: { size: 9 } },
             grid: { color: "rgba(255,255,255,.04)" },
             title: { display: true, text: "r", color: "#5e7a9a", font: { size: 9 } } }
      }
    }
  });

  // 3. Power Spectrum
  const specLabels = [], specData = [];
  for (let k = 0; k < specMag.length && k < halfN; k++) {
    const freq = meanIntervalSec > 0 ? ((k + 1) / (nd * meanIntervalSec)).toFixed(2) : k;
    specLabels.push(freq);
    specData.push(specMag[k]);
  }

  const specCtx = document.getElementById("specChart").getContext("2d");
  if (specChart) specChart.destroy();
  specChart = new Chart(specCtx, {
    type: "line",
    data: {
      labels: specLabels,
      datasets: [{
        data: specData,
        borderColor: "#4da6ff", backgroundColor: "rgba(77,166,255,.08)",
        fill: true, borderWidth: 1.5, pointRadius: 0, tension: 0.1
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#5e7a9a", font: { size: 9 }, maxTicksLimit: 10 }, grid: { display: false },
             title: { display: true, text: "Freq (Hz)", color: "#5e7a9a", font: { size: 9 } } },
        y: { ticks: { color: "#5e7a9a", font: { size: 9 } }, grid: { color: "rgba(255,255,255,.04)" },
             title: { display: true, text: "Magnitude", color: "#5e7a9a", font: { size: 9 } } }
      }
    }
  });
}

# ClickGuard — Click Speed & Bot Detector

A browser-based click speed tester with a 14-signal bot/autoclicker detection engine. Built for educational purposes and as a research tool for testing click bot behavior.

**Live Demo:** [https://o-mkar.github.io/ClickGuard-Click-Speed-Bot-Detector/](https://o-mkar.github.io/ClickGuard-Click-Speed-Bot-Detector/)

<img width="1217" height="594" alt="Screenshot 2026-03-02 at 8 50 02 am" src="https://github.com/user-attachments/assets/9510580e-a629-4d33-b00c-995a7f705779" />



## Purpose

This project was developed to study and detect automated clicking tools (autoclickers, macro scripts, bot frameworks) as part of a larger project. It serves as a standalone testing and research environment for understanding the behavioral differences between human and automated input.

**This is for educational and research purposes only.**

## How It Works

Click as fast as you can during the configured duration. When the session ends, the detector analyzes your click data across **14 signals** in **6 domains** and produces two scores:

- **Automation Score** (0–100) — how machine-like the input appears (periodicity, quantization, superhuman speed)
- **Human-likeness Score** (0–100) — how organic the input appears (natural variability, neuromotor noise, cursor dynamics)

### Detection Domains

| Domain | Signals | What it detects |
|---|---|---|
| Physical Limits | Superhuman Speed | CPS beyond human capability (~16 CPS max sustained) |
| Time-Domain | CV, Repeat Ratio, Entropy | Interval regularity, identical consecutive intervals, low randomness |
| Frequency | Autocorrelation, Spectral Peak | Periodic patterns via multi-lag correlation and Hann-windowed DFT |
| Mouse Dynamics | Coord Repetition, Direction Jitter, Pre-Click Movement, Acceleration CV | Cursor behavior — bots lack neuromotor noise and coupled movement |
| Timer Environment | Digit Uniformity, Sub-ms Jitter | Browser timer resolution artifacts (not bot-specific) |
| Distribution | Burstiness, Kurtosis | Statistical shape of interval distribution |

### Key Features

- **Dual scoring** — separate Automation and Human-likeness scores instead of a single "bot score"
- **Confidence indicators** — per-signal confidence based on sample size
- **Clock profiling** — measures `performance.now()` quantum to adapt timer-dependent signals
- **Pointer type detection** — disables mouse-dynamics signals on touch devices
- **Adaptive thresholds** — Freedman-Diaconis binning, clock-quantum-scaled tolerances, fatigue-adjusted speed limits
- **Diagnostic charts** — interval histogram, autocorrelation plot (lags 1–20), power spectrum (Hann DFT)
- **Session vs Active CPS** — two CPS metrics to avoid measurement bias

## Files

```
click-test.html          — markup (layout, containers, canvas elements)
click-test.css           — styles
click-test-engine.js     — state, data collection, tick loop, events, clock profiler
click-test-detector.js   — 14 signals, dual scoring, confidence, rendering, diagnostics
```

## Usage

Open `click-test.html` in a browser. No build step or dependencies to install — Chart.js is loaded from CDN.

1. Set a duration (seconds)
2. Click the click area to start
3. Click as fast as you can
4. Review the analysis when the timer ends

## Tech

- Vanilla HTML/CSS/JS — no framework
- [Chart.js](https://www.chartjs.org/) for real-time and diagnostic charts
- All analysis runs client-side in the browser

## Disclaimer

This tool is provided for **educational and research purposes only**. It is designed to help understand the behavioral signatures of automated input tools. Do not use this to facilitate cheating, fraud, or any activity that violates terms of service of other platforms.

## License

MIT

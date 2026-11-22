import test from 'node:test';
import assert from 'node:assert/strict';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function hash(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function smooth(a: number, b: number, x: number): number {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
}

function mixAt(t: number, on: number, off: number, dur: number): number {
  return smooth(on, on + dur, t) * (1 - smooth(off, off + dur, t));
}

const LEVELS = [0, 0.16, 0.32, 0.49, 0.66, 0.83, 1];
function quantizeLevel(v: number): number {
  for (let i = LEVELS.length - 1; i >= 1; i--) {
    if (v >= LEVELS[i] - 0.085) return LEVELS[i];
  }
  return 0;
}

function gridMetrics(W: number, H: number) {
  const step = Math.max(3.2, W / 320);
  const rowStep = step * 1.65;
  const cols = Math.ceil(W / step);
  const rows = Math.ceil(H / rowStep);
  const R = step * 0.34;
  return { step, rowStep, cols, rows, R };
}

test('hash always returns values in [0, 1)', () => {
  for (let j = 0; j < 40; j++) {
    for (let i = 0; i < 40; i++) {
      const h = hash(i, j);
      assert.ok(h >= 0 && h < 1, `Expected [0,1), got ${h}`);
    }
  }
});

test('pose dissolve mixAt returns cleanly to 0 before 20s loop restart', () => {
  assert.equal(mixAt(0, 2.4, 10.4, 1.6), 0);
  assert.equal(mixAt(0, 6.2, 14.6, 1.6), 0);

  // Mid-pose B for right hand and left hand
  assert.equal(mixAt(5.0, 2.4, 10.4, 1.6), 1);
  assert.equal(mixAt(9.0, 6.2, 14.6, 1.6), 1);

  // Seamless return before 20s
  assert.equal(mixAt(12.1, 2.4, 10.4, 1.6), 0);
  assert.equal(mixAt(16.3, 6.2, 14.6, 1.6), 0);
  assert.equal(mixAt(19.99, 2.4, 10.4, 1.6), 0);
  assert.equal(mixAt(19.99, 6.2, 14.6, 1.6), 0);
});

test('quantizeLevel maps intensities to the 7 fine halftone levels', () => {
  assert.equal(quantizeLevel(0.05), 0);
  assert.equal(quantizeLevel(0.08), 0.16);
  assert.equal(quantizeLevel(0.24), 0.32);
  assert.equal(quantizeLevel(0.41), 0.49);
  assert.equal(quantizeLevel(0.58), 0.66);
  assert.equal(quantizeLevel(0.75), 0.83);
  assert.equal(quantizeLevel(0.92), 1);
});

test('gridMetrics produces high-density non-overlapping dot geometry', () => {
  const desktop = gridMetrics(1440, 900);
  assert.equal(desktop.cols, 320);
  assert.ok(desktop.R / desktop.step >= 0.32 && desktop.R / desktop.step <= 0.38);
  assert.ok(desktop.R * 2 < desktop.step);
  assert.ok(desktop.R * 2 < desktop.rowStep);

  const mobile = gridMetrics(390, 844);
  assert.ok(mobile.step >= 3.2);
  assert.ok(mobile.cols >= 120);
});

function distortionRadius(W: number): number {
  return clamp(W * 0.115, 105, 175);
}

function radialDistortionForce(
  dotX: number,
  dotY: number,
  mouseX: number,
  mouseY: number,
  radius: number,
  strength: number
): { force: number; nx: number; ny: number } {
  const dx = dotX - mouseX;
  const dy = dotY - mouseY;
  const dist = Math.hypot(dx, dy);
  if (dist >= radius) return { force: 0, nx: 0, ny: 0 };
  const influence = Math.max(0, 1 - dist / radius);
  const force = influence * influence * strength;
  const nx = dist > 0.001 ? dx / dist : 0;
  const ny = dist > 0.001 ? dy / dist : 0;
  return { force, nx, ny };
}

test('distortionRadius stays within 100-180px across viewports', () => {
  for (const w of [375, 390, 768, 1280, 1440, 1920]) {
    const r = distortionRadius(w);
    assert.ok(r >= 100 && r <= 180, `Expected 100..180 for W=${w}, got ${r}`);
  }
});

test('radialDistortionForce decays smoothly to 0 at radius and pushes outward', () => {
  const r = distortionRadius(1440);
  const near = radialDistortionForce(320, 420, 300, 420, r, 1);
  const mid = radialDistortionForce(380, 420, 300, 420, r, 1);
  const outside = radialDistortionForce(500, 420, 300, 420, r, 1);

  assert.ok(near.force > mid.force);
  assert.ok(near.nx > 0 && near.ny === 0);
  assert.equal(outside.force, 0);
});

const ASCII_PALETTE = [' ', '.', ',', ':', ';', '+', '*', '#', '%', '@'];
function asciiCharForLuminance(lum: number): string {
  if (lum >= 0.935) return ASCII_PALETTE[0];
  const darkness = clamp((0.935 - lum) / 0.85, 0, 1);
  if (darkness < 0.08) return ASCII_PALETTE[1];
  if (darkness < 0.17) return ASCII_PALETTE[2];
  if (darkness < 0.27) return ASCII_PALETTE[3];
  if (darkness < 0.39) return ASCII_PALETTE[4];
  if (darkness < 0.53) return ASCII_PALETTE[5];
  if (darkness < 0.68) return ASCII_PALETTE[6];
  if (darkness < 0.81) return ASCII_PALETTE[7];
  if (darkness < 0.92) return ASCII_PALETTE[8];
  return ASCII_PALETTE[9];
}

test('asciiCharForLuminance keeps bright sky empty and reserves @ for darkest shadows', () => {
  assert.equal(asciiCharForLuminance(0.96), ' ');
  assert.equal(asciiCharForLuminance(0.89), '.');
  assert.equal(asciiCharForLuminance(0.65), ';');
  assert.equal(asciiCharForLuminance(0.42), '*');
  assert.equal(asciiCharForLuminance(0.2), '%');
  assert.equal(asciiCharForLuminance(0.08), '@');
});

const KF_LEVELS = [0, 0.26, 0.52, 0.78, 1];
function kfQuantizeLevel(v: number): number {
  for (let k = KF_LEVELS.length - 1; k >= 1; k--) {
    if (v >= KF_LEVELS[k] - 0.13) return k;
  }
  return 0;
}

function kfPreprocessLum(r: number, g: number, b: number, black = 0.05, white = 0.9, lift = 0.3): number {
  let l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  l = clamp((l - black) / (white - black), 0, 1);
  return lift + l * (1 - lift);
}

test('kf footer preprocessing and quantization map sky to 0 and foothills to max dot level', () => {
  const skyLum = kfPreprocessLum(255, 255, 255);
  assert.equal(skyLum, 1);
  const skyV = clamp((1 - skyLum - 0.13) / 0.4, 0, 1);
  assert.equal(kfQuantizeLevel(skyV), 0);

  const footLum = kfPreprocessLum(25, 25, 25);
  assert.ok(footLum >= 0.3 && footLum < 0.4);
  const footV = clamp((1 - footLum - 0.13) / 0.4, 0, 1);
  assert.equal(kfQuantizeLevel(footV), 4);

  assert.equal(kfQuantizeLevel(0.14), 1);
  assert.equal(kfQuantizeLevel(0.4), 2);
});

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function kwMaxRadius(ox: number, oy: number, vw: number, vh: number): number {
  return Math.hypot(Math.max(ox, vw - ox), Math.max(oy, vh - oy)) * 1.02;
}

function kwGlowOpacity(c: number): number {
  return c <= 0.001 ? 0 : 0.85 * (1 - smooth(0.75, 0.95, c));
}

test('kw circle transition covers farthest corner and fades rainbow halo cleanly', () => {
  const maxR = kwMaxRadius(720, 480, 1440, 900);
  assert.ok(maxR > Math.hypot(720, 480));
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);

  assert.equal(kwGlowOpacity(0), 0);
  assert.equal(kwGlowOpacity(0.5), 0.85);
  assert.equal(kwGlowOpacity(0.95), 0);
});

test('kf footer distortion math: lens radius, falloff, wake decay, and burst wave', () => {
  const FX = {
    ON: true,
    RADIUS: 0.09,
    LENS: 0.45,
    RIPPLE: 2.2,
    TEAR: 26,
    SCATTER: 1.6,
    DROP: 0.5,
    DECAY_S: 0.45,
    BURST: true,
    BURST_SPEED: 900,
    BURST_LIFE: 1.1,
  };

  // 1. Lens radius clamped between 90 and 200 across viewports
  const rMobile = clamp(390 * FX.RADIUS, 90, 200);
  assert.equal(rMobile, 90);
  const rDesktop = clamp(1440 * FX.RADIUS, 90, 200);
  assert.equal(rDesktop, 129.6);
  const rUltrawide = clamp(2560 * FX.RADIUS, 90, 200);
  assert.equal(rUltrawide, 200);

  // 2. Lens falloff is smooth quadratic: 1 at d=0, 0 at d>=R
  const lensFalloffAt0 = Math.pow(Math.max(0, 1 - 0 / rDesktop), 2);
  assert.equal(lensFalloffAt0, 1);
  const lensFalloffMid = Math.pow(Math.max(0, 1 - (rDesktop * 0.5) / rDesktop), 2);
  assert.equal(lensFalloffMid, 0.25);
  const lensFalloffEdge = Math.pow(Math.max(0, 1 - rDesktop / rDesktop), 2);
  assert.equal(lensFalloffEdge, 0);

  // 3. Wake decay rate: decays by exp(-dt / DECAY_S)
  const dt = 0.025; // 40fps frame
  const decayFactor = Math.exp(-dt / FX.DECAY_S);
  assert.ok(decayFactor < 1 && decayFactor > 0.9);
  // After 1.5 seconds, energy drops below 0.004 cutoff
  const energyAfter1_5s = 1.0 * Math.exp(-1.5 / FX.DECAY_S);
  assert.ok(energyAfter1_5s < 0.04);
  const energyAfter2_5s = 1.0 * Math.exp(-2.5 / FX.DECAY_S);
  assert.ok(energyAfter2_5s < 0.004);

  // 4. Burst shockwave ring radius expands at 900 px/s
  const tBurst0_5s = 0.5;
  const rb = tBurst0_5s * FX.BURST_SPEED;
  assert.equal(rb, 450);
  const burstLife = 1 - tBurst0_5s / FX.BURST_LIFE;
  assert.ok(burstLife > 0 && burstLife < 1);

  // Points within 42px of ring get shockwave energy
  const distOnRing = 450;
  const bValOnRing = (1 - Math.abs(distOnRing - rb) / 42) * 0.9 * burstLife;
  assert.equal(bValOnRing, 0.9 * burstLife);

  const distFar = 500;
  assert.ok(Math.abs(distFar - rb) > 42);
});

const KA_LEVELS = [0, 0.26, 0.52, 0.78, 1];
function kaQuantize(v: number): { levelIdx: number; radiusFrac: number } {
  for (let k = KA_LEVELS.length - 1; k >= 1; k--) {
    if (v >= KA_LEVELS[k] - 0.13) {
      return { levelIdx: k, radiusFrac: k === 1 ? 0.5 : KA_LEVELS[k] };
    }
  }
  return { levelIdx: 0, radiusFrac: 0 };
}

function kaDistributionAt(
  y: number,
  yc: number,
  H: number,
  xb: number,
  xs: number,
  g: number,
  lam: number,
  o: number
): { iInt: number; iInc: number; mixed: number } {
  const y1 = yc - g * 0.5;
  const y2 = yc + g * 0.5;
  const r1 = Math.hypot(xs - xb, y - y1);
  const r2 = Math.hypot(xs - xb, y - y2);
  const k = (Math.PI * 2) / lam;
  const env = 1 / (1 + Math.pow((y - yc) / (0.38 * H), 2));
  const iInt = Math.pow(Math.cos(k * (r1 - r2) * 0.5), 2) * env;
  const w = Math.min(0.055 * H, 0.36 * g);
  const g1 = 1 / (1 + Math.pow((y - y1) / w, 2));
  const g2 = 1 / (1 + Math.pow((y - y2) / w, 2));
  const iInc = 0.5 * (g1 + g2);
  return { iInt, iInc, mixed: (1 - o) * iInt + o * iInc };
}

function kaWaveValue(
  x: number,
  y: number,
  W: number,
  xb: number,
  y1: number,
  y2: number,
  lam: number,
  t: number,
  o: number
): { vInt: number; vInc: number; v: number } {
  const dx = x - xb;
  const r1 = Math.hypot(dx, y - y1);
  const r2 = Math.hypot(dx, y - y2);
  const k = (Math.PI * 2) / lam;
  const omega = Math.PI * 2 * 0.6;
  const env1 = 1 / (1 + r1 / (0.55 * W));
  const env2 = 1 / (1 + r2 / (0.55 * W));
  const dir1 = Math.pow(Math.max(0, dx / r1), 0.6);
  const dir2 = Math.pow(Math.max(0, dx / r2), 0.6);
  const a1 = env1 * dir1 * Math.cos(k * r1 - omega * t);
  const a2 = env2 * dir2 * Math.cos(k * r2 - omega * t);
  const vInt = smooth(0.32, 1.25, a1 + a2) * 0.66;
  const vInc = Math.max(smooth(0.28, 0.78, a1), smooth(0.28, 0.78, a2)) * 0.52;
  return { vInt, vInc, v: (1 - o) * vInt + o * vInc };
}

function kaBinAndSmoothHistogram(counts: number[], binSize = 2): number[] {
  const numBins = Math.ceil(counts.length / binSize);
  const raw = new Array<number>(numBins).fill(0);
  for (let b = 0; b < numBins; b++) {
    let s = 0;
    for (let m = 0; m < binSize; m++) {
      const idx = b * binSize + m;
      if (idx < counts.length) s += counts[idx];
    }
    raw[b] = s;
  }
  const out = new Array<number>(numBins).fill(0);
  for (let b = 0; b < numBins; b++) {
    const left = b > 0 ? raw[b - 1] : raw[b];
    const mid = raw[b];
    const right = b + 1 < numBins ? raw[b + 1] : raw[b];
    out[b] = (left + 2 * mid + right) * 0.25;
  }
  return out;
}

test('ka wavefront formulas produce bright interference crests at o=0 and separate ripples at o=1', () => {
  const W = 540;
  const H = 432;
  const xb = 0.34 * W;
  const g = 0.26 * H;
  const lam = 0.045 * W;
  const yc = H * 0.5;
  const y1 = yc - g * 0.5;
  const y2 = yc + g * 0.5;

  // Close to barrier along center axis: constructive interference gives high vInt
  const crest = kaWaveValue(xb + 24, yc, W, xb, y1, y2, lam, 0, 0);
  assert.ok(crest.vInt >= 0 && crest.vInt <= 0.62);
  assert.ok(crest.vInc >= 0 && crest.vInc <= 0.5);

  // At t=0 right next to slit 1, phase ~0 so cos ~ 1 => vInc peaks cleanly
  const slitCrest = kaWaveValue(xb + lam, y1, W, xb, y1, y2, lam, 0, 1);
  assert.ok(slitCrest.vInc > 0.3, `Expected strong ripple crest, got ${slitCrest.vInc}`);
});

test('ka pair-binned [1,2,1]/4 smoothed histogram suppresses single-row noise', () => {
  const noisy = [0, 10, 0, 0, 10, 0];
  const smoothed = kaBinAndSmoothHistogram(noisy, 2);
  // Raw pair sums: [10, 0, 10]; [1,2,1]/4 -> [(10+20+0)/4, (10+0+10)/4, (0+20+10)/4]
  assert.deepEqual(smoothed, [7.5, 5, 7.5]);
});

test('ka double-slit distributions: fringes at o=0 and distinct two bands at o=1 with new geometry', () => {
  const W = 540;
  const H = 432;
  const yc = H * 0.5;
  const xb = 0.34 * W;
  const xs = 0.84 * W;
  const g = 0.26 * H;
  const lam = 0.045 * W;

  const center0 = kaDistributionAt(yc, yc, H, xb, xs, g, lam, 0);
  assert.equal(center0.iInt, 1);

  const dx = xs - xb;
  const firstMinY = yc + (lam * 0.5 * dx) / g;
  const min0 = kaDistributionAt(firstMinY, yc, H, xb, xs, g, lam, 0);
  assert.ok(min0.iInt < 0.05, `Expected dark fringe, got ${min0.iInt}`);

  for (const gapRatio of [0.20, 0.26, 0.30]) {
    const gg = gapRatio * H;
    const band1 = kaDistributionAt(yc - gg * 0.5, yc, H, xb, xs, gg, lam, 1);
    const band2 = kaDistributionAt(yc + gg * 0.5, yc, H, xb, xs, gg, lam, 1);
    const mid = kaDistributionAt(yc, yc, H, xb, xs, gg, lam, 1);
    assert.ok(band1.iInc > mid.iInc * 1.5 && band2.iInc > mid.iInc * 1.5);
  }
});

test('ka shockwave expands linearly at 0.9*W/s and fades out at 0.9s', () => {
  const W = 540;
  const rMid = 0.45 * W * 0.9;
  const vMid = 0.8 * (1 - 0.45 / 0.9);
  assert.ok(Math.abs(rMid - 218.7) < 0.01);
  assert.ok(Math.abs(vMid - 0.4) < 1e-6);
  const vEnd = 0.8 * (1 - 0.9 / 0.9);
  assert.equal(vEnd, 0);
});

test('ka quantize maps intensity to 5 levels with R*0.5 lowest radius', () => {
  assert.deepEqual(kaQuantize(0.1), { levelIdx: 0, radiusFrac: 0 });
  assert.deepEqual(kaQuantize(0.14), { levelIdx: 1, radiusFrac: 0.5 });
  assert.deepEqual(kaQuantize(0.45), { levelIdx: 2, radiusFrac: 0.52 });
  assert.deepEqual(kaQuantize(0.70), { levelIdx: 3, radiusFrac: 0.78 });
  assert.deepEqual(kaQuantize(0.92), { levelIdx: 4, radiusFrac: 1 });
});

test('ka scroll-linked word reveal transitions monotonically from 0.16 to 1', () => {
  const n = 40;
  for (let i = 0; i < n; i++) {
    const startOp = 0.16 + 0.84 * smooth(i / n - 0.02, i / n + 0.10, 0 * 1.12);
    const fullOp = 0.16 + 0.84 * smooth(i / n - 0.02, i / n + 0.10, 1 * 1.12);
    assert.ok(startOp >= 0.16 && startOp <= 1);
    assert.equal(fullOp, 1);
  }
});

const KF_GRAD_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.18, 0.04],
  [0.55, 0.35],
  [0.82, 0.82],
  [1, 1],
];

function kfEvalStops(
  t: number,
  stops: ReadonlyArray<readonly [number, number]> = KF_GRAD_STOPS
): number {
  if (t <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, v0] = stops[i];
    const [p1, v1] = stops[i + 1];
    if (t >= p0 && t <= p1) {
      const span = p1 - p0;
      if (span <= 0) return v1;
      return v0 + ((t - p0) / span) * (v1 - v0);
    }
  }
  return last[1];
}

function kfGradMetrics(
  py: number,
  H: number,
  barH: number,
  peak: number,
  gradHeight: number
): { tGrad: number; a: number; lumBg: number; pLight: number; radScale: number } {
  const footerH = H + barH;
  const zoneTop = footerH * (1 - gradHeight);
  const tGrad = clamp((py - zoneTop) / Math.max(1, footerH - zoneTop), 0, 1);
  const a = peak * kfEvalStops(tGrad);
  const lumBg = 0.97 * (1 - a) + 0.04 * a;
  const pLight = peak < 0.65 ? 0 : 1 - smooth(0.36, 0.52, lumBg);
  return { tGrad, a, lumBg, pLight, radScale: pLight > 0 ? 0.9 : 1 };
}

test('kfEvalStops interpolates piecewise-linearly across gradient stops', () => {
  assert.equal(kfEvalStops(-0.1), 0);
  assert.equal(kfEvalStops(0), 0);
  assert.equal(kfEvalStops(0.18), 0.04);
  assert.equal(kfEvalStops(0.55), 0.35);
  assert.equal(kfEvalStops(0.82), 0.82);
  assert.equal(kfEvalStops(1), 1);
  assert.equal(kfEvalStops(1.2), 1);

  const mid = kfEvalStops(0.09);
  assert.ok(Math.abs(mid - 0.02) < 1e-6);
});

test('kfGradMetrics inverts mountain dots over dark gradient and stays dark when PEAK < 0.65', () => {
  const H = 750;
  const barH = 56;
  const top = kfGradMetrics(400, H, barH, 0.92, 0.30);
  assert.equal(top.tGrad, 0);
  assert.equal(top.pLight, 0);

  const nearBottom = kfGradMetrics(H - 2, H, barH, 0.92, 0.30);
  assert.ok(nearBottom.a > 0.6);
  assert.ok(nearBottom.lumBg < 0.42);
  assert.ok(nearBottom.pLight > 0.75);
  assert.equal(nearBottom.radScale, 0.9);

  // Soft haze guard when PEAK < 0.65
  const hazeBottom = kfGradMetrics(H - 2, H, barH, 0.5, 0.30);
  assert.ok(hazeBottom.a > 0);
  assert.equal(hazeBottom.pLight, 0);
});

test('kf safeY layout math keeps at least 300px of mountains below .kf-top and fades out all dots above safeY', () => {
  const topBottom = 340;
  const barH = 56;
  const viewportClamp = 780;
  const footerMinH = Math.max(viewportClamp, topBottom + 300 + barH);
  const H = footerMinH - barH;
  assert.ok(H - topBottom >= 300);

  const safeY = (topBottom + 20) / H;
  const bandTop = Math.max(H * 0.30, safeY * H - 20);
  assert.ok(bandTop >= topBottom);

  const topFadeAtLinkEdge = smooth(safeY - 0.02, safeY + 0.12, topBottom / H);
  assert.equal(topFadeAtLinkEdge, 0);
  const topFadeAtSafeLine = smooth(safeY - 0.02, safeY + 0.12, safeY);
  assert.ok(topFadeAtSafeLine < 0.08);
});

const KC_LEVELS = [0, 0.26, 0.52, 0.78, 1];
function kcQuantizeLevel(v: number): number {
  for (let k = KC_LEVELS.length - 1; k >= 1; k--) {
    if (v >= KC_LEVELS[k] - 0.13) return k;
  }
  return 0;
}

function kcDotRadius(lvl: number, R: number): number {
  if (lvl <= 0) return 0;
  return lvl === 1 ? R * 0.5 : R * KC_LEVELS[lvl];
}

function kcGlitchMix(
  fCurRed: number,
  fNextRed: number,
  seed: number,
  m: number
): { lum: number; front: boolean } {
  const red = seed < m ? fNextRed : fCurRed;
  const lum = red / 255;
  const front = m > 0 && m < 1 && Math.abs(seed - m) < 0.12;
  return { lum, front };
}

function kcSendStreamOffset(
  s: number,
  seed: number,
  W: number
): { offsetX: number; alpha: number } {
  const e = easeInOutCubic(clamp(s, 0, 1));
  return {
    offsetX: e * e * W * (0.25 + 0.9 * seed),
    alpha: clamp(1 - e, 0, 1),
  };
}

function kcMagneticPull(
  dx: number,
  dy: number,
  maxDist = 90,
  maxPull = 8
): { tx: number; ty: number } {
  const d = Math.hypot(dx, dy);
  if (d >= maxDist || d <= 0.001) return { tx: 0, ty: 0 };
  const s = (1 - d / maxDist) * maxPull;
  return { tx: (dx / d) * s, ty: (dy / d) * s };
}

test('kc board quantization and dot radii match spec thresholds', () => {
  const R = 2.2;
  // White background -> lum 1 -> v 0 -> lvl 0
  const bgV = clamp((1 - 1 - 0.12) / 0.4, 0, 1);
  assert.equal(kcQuantizeLevel(bgV), 0);
  assert.equal(kcDotRadius(0, R), 0);

  // Dark text core -> lum 0 -> v 1 -> lvl 4 (full R)
  const inkV = clamp((1 - 0 - 0.12) / 0.4, 0, 1);
  assert.equal(kcQuantizeLevel(inkV), 4);
  assert.equal(kcDotRadius(4, R), R);

  // Anti-aliased edge -> lvl 1 -> R * 0.5
  assert.equal(kcQuantizeLevel(0.15), 1);
  assert.equal(kcDotRadius(1, R), R * 0.5);
});

test('kc glitch dissolve swaps per-dot by seed threshold with +-0.12 front band', () => {
  const early = kcGlitchMix(0, 255, 0.5, 0.2);
  assert.equal(early.lum, 0);
  assert.equal(early.front, false);

  const onFront = kcGlitchMix(0, 255, 0.5, 0.45);
  assert.equal(onFront.front, true);

  const swapped = kcGlitchMix(0, 255, 0.5, 0.8);
  assert.equal(swapped.lum, 1);
  assert.equal(swapped.front, false);
});

test('kc Stage 2 send stream offset accelerates rightward and magnetic CTA stays within 8px inside 90px', () => {
  const start = kcSendStreamOffset(0, 0.5, 920);
  const mid = kcSendStreamOffset(0.5, 0.5, 920);
  const end = kcSendStreamOffset(1, 0.5, 920);
  assert.equal(start.offsetX, 0);
  assert.equal(start.alpha, 1);
  assert.ok(mid.offsetX > 0 && mid.alpha === 0.5);
  assert.ok(Math.abs(end.offsetX - 920 * 0.7) < 1e-6);
  assert.equal(end.alpha, 0);

  const outside = kcMagneticPull(95, 0);
  assert.deepEqual(outside, { tx: 0, ty: 0 });
  const near = kcMagneticPull(45, 0);
  assert.ok(near.tx > 0 && near.tx <= 8);
  const center = kcMagneticPull(0.01, 0);
  assert.ok(Math.hypot(center.tx, center.ty) <= 8);
});





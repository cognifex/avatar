const video = document.getElementById('camera');
const canvas = document.getElementById('avatar');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const startCameraBtn = document.getElementById('startCameraBtn');
const calibrateBtn = document.getElementById('calibrateBtn');
const styleProfileEl = document.getElementById('styleProfile');
const transparentToggle = document.getElementById('transparentToggle');

const PROFILE = {
  deadpan: { expressionGain: 0.75, peakGain: 1.25, neutralPull: 0.2 },
  balanced: { expressionGain: 1.0, peakGain: 1.15, neutralPull: 0.12 },
  overreact: { expressionGain: 1.25, peakGain: 1.35, neutralPull: 0.06 },
};

const state = {
  stream: null,
  running: false,
  calibration: null,
  profile: 'deadpan',
  tracking: { confidence: 0, headYaw: 0, headPitch: 0, headRoll: 0, eyeOpenL: 0.5, eyeOpenR: 0.5, browLiftL: 0, browLiftR: 0, browFrown: 0, mouthOpen: 0, mouthWide: 0, mouthRound: 0, mouthCornerL: 0, mouthCornerR: 0 },
  smoothed: {},
  emotions: { neutral: 1, joy: 0, annoyed: 0, surprise: 0, skeptical: 0 },
  peak: { active: false, phase: 'idle', until: 0, emotion: 'neutral', cooldownUntil: 0 },
};

function clamp(v, min = 0, max = 1) { return Math.min(max, Math.max(min, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function setStatus(text) { statusEl.textContent = text; }

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 540 } });
    video.srcObject = state.stream;
    state.running = true;
    setStatus('Tracking OK');
  } catch {
    setStatus('No Camera');
  }
}

function solveEmotions(f) {
  const eyeOpenAvg = (f.eyeOpenL + f.eyeOpenR) * 0.5;
  const browLiftAvg = (f.browLiftL + f.browLiftR) * 0.5;
  const mouthCornerAvg = (f.mouthCornerL + f.mouthCornerR) * 0.5;
  const smirkAsym = Math.abs(f.mouthCornerL - f.mouthCornerR);
  const joy = clamp((mouthCornerAvg + 0.35 * f.mouthWide - 0.2 * f.browFrown + 1) * 0.5);
  const annoyed = clamp(f.browFrown + 0.25 * (1 - eyeOpenAvg) - 0.2 * f.mouthOpen);
  const surprise = clamp(f.mouthOpen + 0.5 * eyeOpenAvg + 0.25 * browLiftAvg);
  const skeptical = clamp(Math.abs(f.browLiftL - f.browLiftR) + 0.2 * Math.abs(f.headRoll) + 0.2 * smirkAsym);
  const neutral = clamp(1 - Math.max(joy, annoyed, surprise, skeptical));
  const sum = neutral + joy + annoyed + surprise + skeptical || 1;
  return { neutral: neutral / sum, joy: joy / sum, annoyed: annoyed / sum, surprise: surprise / sum, skeptical: skeptical / sum };
}

function updateMockTracking(ts) {
  // Placeholder until MediaPipe integration; keeps architecture/spec behavior testable.
  const t = ts / 1000;
  const signal = Math.sin(t * 1.2);
  state.tracking.confidence = 0.85;
  state.tracking.headRoll = Math.sin(t * 0.8) * 0.12;
  state.tracking.headPitch = Math.cos(t * 0.5) * 0.1;
  state.tracking.eyeOpenL = clamp(0.55 + Math.sin(t * 2.2) * 0.25);
  state.tracking.eyeOpenR = clamp(0.55 + Math.cos(t * 2.05) * 0.25);
  state.tracking.browFrown = clamp((Math.sin(t * 0.9) + 1) * 0.2);
  state.tracking.browLiftL = Math.sin(t * 1.4) * 0.4;
  state.tracking.browLiftR = Math.cos(t * 1.3) * 0.4;
  state.tracking.mouthOpen = clamp((signal + 1) * 0.4);
  state.tracking.mouthWide = clamp((Math.cos(t * 1.1) + 1) * 0.3);
  state.tracking.mouthCornerL = Math.sin(t * 0.7) * 0.5;
  state.tracking.mouthCornerR = Math.cos(t * 0.7) * 0.5;
}

function updatePeak(ts) {
  const e = state.emotions;
  const top = Object.entries(e).sort((a, b) => b[1] - a[1])[0];
  if (!state.peak.active && ts > state.peak.cooldownUntil && top[0] !== 'neutral' && top[1] > 0.36) {
    state.peak.active = true; state.peak.phase = 'hold'; state.peak.until = ts + 130; state.peak.emotion = top[0];
  } else if (state.peak.active && ts > state.peak.until) {
    state.peak.active = false; state.peak.phase = 'release'; state.peak.cooldownUntil = ts + 80;
  }
}

function drawAvatar() {
  const p = PROFILE[state.profile];
  const e = state.emotions;
  const peakMul = state.peak.active ? p.peakGain : 1;
  const gain = p.expressionGain * peakMul;
  const joy = e.joy * gain, annoyed = e.annoyed * gain, surprise = e.surprise * gain, skeptical = e.skeptical * gain;
  const neutralPull = p.neutralPull;

  if (!transparentToggle.checked) { ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  else ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2, cy = canvas.height / 2;
  const headTilt = state.tracking.headRoll * 0.35;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(headTilt);

  ctx.strokeStyle = '#f9fafb'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect(-150, -190, 300, 380, 80); ctx.stroke();

  const eyeSize = 20 + 16 * surprise - 8 * annoyed - 6 * neutralPull;
  const eyeSquint = 1 + 0.45 * annoyed - 0.2 * surprise;
  ctx.beginPath(); ctx.ellipse(-58, -40, eyeSize, Math.max(4, eyeSize / (2 * eyeSquint)), 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(58, -40, eyeSize, Math.max(4, eyeSize / (2 * eyeSquint)), 0, 0, Math.PI * 2); ctx.stroke();

  const browY = -95 - 24 * annoyed + 20 * surprise;
  ctx.beginPath(); ctx.moveTo(-95, browY); ctx.lineTo(-25, browY + 16 * (-0.35 * annoyed + 0.25 * skeptical)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(25, browY + 16 * skeptical); ctx.lineTo(95, browY + 16 * (0.35 * annoyed)); ctx.stroke();

  const mouthOpen = 10 + 60 * surprise + 20 * joy;
  const mouthWidth = 90 + 70 * joy - 25 * annoyed;
  const mouthCurve = 45 * (0.6 * joy - 0.45 * annoyed + 0.2 * skeptical);
  ctx.beginPath();
  ctx.moveTo(-mouthWidth / 2, 90);
  ctx.bezierCurveTo(-mouthWidth / 4, 90 + mouthCurve, mouthWidth / 4, 90 + mouthCurve, mouthWidth / 2, 90);
  ctx.stroke();
  if (mouthOpen > 20) { ctx.beginPath(); ctx.ellipse(0, 100, mouthWidth * 0.22, mouthOpen * 0.4, 0, 0, Math.PI * 2); ctx.stroke(); }

  ctx.restore();
}

function loop(ts) {
  if (!state.running) return requestAnimationFrame(loop);
  updateMockTracking(ts);
  state.emotions = solveEmotions(state.tracking);
  updatePeak(ts);
  drawAvatar();
  setStatus(state.peak.active ? 'Live' : 'Tracking OK');
  requestAnimationFrame(loop);
}

startCameraBtn.addEventListener('click', startCamera);
calibrateBtn.addEventListener('click', () => { state.calibration = { at: performance.now() }; setStatus('Tracking OK'); });
styleProfileEl.addEventListener('change', (e) => { state.profile = e.target.value; });
requestAnimationFrame(loop);

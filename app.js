const drawCanvas = document.getElementById('drawCanvas');
const avatarCanvas = document.getElementById('avatarCanvas');
const brushSizeInput = document.getElementById('brushSize');
const clearBtn = document.getElementById('clearBtn');
const detectBtn = document.getElementById('detectBtn');
const micBtn = document.getElementById('micBtn');
const stopMicBtn = document.getElementById('stopMicBtn');
const statusEl = document.getElementById('status');
const transparentBg = document.getElementById('transparentBg');
const canvasWrap = document.getElementById('canvasWrap');

const drawCtx = drawCanvas.getContext('2d');
const avatarCtx = avatarCanvas.getContext('2d');

let drawing = false;
let audioCtx;
let analyser;
let micStream;
let animationId;

const audioState = {
  level: 0,
  pitchHz: 0,
  expression: 'neutral',
  mouthOpen: 0,
};

const faceModel = {
  detected: false,
  cx: drawCanvas.width / 2,
  cy: drawCanvas.height / 2,
  r: 48,
};

setupDrawing();
requestAnimationFrame(render);

clearBtn.addEventListener('click', () => {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  avatarCtx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
  faceModel.detected = false;
  setStatus('Canvas geleert. Bitte neu zeichnen und Gesicht erneut erkennen.');
});

detectBtn.addEventListener('click', () => {
  const result = detectFaceFromDrawing();
  if (!result) {
    setStatus('Kein Gesicht erkannt. Zeichne einen klaren Kopf (z. B. Kreis) im oberen Bereich.');
    return;
  }
  Object.assign(faceModel, result, { detected: true });
  setStatus(`Gesicht erkannt bei x=${Math.round(result.cx)}, y=${Math.round(result.cy)}.`);
});

micBtn.addEventListener('click', async () => {
  try {
    await startMic();
    micBtn.disabled = true;
    stopMicBtn.disabled = false;
    setStatus('Mikrofon aktiv. Avatar reagiert jetzt auf Sprache.');
  } catch (err) {
    console.error(err);
    setStatus('Mikrofon konnte nicht gestartet werden. Bitte Berechtigung prüfen.');
  }
});

stopMicBtn.addEventListener('click', () => {
  stopMic();
  micBtn.disabled = false;
  stopMicBtn.disabled = true;
  setStatus('Mikrofon gestoppt.');
});

transparentBg.addEventListener('change', () => {
  canvasWrap.classList.toggle('transparent', transparentBg.checked);
});

function setupDrawing() {
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.strokeStyle = '#f8fafc';

  const begin = (event) => {
    drawing = true;
    const p = getPos(event);
    drawCtx.beginPath();
    drawCtx.moveTo(p.x, p.y);
  };

  const move = (event) => {
    if (!drawing) return;
    const p = getPos(event);
    drawCtx.lineWidth = Number(brushSizeInput.value);
    drawCtx.lineTo(p.x, p.y);
    drawCtx.stroke();
  };

  const end = () => {
    drawing = false;
    drawCtx.closePath();
  };

  drawCanvas.addEventListener('pointerdown', begin);
  drawCanvas.addEventListener('pointermove', move);
  drawCanvas.addEventListener('pointerup', end);
  drawCanvas.addEventListener('pointerleave', end);
}

function getPos(event) {
  const rect = drawCanvas.getBoundingClientRect();
  const sx = drawCanvas.width / rect.width;
  const sy = drawCanvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * sx,
    y: (event.clientY - rect.top) * sy,
  };
}

function detectFaceFromDrawing() {
  const { width, height } = drawCanvas;
  const data = drawCtx.getImageData(0, 0, width, height).data;
  const stride = width * 4;

  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || !isInkPixel(data, stride, x, y)) continue;
      const comp = floodComponent(data, width, height, stride, x, y, visited);
      if (comp.area > 130) components.push(comp);
    }
  }

  if (!components.length) return null;

  const scored = components
    .map((c) => {
      const w = c.maxX - c.minX + 1;
      const h = c.maxY - c.minY + 1;
      const aspectPenalty = Math.abs(1 - w / h);
      const topBias = c.cy / height;
      const roundness = 1 - aspectPenalty;
      const score = roundness * 0.6 + (1 - topBias) * 0.4;
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const radius = Math.max(18, Math.min(best.maxX - best.minX, best.maxY - best.minY) * 0.28);
  return { cx: best.cx, cy: best.cy, r: radius };
}

function isInkPixel(data, stride, x, y) {
  const off = y * stride + x * 4;
  const alpha = data[off + 3];
  return alpha > 25;
}

function floodComponent(data, width, height, stride, sx, sy, visited) {
  const stack = [[sx, sy]];
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = sx;
  let minY = sy;
  let maxX = sx;
  let maxY = sy;

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    if (!isInkPixel(data, stride, x, y)) continue;

    area++;
    sumX += x;
    sumY += y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  return {
    area,
    cx: sumX / Math.max(area, 1),
    cy: sumY / Math.max(area, 1),
    minX,
    minY,
    maxX,
    maxY,
  };
}

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const timeData = new Float32Array(analyser.fftSize);
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  const tick = () => {
    analyser.getFloatTimeDomainData(timeData);
    analyser.getByteFrequencyData(freqData);

    const rms = Math.sqrt(timeData.reduce((acc, v) => acc + v * v, 0) / timeData.length);
    audioState.level = smooth(audioState.level, rms, 0.25);

    const pitch = estimatePitch(timeData, audioCtx.sampleRate);
    audioState.pitchHz = smooth(audioState.pitchHz, pitch, 0.2);

    audioState.expression = classifyExpression(audioState.level, audioState.pitchHz);
    const pulse = Math.abs(Math.sin(performance.now() / 95));
    audioState.mouthOpen = Math.min(1, audioState.level * 18) * (0.55 + 0.45 * pulse);

    animationId = requestAnimationFrame(tick);
  };

  tick();
}

function stopMic() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = undefined;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  analyser = null;
  audioState.level = 0;
  audioState.pitchHz = 0;
  audioState.expression = 'neutral';
  audioState.mouthOpen = 0;
}

function classifyExpression(level, pitchHz) {
  if (level > 0.095) return pitchHz > 220 ? 'surprised' : 'angry';
  if (level < 0.02) return 'neutral';
  if (pitchHz > 180) return 'happy';
  if (pitchHz && pitchHz < 130) return 'sad';
  return 'focused';
}

function estimatePitch(samples, sampleRate) {
  let bestOffset = -1;
  let bestCorr = 0;
  const minLag = Math.floor(sampleRate / 420);
  const maxLag = Math.floor(sampleRate / 70);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < samples.length - lag; i++) {
      corr += samples[i] * samples[i + lag];
    }
    corr /= samples.length - lag;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestOffset = lag;
    }
  }

  if (bestOffset < 0 || bestCorr < 0.01) return 0;
  return sampleRate / bestOffset;
}

function smooth(prev, next, alpha) {
  return prev + alpha * (next - prev);
}

function render() {
  avatarCtx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);

  if (faceModel.detected) {
    drawFaceOverlay(faceModel, audioState);
  }

  requestAnimationFrame(render);
}

function drawFaceOverlay(face, audio) {
  const { cx, cy, r } = face;
  const eyeY = cy - r * 0.2;
  const eyeDX = r * 0.42;

  avatarCtx.save();
  avatarCtx.strokeStyle = '#22d3ee';
  avatarCtx.lineWidth = Math.max(2, r * 0.07);

  drawEyes(cx - eyeDX, eyeY, cx + eyeDX, eyeY, r, audio.expression);
  drawMouth(cx, cy + r * 0.45, r, audio.mouthOpen, audio.expression);
  avatarCtx.restore();
}

function drawEyes(x1, y1, x2, y2, r, expression) {
  const h = r * 0.12;
  avatarCtx.beginPath();

  if (expression === 'sad') {
    avatarCtx.moveTo(x1 - h, y1 + h * 0.8);
    avatarCtx.lineTo(x1 + h, y1 - h * 0.8);
    avatarCtx.moveTo(x2 - h, y2 - h * 0.8);
    avatarCtx.lineTo(x2 + h, y2 + h * 0.8);
  } else if (expression === 'angry') {
    avatarCtx.moveTo(x1 - h, y1 - h * 0.8);
    avatarCtx.lineTo(x1 + h, y1 + h * 0.8);
    avatarCtx.moveTo(x2 - h, y2 + h * 0.8);
    avatarCtx.lineTo(x2 + h, y2 - h * 0.8);
  } else if (expression === 'surprised') {
    avatarCtx.arc(x1, y1, h * 0.9, 0, Math.PI * 2);
    avatarCtx.moveTo(x2 + h * 0.9, y2);
    avatarCtx.arc(x2, y2, h * 0.9, 0, Math.PI * 2);
  } else {
    avatarCtx.moveTo(x1 - h, y1);
    avatarCtx.lineTo(x1 + h, y1);
    avatarCtx.moveTo(x2 - h, y2);
    avatarCtx.lineTo(x2 + h, y2);
  }

  avatarCtx.stroke();
}

function drawMouth(cx, y, r, mouthOpen, expression) {
  const w = r * 0.65;
  const openH = Math.max(2, r * 0.42 * mouthOpen);

  avatarCtx.beginPath();

  if (expression === 'sad') {
    avatarCtx.ellipse(cx, y + r * 0.08, w * 0.5, openH * 0.6, 0, Math.PI, 0, true);
  } else if (expression === 'happy') {
    avatarCtx.ellipse(cx, y, w * 0.5, openH + r * 0.05, 0, 0, Math.PI);
  } else if (expression === 'surprised') {
    avatarCtx.ellipse(cx, y, w * 0.24, openH + r * 0.12, 0, 0, Math.PI * 2);
  } else {
    avatarCtx.ellipse(cx, y, w * 0.5, openH, 0, 0, Math.PI * 2);
  }

  avatarCtx.stroke();
}

function setStatus(message) {
  statusEl.textContent = message;
}

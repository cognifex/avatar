const drawCanvas = document.getElementById('drawCanvas');
const drawGuideCanvas = document.getElementById('drawGuideCanvas');
const outputCanvas = document.getElementById('outputCanvas');

const brushSizeInput = document.getElementById('brushSize');
const clearBtn = document.getElementById('clearBtn');
const detectBtn = document.getElementById('detectBtn');
const copyBtn = document.getElementById('copyBtn');
const micBtn = document.getElementById('micBtn');
const stopMicBtn = document.getElementById('stopMicBtn');
const statusEl = document.getElementById('status');
const transparentBg = document.getElementById('transparentBg');
const outputWrap = document.getElementById('outputWrap');

const drawCtx = drawCanvas.getContext('2d');
const guideCtx = drawGuideCanvas.getContext('2d');
const outputCtx = outputCanvas.getContext('2d');

const bufferCanvas = document.createElement('canvas');
bufferCanvas.width = drawCanvas.width;
bufferCanvas.height = drawCanvas.height;
const bufferCtx = bufferCanvas.getContext('2d');

let drawing = false;
let audioCtx;
let analyser;
let micStream;
let audioLoopId;
let renderId;

const audioState = {
  level: 0,
  pitchHz: 0,
  mouthOpen: 0,
};

const avatarState = {
  faceBox: null,
  baseFrame: null,
};

setupDrawing();
renderId = requestAnimationFrame(renderOutput);

clearBtn.addEventListener('click', () => {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  guideCtx.clearRect(0, 0, drawGuideCanvas.width, drawGuideCanvas.height);
  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  avatarState.faceBox = null;
  avatarState.baseFrame = null;
  setStatus('Zeichnung gelöscht. Bitte neu zeichnen und Gesicht erkennen.');
});

detectBtn.addEventListener('click', () => {
  const box = detectFaceBoxFromDrawing();
  if (!box) {
    avatarState.faceBox = null;
    drawFaceGuide();
    setStatus('Kein Gesicht gefunden. Zeichne den Kopf deutlicher (geschlossene Form hilft).');
    return;
  }
  avatarState.faceBox = box;
  drawFaceGuide();
  setStatus(`Gesicht erkannt (x=${Math.round(box.x)}, y=${Math.round(box.y)}, w=${Math.round(box.w)}, h=${Math.round(box.h)}).`);
});

copyBtn.addEventListener('click', () => {
  avatarState.baseFrame = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  outputCtx.putImageData(avatarState.baseFrame, 0, 0);
  if (!avatarState.faceBox) {
    setStatus('Zeichnung wurde in den Output übernommen. Tipp: Zusätzlich "Gesicht erkennen" für Animation.');
    return;
  }
  setStatus('Zeichnung inkl. erkanntem Gesicht in den Output übernommen. Neutral = exakt deine Zeichnung.');
});

micBtn.addEventListener('click', async () => {
  try {
    await startMic();
    micBtn.disabled = true;
    stopMicBtn.disabled = false;
    setStatus('Mikrofon aktiv. Output wird jetzt über deinem neutralen Gesicht animiert.');
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
  outputWrap.classList.toggle('transparent', transparentBg.checked);
});

function setupDrawing() {
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.strokeStyle = '#f8fafc';

  drawCanvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    const p = getPos(event, drawCanvas);
    drawCtx.beginPath();
    drawCtx.moveTo(p.x, p.y);
  });

  drawCanvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const p = getPos(event, drawCanvas);
    drawCtx.lineWidth = Number(brushSizeInput.value);
    drawCtx.lineTo(p.x, p.y);
    drawCtx.stroke();
  });

  const endStroke = () => {
    if (!drawing) return;
    drawing = false;
    drawCtx.closePath();
  };

  drawCanvas.addEventListener('pointerup', endStroke);
  drawCanvas.addEventListener('pointerleave', endStroke);
}

function getPos(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * sx,
    y: (event.clientY - rect.top) * sy,
  };
}

function detectFaceBoxFromDrawing() {
  const width = drawCanvas.width;
  const height = drawCanvas.height;
  const image = drawCtx.getImageData(0, 0, width, height);
  const data = image.data;

  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || !isInkPixel(data, width, x, y)) continue;
      const comp = floodComponent(data, width, height, x, y, visited);
      if (comp.area > 120) components.push(comp);
    }
  }

  if (!components.length) return null;

  const scored = components
    .map((comp) => {
      const w = comp.maxX - comp.minX + 1;
      const h = comp.maxY - comp.minY + 1;
      const aspect = w / h;
      const roundish = 1 - Math.min(1, Math.abs(1 - aspect));
      const topFactor = 1 - comp.cy / height;
      const areaFactor = Math.min(1, comp.area / 9000);
      const score = roundish * 0.45 + topFactor * 0.35 + areaFactor * 0.2;
      return { comp, w, h, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const padX = Math.max(10, best.w * 0.15);
  const padY = Math.max(12, best.h * 0.18);
  const x = Math.max(0, best.comp.minX - padX);
  const y = Math.max(0, best.comp.minY - padY);
  const maxX = Math.min(width, best.comp.maxX + padX);
  const maxY = Math.min(height, best.comp.maxY + padY);

  return {
    x,
    y,
    w: maxX - x,
    h: maxY - y,
  };
}

function isInkPixel(data, width, x, y) {
  const off = (y * width + x) * 4;
  return data[off + 3] > 25;
}

function floodComponent(data, width, height, sx, sy, visited) {
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
    if (!isInkPixel(data, width, x, y)) continue;

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

function drawFaceGuide() {
  guideCtx.clearRect(0, 0, drawGuideCanvas.width, drawGuideCanvas.height);
  if (!avatarState.faceBox) return;

  const { x, y, w, h } = avatarState.faceBox;
  guideCtx.save();
  guideCtx.strokeStyle = '#22d3ee';
  guideCtx.lineWidth = 2;
  guideCtx.setLineDash([8, 6]);
  guideCtx.strokeRect(x, y, w, h);
  guideCtx.fillStyle = '#22d3ee';
  guideCtx.font = '16px sans-serif';
  guideCtx.fillText('Erkanntes Gesicht', x + 8, Math.max(18, y - 8));
  guideCtx.restore();
}

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const timeData = new Float32Array(analyser.fftSize);

  const loop = () => {
    analyser.getFloatTimeDomainData(timeData);

    const rms = Math.sqrt(timeData.reduce((acc, v) => acc + v * v, 0) / timeData.length);
    audioState.level = smooth(audioState.level, rms, 0.25);

    const pitch = estimatePitch(timeData, audioCtx.sampleRate);
    audioState.pitchHz = smooth(audioState.pitchHz, pitch, 0.2);

    const pulse = Math.abs(Math.sin(performance.now() / 95));
    audioState.mouthOpen = Math.min(1, audioState.level * 18) * (0.55 + 0.45 * pulse);

    audioLoopId = requestAnimationFrame(loop);
  };

  loop();
}

function stopMic() {
  if (audioLoopId) cancelAnimationFrame(audioLoopId);
  audioLoopId = undefined;

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
  audioState.mouthOpen = 0;
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

function renderOutput() {
  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);

  if (avatarState.baseFrame) {
    outputCtx.putImageData(avatarState.baseFrame, 0, 0);

    if (avatarState.faceBox && audioState.mouthOpen > 0.01) {
      animateMouthFromDrawing(avatarState.faceBox, audioState.mouthOpen);
    }

    if (avatarState.faceBox && audioState.level > 0.08) {
      animateHeadBounce(avatarState.faceBox, audioState.level);
    }
  }

  renderId = requestAnimationFrame(renderOutput);
}

function animateMouthFromDrawing(faceBox, mouthOpen) {
  const { x, y, w, h } = faceBox;
  const stripY = y + h * 0.55;
  const stripH = h * 0.33;

  bufferCtx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);
  bufferCtx.drawImage(outputCanvas, 0, 0);

  outputCtx.clearRect(x - 2, stripY - 2, w + 4, stripH + h * 0.25 + 4);

  const expandedH = stripH * (1 + mouthOpen * 0.9);
  outputCtx.drawImage(
    bufferCanvas,
    x,
    stripY,
    w,
    stripH,
    x,
    stripY,
    w,
    expandedH,
  );
}

function animateHeadBounce(faceBox, level) {
  const { x, y, w, h } = faceBox;
  const amp = Math.min(6, level * 60);
  const offsetY = Math.sin(performance.now() / 70) * amp;

  bufferCtx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);
  bufferCtx.drawImage(outputCanvas, 0, 0);

  outputCtx.clearRect(x - 2, y - 2, w + 4, h + 4);
  outputCtx.drawImage(bufferCanvas, x, y, w, h, x, y + offsetY, w, h);
}

function setStatus(message) {
  statusEl.textContent = message;
}

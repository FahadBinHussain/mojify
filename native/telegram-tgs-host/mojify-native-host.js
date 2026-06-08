#!/usr/bin/env node

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const zlib = require('node:zlib');

const HOST_NAME = 'com.mojify.tgs_host';
const CHUNK_SIZE = 512 * 1024;
const CDP_READY_TIMEOUT_MS = 15000;
const CDP_EVALUATE_TIMEOUT_MS = 30000;
const FFMPEG_TIMEOUT_MS = 120000;
const RENDERER_NAME = 'chrome-lottie-frame-renderer';
const ENCODER_NAME = 'ffmpeg-libvpx-vp9-lossless';

function log(...args) {
  console.error(`[${HOST_NAME}]`, ...args);
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function parseDataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) {
    throw new Error('Invalid TGS data URL');
  }

  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  return isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
}

function parseTgsMessagePayload(message = {}) {
  if (message.tgsDataUrl) {
    return parseDataUrlToBuffer(message.tgsDataUrl);
  }

  if (message.tgsBase64) {
    return Buffer.from(String(message.tgsBase64), 'base64');
  }

  throw new Error('Native conversion request did not include TGS data');
}

function parseTgsAnimation(tgsBuffer) {
  const jsonText = zlib.gunzipSync(tgsBuffer).toString('utf8');
  const animationData = JSON.parse(jsonText);

  if (!animationData || typeof animationData !== 'object' || !Array.isArray(animationData.layers)) {
    throw new Error('TGS payload did not contain a valid Lottie animation');
  }

  return animationData;
}

function getAnimationGeometry(animationData = {}) {
  return {
    width: Math.round(clampNumber(animationData.w, 16, 1024, 512)),
    height: Math.round(clampNumber(animationData.h, 16, 1024, 512))
  };
}

function getAnimationTiming(animationData = {}) {
  const frameRate = clampNumber(animationData.fr, 1, 120, 60);
  const inPoint = Number.isFinite(Number(animationData.ip)) ? Number(animationData.ip) : 0;
  const fallbackOutPoint = inPoint + (frameRate * 3);
  const outPoint = Number.isFinite(Number(animationData.op)) ? Number(animationData.op) : fallbackOutPoint;
  const normalizedOutPoint = Math.max(outPoint, inPoint + 1);
  const frameCount = Math.ceil(normalizedOutPoint - inPoint);

  return {
    frameRate,
    inPoint,
    outPoint: normalizedOutPoint,
    frameCount,
    durationMs: (frameCount / frameRate) * 1000
  };
}

function findExecutableFromCandidates(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;

    if (candidate.includes(path.sep) || candidate.includes('/')) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }

    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = childProcess.spawnSync(command, [candidate], {
      encoding: 'utf8',
      windowsHide: true
    });

    if (result.status === 0) {
      const firstLine = String(result.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);

      if (firstLine) return firstLine;
    }
  }

  return '';
}

function findBrowserExecutable() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidates = [
    process.env.MOJIFY_BROWSER_PATH,
    process.env.MOJIFY_CHROME_PATH,
    path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    'chrome',
    'chrome.exe',
    'msedge',
    'msedge.exe',
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
    'microsoft-edge'
  ];

  const browserPath = findExecutableFromCandidates(candidates);
  if (!browserPath) {
    throw new Error('Could not find Chrome, Edge, or Chromium. Set MOJIFY_BROWSER_PATH to the browser executable.');
  }

  return browserPath;
}

function findFfmpegExecutable() {
  const ffmpegPath = findExecutableFromCandidates([
    process.env.MOJIFY_FFMPEG_PATH,
    'ffmpeg',
    'ffmpeg.exe'
  ]);

  if (!ffmpegPath) {
    throw new Error('Could not find ffmpeg. Install it with Scoop first: scoop install ffmpeg');
  }

  return ffmpegPath;
}

function getRepoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function getLottieBundlePath() {
  const bundlePath = path.join(getRepoRoot(), 'extension', 'vendor', 'lottie_canvas.min.js');
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Missing lottie-web canvas bundle: ${bundlePath}`);
  }

  return bundlePath;
}

function createRenderHtml(tempDir, animationData, geometry) {
  const lottieScriptUrl = pathToFileURL(getLottieBundlePath()).href;
  const payload = JSON.stringify({ animationData, geometry }).replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {
      margin: 0;
      width: ${geometry.width}px;
      height: ${geometry.height}px;
      overflow: hidden;
      background: transparent;
    }
    #render-root {
      width: ${geometry.width}px;
      height: ${geometry.height}px;
      overflow: hidden;
      background: transparent;
    }
  </style>
</head>
<body>
  <div id="render-root"></div>
  <script src="${lottieScriptUrl}"></script>
  <script>
    const payload = ${payload};
    const root = document.getElementById('render-root');
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    window.mojifyReady = new Promise((resolve, reject) => {
      try {
        if (!window.lottie || !window.lottie.loadAnimation) {
          reject(new Error('lottie-web did not load'));
          return;
        }

        window.mojifyAnimation = window.lottie.loadAnimation({
          container: root,
          renderer: 'canvas',
          loop: false,
          autoplay: false,
          animationData: payload.animationData,
          rendererSettings: {
            clearCanvas: true,
            progressiveLoad: false,
            preserveAspectRatio: 'xMidYMid meet'
          }
        });

        window.mojifyAnimation.addEventListener('DOMLoaded', async () => {
          await nextFrame();
          resolve(true);
        });
      } catch (error) {
        reject(error);
      }
    });

    window.mojifyRenderFrame = async (frame) => {
      await window.mojifyReady;
      window.mojifyAnimation.goToAndStop(frame, true);
      await nextFrame();
      const canvas = root.querySelector('canvas');
      if (!canvas) {
        throw new Error('Lottie did not create a canvas');
      }
      return canvas.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '');
    };
  </script>
</body>
</html>`;

  const renderPath = path.join(tempDir, 'render.html');
  fs.writeFileSync(renderPath, html, 'utf8');
  return renderPath;
}

function waitForProcessOutput(processHandle, matcher, timeoutMs) {
  return new Promise((resolve, reject) => {
    let combinedOutput = '';
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for browser DevTools endpoint'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeoutId);
      processHandle.stderr.off('data', onData);
      processHandle.stdout.off('data', onData);
      processHandle.off('exit', onExit);
      processHandle.off('error', onError);
    }

    function onData(chunk) {
      combinedOutput += chunk.toString();
      const match = combinedOutput.match(matcher);
      if (match) {
        cleanup();
        resolve(match[1]);
      }
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`Browser exited before DevTools was ready (code ${code})`));
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    processHandle.stderr.on('data', onData);
    processHandle.stdout.on('data', onData);
    processHandle.on('exit', onExit);
    processHandle.on('error', onError);
  });
}

async function fetchJsonWithRetry(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError || new Error(`Timed out fetching ${url}`);
}

function getDevToolsHttpOrigin(browserWsUrl) {
  const parsed = new URL(browserWsUrl);
  return `http://${parsed.host}`;
}

async function getPageWebSocketUrl(browserWsUrl, renderPath) {
  const origin = getDevToolsHttpOrigin(browserWsUrl);
  const expectedUrl = pathToFileURL(renderPath).href;
  const pages = await fetchJsonWithRetry(`${origin}/json/list`, CDP_READY_TIMEOUT_MS);
  const page = pages.find((candidate) => candidate.type === 'page' && candidate.url === expectedUrl) ||
    pages.find((candidate) => candidate.type === 'page') ||
    pages[0];

  if (!page?.webSocketDebuggerUrl) {
    throw new Error('Could not find a debuggable browser page');
  }

  return page.webSocketDebuggerUrl;
}

class CdpClient {
  constructor(wsUrl) {
    if (typeof WebSocket !== 'function') {
      throw new Error('This Node.js runtime does not expose WebSocket. Use current Node.js from Scoop.');
    }

    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('Failed to connect to Chrome DevTools'));
    });

    this.ws.onmessage = (event) => {
      const rawData = typeof event.data === 'string'
        ? event.data
        : Buffer.from(event.data).toString('utf8');
      const payload = JSON.parse(rawData);

      if (!payload.id || !this.pending.has(payload.id)) {
        return;
      }

      const pendingCommand = this.pending.get(payload.id);
      this.pending.delete(payload.id);

      if (payload.error) {
        pendingCommand.reject(new Error(payload.error.message || 'Chrome DevTools command failed'));
      } else {
        pendingCommand.resolve(payload.result || {});
      }
    };

    this.ws.onclose = () => {
      for (const pendingCommand of this.pending.values()) {
        pendingCommand.reject(new Error('Chrome DevTools connection closed'));
      }
      this.pending.clear();
    };
  }

  async send(method, params = {}, timeoutMs = CDP_EVALUATE_TIMEOUT_MS) {
    await this.opened;

    const id = this.nextId;
    this.nextId += 1;

    const responsePromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools command timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
    });

    this.ws.send(JSON.stringify({ id, method, params }));
    return responsePromise;
  }

  close() {
    try {
      this.ws.close();
    } catch (error) {
      // Best-effort cleanup.
    }
  }
}

function spawnBrowser(browserPath, renderPath, tempDir, geometry) {
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${path.join(tempDir, 'browser-profile')}`,
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-gpu',
    '--disable-sync',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-default-browser-check',
    '--no-first-run',
    '--allow-file-access-from-files',
    `--window-size=${geometry.width},${geometry.height}`,
    pathToFileURL(renderPath).href
  ];

  return childProcess.spawn(browserPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

async function renderFramesWithBrowser(animationData, tempDir, geometry, timing) {
  const renderPath = createRenderHtml(tempDir, animationData, geometry);
  const browserPath = findBrowserExecutable();
  const browser = spawnBrowser(browserPath, renderPath, tempDir, geometry);
  let cdp = null;

  try {
    const browserWsUrl = await waitForProcessOutput(browser, /DevTools listening on (ws:\/\/[^\s]+)/, CDP_READY_TIMEOUT_MS);
    const pageWsUrl = await getPageWebSocketUrl(browserWsUrl, renderPath);
    cdp = new CdpClient(pageWsUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: geometry.width,
      height: geometry.height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: geometry.width,
      screenHeight: geometry.height
    });
    await cdp.send('Runtime.evaluate', {
      expression: 'window.mojifyReady',
      awaitPromise: true,
      returnByValue: true
    });

    for (let index = 0; index < timing.frameCount; index += 1) {
      const frame = timing.inPoint + index;
      const result = await cdp.send('Runtime.evaluate', {
        expression: `window.mojifyRenderFrame(${JSON.stringify(frame)})`,
        awaitPromise: true,
        returnByValue: true
      });
      const base64Png = result?.result?.value;

      if (!base64Png) {
        throw new Error(`Chrome returned an empty render for frame ${index + 1}`);
      }

      fs.writeFileSync(
        path.join(tempDir, `frame_${String(index).padStart(5, '0')}.png`),
        Buffer.from(base64Png, 'base64')
      );
    }
  } finally {
    if (cdp) cdp.close();
    if (!browser.killed) {
      browser.kill();
    }
  }
}

function runFfmpegLossless(tempDir, timing) {
  const ffmpegPath = findFfmpegExecutable();
  const outputPath = path.join(tempDir, 'output.webm');
  const inputPattern = path.join(tempDir, 'frame_%05d.png');
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(timing.frameRate),
    '-i',
    inputPattern,
    '-an',
    '-c:v',
    'libvpx-vp9',
    '-lossless',
    '1',
    '-pix_fmt',
    'yuva420p',
    '-auto-alt-ref',
    '0',
    '-deadline',
    'best',
    '-row-mt',
    '1',
    outputPath
  ];

  const result = childProcess.spawnSync(ffmpegPath, args, {
    encoding: 'utf8',
    timeout: FFMPEG_TIMEOUT_MS,
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${String(result.stderr || result.stdout || '').trim()}`);
  }

  const output = fs.readFileSync(outputPath);
  if (output.length === 0) {
    throw new Error('ffmpeg produced an empty WebM');
  }

  return output;
}

async function convertTgsBufferToWebm(tgsBuffer) {
  const animationData = parseTgsAnimation(tgsBuffer);
  const geometry = getAnimationGeometry(animationData);
  const timing = getAnimationTiming(animationData);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojify-tgs-'));

  try {
    await renderFramesWithBrowser(animationData, tempDir, geometry, timing);
    const output = runFfmpegLossless(tempDir, timing);

    return {
      output,
      metadata: {
        mimeType: 'video/webm',
        size: output.length,
        width: geometry.width,
        height: geometry.height,
        durationMs: timing.durationMs,
        frameRate: timing.frameRate,
        frameCount: timing.frameCount,
        renderer: RENDERER_NAME,
        encoder: ENCODER_NAME,
        lossless: true
      }
    };
  } finally {
    if (process.env.MOJIFY_KEEP_TGS_TEMP === '1') {
      log(`Keeping temp render directory: ${tempDir}`);
    } else {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function writeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(header);
  process.stdout.write(payload);
}

function writeChunkedConversion(id, base64Payload, metadata) {
  const totalChunks = Math.max(1, Math.ceil(base64Payload.length / CHUNK_SIZE));

  for (let seq = 0; seq < totalChunks; seq += 1) {
    const start = seq * CHUNK_SIZE;
    writeNativeMessage({
      id,
      type: 'conversionChunk',
      seq,
      total: totalChunks,
      data: base64Payload.slice(start, start + CHUNK_SIZE)
    });
  }

  writeNativeMessage({
    id,
    type: 'conversionComplete',
    success: true,
    ...metadata
  });
}

async function handleNativeMessage(message) {
  const id = message.id || crypto.randomUUID();
  const messageType = message.type || message.action;

  try {
    if (messageType !== 'convertTelegramTgsToWebm') {
      throw new Error(`Unsupported native host message: ${messageType || 'unknown'}`);
    }

    const tgsBuffer = parseTgsMessagePayload(message);
    const result = await convertTgsBufferToWebm(tgsBuffer);
    writeChunkedConversion(id, result.output.toString('base64'), result.metadata);
  } catch (error) {
    writeNativeMessage({
      id,
      type: 'conversionError',
      success: false,
      error: error.message || 'Native TGS conversion failed'
    });
  }
}

function startNativeMessagingLoop() {
  let inputBuffer = Buffer.alloc(0);

  process.stdin.on('data', (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);

    while (inputBuffer.length >= 4) {
      const messageLength = inputBuffer.readUInt32LE(0);
      if (inputBuffer.length < messageLength + 4) {
        break;
      }

      const messageBuffer = inputBuffer.subarray(4, 4 + messageLength);
      inputBuffer = inputBuffer.subarray(4 + messageLength);

      Promise.resolve()
        .then(() => handleNativeMessage(JSON.parse(messageBuffer.toString('utf8'))))
        .catch((error) => {
          log('Unhandled native message failure:', error.message || error);
        });
    }
  });

  process.stdin.on('end', () => process.exit(0));
}

function createSelfTestTgsBuffer() {
  const animationData = {
    v: '5.7.4',
    fr: 60,
    ip: 0,
    op: 60,
    w: 128,
    h: 128,
    nm: 'mojify-native-self-test',
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: 'moving square',
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: {
            a: 1,
            k: [
              { t: 0, s: [32, 64, 0], e: [96, 64, 0], i: { x: [0.833], y: [0.833] }, o: { x: [0.167], y: [0.167] } },
              { t: 59, s: [96, 64, 0] }
            ]
          },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] }
        },
        ao: 0,
        shapes: [
          {
            ty: 'rc',
            d: 1,
            s: { a: 0, k: [44, 44] },
            p: { a: 0, k: [0, 0] },
            r: { a: 0, k: 10 },
            nm: 'square path'
          },
          {
            ty: 'fl',
            c: { a: 0, k: [0.18, 0.78, 1, 1] },
            o: { a: 0, k: 100 },
            nm: 'fill'
          }
        ],
        ip: 0,
        op: 60,
        st: 0,
        bm: 0
      }
    ]
  };

  return zlib.gzipSync(Buffer.from(JSON.stringify(animationData), 'utf8'));
}

async function runSelfTest() {
  const tgsBuffer = createSelfTestTgsBuffer();
  const result = await convertTgsBufferToWebm(tgsBuffer);
  process.stdout.write(`${JSON.stringify(result.metadata, null, 2)}\n`);
}

if (process.argv.includes('--self-test')) {
  runSelfTest().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  startNativeMessagingLoop();
}

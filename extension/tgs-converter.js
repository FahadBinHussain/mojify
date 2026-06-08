const TGS_RENDER_ROOT_ID = 'render-root';
const TGS_CONVERSION_TIMEOUT_MS = 12000;

function dataUrlToUint8Array(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) {
    throw new Error('Invalid TGS data URL');
  }

  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function gunzipTgsJson(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser does not support local TGS decompression');
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to serialize converted TGS media'));
    reader.readAsDataURL(blob);
  });
}

function waitForAnimationEvent(animation, eventName, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Lottie ${eventName}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeoutId);
      animation.removeEventListener(eventName, handleEvent);
    }

    function handleEvent() {
      cleanup();
      resolve();
    }

    animation.addEventListener(eventName, handleEvent);
  });
}

function waitForNextFrame(count = 1) {
  return new Promise((resolve) => {
    const step = () => {
      count -= 1;
      if (count <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  });
}

function getAnimationBounds(animationData = {}) {
  const width = Math.min(Math.max(Number(animationData.w || 512), 16), 512);
  const height = Math.min(Math.max(Number(animationData.h || 512), 16), 512);

  return {
    width: Math.round(width),
    height: Math.round(height)
  };
}

function getAnimationTiming(animationData = {}, animation = null) {
  const sourceFrameRate = Math.min(Math.max(Number(animationData.fr || 30), 1), 60);
  const inPoint = Number.isFinite(Number(animationData.ip)) ? Number(animationData.ip) : 0;
  const outPoint = Number.isFinite(Number(animationData.op))
    ? Number(animationData.op)
    : Number(animation?.totalFrames || sourceFrameRate * 3);
  const durationMs = Math.min(
    Math.max(((Math.max(outPoint, inPoint + 1) - inPoint) / sourceFrameRate) * 1000, 100),
    6000
  );
  const outputFrameRate = Math.min(Math.max(Math.round(sourceFrameRate), 15), 60);

  return {
    inPoint,
    outPoint,
    durationMs,
    outputFrameRate
  };
}

function chooseRecorderMimeType() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

async function recordLottieAnimation(animation, canvas, animationData) {
  if (!canvas?.captureStream) {
    throw new Error('Canvas capture is not available for TGS conversion');
  }

  if (typeof MediaRecorder !== 'function') {
    throw new Error('MediaRecorder is not available for TGS conversion');
  }

  const timing = getAnimationTiming(animationData, animation);
  const mimeType = chooseRecorderMimeType();
  if (!mimeType) {
    throw new Error('This browser cannot encode WebM for TGS conversion');
  }

  const stream = canvas.captureStream(timing.outputFrameRate);
  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 1_200_000
  });

  let recorderError = null;
  recorder.ondataavailable = (event) => {
    if (event.data?.size) {
      chunks.push(event.data);
    }
  };
  recorder.onerror = (event) => {
    recorderError = event.error || new Error('MediaRecorder failed during TGS conversion');
  };

  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve();
  });

  animation.loop = false;
  animation.setSpeed(1);
  animation.goToAndStop(timing.inPoint, true);
  await waitForNextFrame(2);

  recorder.start(100);

  const completed = waitForAnimationEvent(
    animation,
    'complete',
    Math.ceil(timing.durationMs) + TGS_CONVERSION_TIMEOUT_MS
  );

  animation.playSegments([timing.inPoint, timing.outPoint], true);
  await completed;
  await waitForNextFrame(2);

  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());

  if (recorderError) {
    throw recorderError;
  }

  if (chunks.length === 0) {
    throw new Error('TGS conversion produced no video data');
  }

  const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
  if (blob.size === 0) {
    throw new Error('TGS conversion produced an empty video');
  }

  return {
    blob,
    durationMs: timing.durationMs,
    frameRate: timing.outputFrameRate
  };
}

async function convertTgsToWebm({ tgsDataUrl, label = 'Telegram sticker' } = {}) {
  if (!window.lottie?.loadAnimation) {
    throw new Error('Lottie renderer is unavailable');
  }

  const bytes = dataUrlToUint8Array(tgsDataUrl);
  const jsonText = await gunzipTgsJson(bytes);
  const animationData = JSON.parse(jsonText);
  const bounds = getAnimationBounds(animationData);
  const root = document.getElementById(TGS_RENDER_ROOT_ID);

  root.innerHTML = '';
  root.style.width = `${bounds.width}px`;
  root.style.height = `${bounds.height}px`;

  const container = document.createElement('div');
  container.style.width = `${bounds.width}px`;
  container.style.height = `${bounds.height}px`;
  root.appendChild(container);

  let animation = null;

  try {
    animation = window.lottie.loadAnimation({
      container,
      renderer: 'canvas',
      loop: false,
      autoplay: false,
      animationData,
      rendererSettings: {
        clearCanvas: true,
        progressiveLoad: false,
        preserveAspectRatio: 'xMidYMid meet'
      }
    });

    await waitForAnimationEvent(animation, 'DOMLoaded');
    await waitForNextFrame(2);

    const canvas = container.querySelector('canvas');
    if (!canvas) {
      throw new Error('Lottie did not create a render canvas');
    }

    canvas.width = bounds.width;
    canvas.height = bounds.height;
    canvas.setAttribute('aria-label', label);

    const result = await recordLottieAnimation(animation, canvas, animationData);
    const dataUrl = await blobToDataUrl(result.blob);

    return {
      success: true,
      dataUrl,
      mimeType: result.blob.type || 'video/webm',
      size: result.blob.size,
      width: bounds.width,
      height: bounds.height,
      durationMs: result.durationMs,
      frameRate: result.frameRate
    };
  } finally {
    if (animation) {
      animation.destroy();
    }
    root.innerHTML = '';
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'convertTelegramTgsToWebm') {
    return false;
  }

  convertTgsToWebm(message)
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({
        success: false,
        error: error.message || 'TGS conversion failed'
      });
    });

  return true;
});

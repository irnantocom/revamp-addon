import { AttachmentError, LIMITS, type ReaderDeps } from './attachment-reader';

const EVENT_TIMEOUT_MS = 10_000;

/** Claude accepts images up to 5 MB; larger ones are re-encoded even when their pixel size is fine */
export const MAX_PASSTHROUGH_BYTES = 3.5 * 1024 * 1024;

/**
 * Whether an image must be re-encoded instead of sent as it is: when it has to be resized, when it is a
 * GIF (Gemini does not take GIFs, OpenAI only non-animated ones), or when the file is too big for Claude.
 */
export function needsReencode(mime: string, byteLength: number, fits: boolean): boolean {
  return !fits || mime === 'image/gif' || byteLength > MAX_PASSTHROUGH_BYTES;
}

/** Largest size within `maxEdge` that keeps the aspect ratio. Never enlarges and never returns a 0 side. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Seconds to capture: the middle of `count` equal slices of the clip. An unknown or zero duration gives just the first frame. */
export function frameTimes(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  return Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);
}

const canvasToBytes = (canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality: number): Promise<Uint8Array> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject) : reject(new Error('Could not encode image'))),
      type,
      quality
    )
  );
const canvasToJpeg = (canvas: HTMLCanvasElement, quality: number) => canvasToBytes(canvas, 'image/jpeg', quality);

async function downscaleImage(bytes: Uint8Array, mime: string, maxEdge: number): Promise<{ mime: string; data: Uint8Array }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  } catch {
    throw new AttachmentError('This image could not be read. It may be damaged.');
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const fits = width === bitmap.width && height === bitmap.height;
    if (!needsReencode(mime, bytes.length, fits)) return { mime, data: bytes };

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new AttachmentError('This image could not be resized.');
    // A GIF becomes a PNG (its first frame, transparency kept); everything else becomes a JPEG
    const asPng = mime === 'image/gif';
    if (!asPng) {
      // JPEG has no transparency: without a background, transparent areas turn black
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0, width, height);
    return asPng
      ? { mime: 'image/png', data: await canvasToBytes(canvas, 'image/png', 1) }
      : { mime: 'image/jpeg', data: await canvasToJpeg(canvas, maxEdge === LIMITS.thumbEdge ? 0.6 : 0.85) };
  } finally {
    bitmap.close();
  }
}

const VIDEO_ERROR = 'Chrome could not decode this video. Try an MP4 (H.264) or WebM file.';

function waitForEvent(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: AttachmentError) => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onEvent = () => done();
    const onError = () => done(new AttachmentError(VIDEO_ERROR));
    const timer = setTimeout(() => done(new AttachmentError(VIDEO_ERROR)), EVENT_TIMEOUT_MS);
    target.addEventListener(event, onEvent);
    target.addEventListener('error', onError);
  });
}

async function videoFrames(file: File, count: number, maxEdge: number): Promise<{ frames: Uint8Array[]; times: number[] }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    const loaded = waitForEvent(video, 'loadeddata');
    video.src = url;
    await loaded;
    if (!video.videoWidth || !video.videoHeight) throw new AttachmentError(VIDEO_ERROR);

    const { width, height } = fitWithin(video.videoWidth, video.videoHeight, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new AttachmentError(VIDEO_ERROR);

    const times = frameTimes(video.duration, count);
    const frames: Uint8Array[] = [];
    for (const time of times) {
      if (Math.abs(video.currentTime - time) > 0.001) {
        const seeked = waitForEvent(video, 'seeked');
        video.currentTime = time;
        await seeked;
      }
      context.drawImage(video, 0, 0, width, height);
      frames.push(await canvasToJpeg(canvas, 0.8));
    }
    return { frames, times };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

export const defaultReaderDeps: ReaderDeps = { downscaleImage, videoFrames };

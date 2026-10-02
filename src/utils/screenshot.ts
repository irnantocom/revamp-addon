/**
 * Page screenshots built from chrome.tabs.captureVisibleTab frames.
 * Chrome only captures the visible viewport, so a full-page shot scrolls the
 * page and stitches the frames together on a canvas.
 */

const MAX_CANVAS_PX = 30000; // browsers fail on canvases taller than ~32k px
const CAPTURE_INTERVAL_MS = 600; // captureVisibleTab is limited to ~2 calls per second
const SETTLE_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode screenshot frame'));
    img.src = src;
  });

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode screenshot'))), 'image/png')
  );

/** Fixed/sticky elements would repeat in every frame; hide them after the first */
function hideFixedElements(): () => void {
  const hidden: Array<{ el: HTMLElement; visibility: string; priority: string }> = [];
  document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
    if (el.closest('[data-revamp-ui]')) return;
    const position = getComputedStyle(el).position;
    if (position === 'fixed' || position === 'sticky') {
      hidden.push({ el, visibility: el.style.getPropertyValue('visibility'), priority: el.style.getPropertyPriority('visibility') });
      el.style.setProperty('visibility', 'hidden', 'important');
    }
  });
  return () =>
    hidden.forEach(({ el, visibility, priority }) => {
      if (visibility) el.style.setProperty('visibility', visibility, priority);
      else el.style.removeProperty('visibility');
    });
}

export interface ScreenshotResult {
  blob: Blob;
  /** True if the page was taller than the browser can render in one image */
  truncated: boolean;
}

export async function captureScreenshot(
  fullPage: boolean,
  captureFrame: () => Promise<string>
): Promise<ScreenshotResult> {
  const originalX = window.scrollX;
  const originalY = window.scrollY;
  const dpr = window.devicePixelRatio || 1;
  const viewportH = window.innerHeight;
  const viewportW = document.documentElement.clientWidth;

  if (!fullPage) {
    await sleep(SETTLE_MS);
    const frame = await loadImage(await captureFrame());
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext('2d')!.drawImage(frame, 0, 0);
    return { blob: await canvasToBlob(canvas), truncated: false };
  }

  const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const maxHeight = Math.floor(MAX_CANVAS_PX / dpr);
  const totalHeight = Math.min(pageHeight, maxHeight);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewportW * dpr);
  canvas.height = Math.round(totalHeight * dpr);
  const ctx = canvas.getContext('2d')!;

  // Prevent smooth scrolling from delaying scrollTo
  const root = document.documentElement;
  const previousBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';

  let restoreFixed: (() => void) | null = null;
  // Bottom edge (canvas px) already painted by earlier frames. Later frames only fill
  // below it, so hidden sticky elements in them can't erase what the first frame captured.
  let drawnBottom = 0;

  try {
    for (let y = 0, frameIndex = 0; y < totalHeight; y += viewportH, frameIndex++) {
      if (frameIndex === 1) restoreFixed = hideFixedElements();

      window.scrollTo(0, y);
      await sleep(frameIndex === 0 ? SETTLE_MS : CAPTURE_INTERVAL_MS);

      // The last frame can't scroll past the end, so draw where the page really is
      const actualY = window.scrollY;
      const frame = await loadImage(await captureFrame());
      const top = Math.round(actualY * dpr);
      const skip = Math.max(0, drawnBottom - top);
      if (skip < frame.height) {
        ctx.drawImage(frame, 0, skip, frame.width, frame.height - skip, 0, top + skip, frame.width, frame.height - skip);
      }
      drawnBottom = Math.max(drawnBottom, top + frame.height);
    }
  } finally {
    restoreFixed?.();
    root.style.scrollBehavior = previousBehavior;
    window.scrollTo(originalX, originalY);
  }

  return { blob: await canvasToBlob(canvas), truncated: pageHeight > totalHeight };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.setAttribute('data-revamp-ui', 'true');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

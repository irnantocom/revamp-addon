// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentError, LIMITS, readAttachment, type ReaderDeps } from '../src/utils/attachment-reader';
import { MAX_REQUEST_BYTES } from '../src/utils/chat-content';

const ALL = { image: true, pdf: true };
const MB = 1024 * 1024;
const b64 = (...values: number[]) => Buffer.from(values).toString('base64');

const file = (bytes: Uint8Array | string, name: string, type = '') =>
  new File([typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes], name, { type });

const padded = (head: number[] | string, length: number): Uint8Array => {
  const out = new Uint8Array(length);
  out.set(typeof head === 'string' ? new TextEncoder().encode(head) : head);
  return out;
};
const PNG = [0x89, 0x50, 0x4e, 0x47];

const makeDeps = (overrides: Partial<ReaderDeps> = {}): ReaderDeps => ({
  downscaleImage: vi.fn(async (_bytes, mime, edge) => ({
    mime,
    data: edge === LIMITS.thumbEdge ? Uint8Array.of(1, 1) : Uint8Array.of(7, 8, 9),
  })),
  videoFrames: vi.fn(async () => ({
    frames: [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6), Uint8Array.of(7, 8, 9)],
    times: [1, 12, 23],
  })),
  ...overrides,
});

const rejects = async (promise: Promise<unknown>, message: RegExp) => {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(AttachmentError);
  expect(error.message).toMatch(message);
};

describe('readAttachment: rejecting files', () => {
  it('rejects a web page renamed to .png, from its bytes', async () => {
    await rejects(readAttachment(file('<!doctype html><p>x</p>', 'x.png', 'image/png'), ALL, makeDeps()), /"x\.png" is not a supported file/);
  });

  it('rejects SVG with a hint', async () => {
    await rejects(readAttachment(file('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'logo.svg', 'image/svg+xml'), ALL, makeDeps()), /SVG is not supported/);
  });

  it('rejects an empty file', async () => {
    await rejects(readAttachment(file(new Uint8Array(0), 'a.png'), ALL, makeDeps()), /"a\.png" is empty/);
  });

  it('rejects an image over 10 MB', async () => {
    await rejects(readAttachment(file(padded(PNG, 11 * MB), 'big.png'), ALL, makeDeps()), /larger than 10 MB/);
  });

  it('rejects a PDF whose base64 form could never fit the request budget', async () => {
    await rejects(readAttachment(file(padded('%PDF-1.7', 12 * MB), 'big.pdf'), ALL, makeDeps()), /larger than 11 MB/);
  });

  it('keeps every single-file limit small enough to fit the request budget once encoded as base64', () => {
    for (const limit of [LIMITS.imageBytes, LIMITS.pdfBytes]) {
      expect(Math.ceil((limit * 4) / 3)).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    }
  });

  it('rejects a PDF when the provider does not accept PDFs', async () => {
    await rejects(readAttachment(file('%PDF-1.7 x', 'a.pdf'), { image: true, pdf: false }, makeDeps()), /does not accept PDF/);
  });

  it('rejects images and videos when the provider does not accept images', async () => {
    const none = { image: false, pdf: false };
    await rejects(readAttachment(file(padded(PNG, 20), 'a.png'), none, makeDeps()), /does not accept images/);
    await rejects(readAttachment(file(padded('\0\0\0\x18ftypmp42', 32), 'a.mp4'), none, makeDeps()), /does not accept images/);
  });

  it('rejects a corrupt Word file', async () => {
    await rejects(readAttachment(file(padded([0x50, 0x4b, 3, 4], 40), 'x.docx'), ALL, makeDeps()), /could not be read/);
  });
});

describe('readAttachment: results', () => {
  it('turns an image into one image part built from the downscaled bytes, using the sniffed type', async () => {
    const deps = makeDeps();
    const result = await readAttachment(file(padded(PNG, 100), 'a.png', 'image/jpeg'), ALL, deps);

    expect(deps.downscaleImage).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/png', LIMITS.imageMaxEdge);
    expect(result.parts).toEqual([{ type: 'image', mime: 'image/png', data: b64(7, 8, 9) }]);
    expect(result.meta).toMatchObject({ name: 'a.png', kind: 'image', mime: 'image/png', size: 100 });
    expect(result.meta.thumb).toBe(`data:image/png;base64,${b64(1, 1)}`);
    expect(result.meta.id).toMatch(/[0-9a-f-]{36}/);
    expect(result.bytes).toBe(b64(7, 8, 9).length);
  });

  it('drops a thumbnail that is too long for the chat history', async () => {
    const deps = makeDeps({
      downscaleImage: vi.fn(async (_b, mime, edge) => ({ mime, data: edge === LIMITS.thumbEdge ? new Uint8Array(20000) : Uint8Array.of(7) })),
    });
    const result = await readAttachment(file(padded(PNG, 100), 'a.png'), ALL, deps);
    expect(result.meta.thumb).toBeUndefined();
  });

  it('keeps a PDF as one pdf part without a thumbnail', async () => {
    const result = await readAttachment(file('%PDF-1.7 x', 'a.pdf'), ALL, makeDeps());
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ type: 'pdf', name: 'a.pdf' });
    expect(result.meta).toMatchObject({ kind: 'pdf', mime: 'application/pdf' });
    expect(result.meta.thumb).toBeUndefined();
  });

  it('turns a video into a description plus one image per frame', async () => {
    const result = await readAttachment(file(padded('\0\0\0\x18ftypmp42', 64), 'clip.mp4'), ALL, makeDeps());

    expect(result.parts).toHaveLength(4);
    expect(result.parts[0]).toEqual({ type: 'text', text: 'Frames sampled from video "clip.mp4" at 1s, 12s, 23s' });
    expect(result.parts.slice(1)).toEqual([
      { type: 'image', mime: 'image/jpeg', data: b64(1, 2, 3) },
      { type: 'image', mime: 'image/jpeg', data: b64(4, 5, 6) },
      { type: 'image', mime: 'image/jpeg', data: b64(7, 8, 9) },
    ]);
    expect(result.meta).toMatchObject({ kind: 'video', mime: 'video/mp4' });
    expect(result.meta.thumb).toBeDefined();
    const expected = result.parts.reduce((sum, p) => sum + (p.type === 'text' ? p.text.length : p.data.length), 0);
    expect(result.bytes).toBe(expected);
  });

  it('wraps a text document and counts its bytes', async () => {
    const result = await readAttachment(file('a,b\n1,2', 'data.csv'), ALL, makeDeps());
    expect(result.parts).toEqual([{ type: 'text', text: '<attached_file name="data.csv">\na,b\n1,2\n</attached_file>' }]);
    expect(result.meta.kind).toBe('document');
    expect(result.bytes).toBe((result.parts[0] as { text: string }).text.length);
  });

  it('truncates a very long document with the marker', async () => {
    const result = await readAttachment(file('x'.repeat(LIMITS.documentChars + 10), 'long.txt'), ALL, makeDeps());
    expect((result.parts[0] as { text: string }).text).toContain(`…[TRUNCATED: ${LIMITS.documentChars + 10} chars total]`);
  });

  it('reads a Word file', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Hi there</w:t></w:r></w:p></w:body></w:document>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const result = await readAttachment(file(bytes, 'brief.docx'), ALL, makeDeps());
    expect((result.parts[0] as { text: string }).text).toContain('Hi there');
  });

  it('passes a video decoding error on unchanged', async () => {
    const deps = makeDeps({ videoFrames: vi.fn().mockRejectedValue(new AttachmentError('Chrome could not decode this video.')) });
    await rejects(readAttachment(file(padded('\0\0\0\x18ftypmp42', 64), 'a.mp4'), ALL, deps), /could not decode/);
  });
});

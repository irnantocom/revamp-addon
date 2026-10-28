export type SniffedType = 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'mp4' | 'webm' | 'docx' | 'text';

const TEXT_NAME = /\.(txt|md|csv|json|html)$/i;
const TEXT_PROBE_BYTES = 4096;

const codes = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));
const matches = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((value, i) => bytes[offset + i] === value);

/**
 * Decide what a file really is from its first bytes. The extension and the browser's file.type
 * are only hints a user (or an attacker) can change, so they are not trusted; SVG is never accepted.
 */
export function sniffFileType(bytes: Uint8Array, name: string): SniffedType | null {
  if (bytes.length === 0) return null;

  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (matches(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (matches(bytes, codes('GIF87a')) || matches(bytes, codes('GIF89a'))) return 'gif';
  if (matches(bytes, codes('RIFF')) && matches(bytes, codes('WEBP'), 8)) return 'webp';
  if (matches(bytes, codes('%PDF-'))) return 'pdf';
  if (matches(bytes, codes('ftyp'), 4)) return 'mp4';
  if (matches(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  if (matches(bytes, [0x50, 0x4b, 0x03, 0x04]) && /\.docx$/i.test(name)) return 'docx';

  if (TEXT_NAME.test(name) && !bytes.subarray(0, TEXT_PROBE_BYTES).includes(0)) return 'text';
  return null;
}

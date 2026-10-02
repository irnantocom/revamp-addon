import { DemoConfig } from '../types/demo';

const PREFIX = 'revamp1:';

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string): Uint8Array => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const written = writer.write(bytes as BufferSource).then(() => writer.close());
  const output = new Response(stream.readable).arrayBuffer();
  // Promise.all observes both sides, so a failing stream rejects once instead of leaving an unhandled rejection
  const [, buffer] = await Promise.all([written, output]);
  return new Uint8Array(buffer);
}

/** Compact, copy-pasteable text form of a demo (gzip + base64url). No server involved. */
export async function encodeShareCode(config: DemoConfig): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(config));
  return PREFIX + toBase64Url(await pipe(json, new CompressionStream('gzip')));
}

export async function decodeShareCode(code: string): Promise<DemoConfig> {
  const trimmed = code.trim();
  if (!trimmed.startsWith(PREFIX)) throw new Error('Not a Revamp share code');

  try {
    const bytes = await pipe(fromBase64Url(trimmed.slice(PREFIX.length)), new DecompressionStream('gzip'));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The share code is damaged or incomplete');
  }
}

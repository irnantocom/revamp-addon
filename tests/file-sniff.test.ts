// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sniffFileType } from '../src/utils/file-sniff';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);
const withTail = (head: Uint8Array, length = 32) => {
  const out = new Uint8Array(length);
  out.set(head);
  return out;
};

describe('sniffFileType', () => {
  it('trusts the bytes, not the extension', () => {
    expect(sniffFileType(withTail(bytes(0x89, 0x50, 0x4e, 0x47)), 'photo.jpg')).toBe('png');
    expect(sniffFileType(withTail(bytes(0xff, 0xd8, 0xff, 0xe0)), 'noext')).toBe('jpeg');
    expect(sniffFileType(ascii('GIF89a......'), 'a.gif')).toBe('gif');
    expect(sniffFileType(ascii('RIFF....WEBPVP8 '), 'a.webp')).toBe('webp');
    expect(sniffFileType(ascii('%PDF-1.7\n'), 'noext')).toBe('pdf');
    expect(sniffFileType(withTail(ascii('\0\0\0\x18ftypmp42')), 'a.mp4')).toBe('mp4');
    expect(sniffFileType(withTail(bytes(0x1a, 0x45, 0xdf, 0xa3)), 'a.webm')).toBe('webm');
  });

  it('rejects files that only pretend to be something else', () => {
    expect(sniffFileType(ascii('<!doctype html><html></html>'), 'x.png')).toBeNull();
    expect(sniffFileType(ascii('MZ\x90\0\x03\0\0\0'), 'x.pdf')).toBeNull();
    expect(sniffFileType(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'x.svg')).toBeNull();
  });

  it('accepts a DOCX only when it is a ZIP named .docx', () => {
    expect(sniffFileType(withTail(bytes(0x50, 0x4b, 3, 4)), 'brief.docx')).toBe('docx');
    expect(sniffFileType(withTail(bytes(0x50, 0x4b, 3, 4)), 'archive.zip')).toBeNull();
  });

  it('accepts plain text by extension but not when it contains NUL bytes', () => {
    expect(sniffFileType(ascii('a,b\n1,2\n'), 'data.csv')).toBe('text');
    expect(sniffFileType(ascii('# title'), 'README.MD')).toBe('text');
    expect(sniffFileType(ascii('{"a":1}'), 'x.json')).toBe('text');
    expect(sniffFileType(ascii('<p>x</p>'), 'x.html')).toBe('text');
    expect(sniffFileType(bytes(0x61, 0, 0x62), 'x.csv')).toBeNull();
    expect(sniffFileType(ascii('plain'), 'x.exe')).toBeNull();
  });

  it('returns null for an empty file', () => {
    expect(sniffFileType(new Uint8Array(0), 'a.png')).toBeNull();
  });
});

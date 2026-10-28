import JSZip from 'jszip';

const DOCX_ERROR = 'This Word file could not be read.';

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

const decodeEntities = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Text of a .docx: one line per paragraph. Images, tables' layout and formatting are dropped. */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const entry = zip.file('word/document.xml');
    if (!entry) throw new Error('no document.xml');
    const xml = await entry.async('string');
    const text = xml
      .replace(/<w:tab\s*\/>/g, '\t')
      .replace(/<w:br\s*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '');
    return decodeEntities(text).replace(/\s+$/, '');
  } catch {
    throw new Error(DOCX_ERROR);
  }
}

/** Same marker style the page index uses for text it had to cut */
export function limitText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[TRUNCATED: ${text.length} chars total]`;
}

/**
 * Put a document's text in a delimited block so the model treats it as data. The closing tag is
 * defused inside the text, so a file cannot end the block early and pose as instructions.
 */
export function wrapDocument(name: string, text: string): string {
  const safeName = name.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeText = text.replace(/<\/attached_file/gi, '<\\/attached_file');
  return `<attached_file name="${safeName}">\n${safeText}\n</attached_file>`;
}

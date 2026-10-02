import { AnnotationInfo, DemoConfig } from '../types/demo';
import { describeOperation } from './demo-versions';

export interface HandoffInput {
  config: DemoConfig;
  notes: AnnotationInfo[];
  /** File names of the screenshots inside the package, if captured */
  beforeImage?: string;
  afterImage?: string;
  generatedAt?: Date;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escapeMd = (text: string): string => text.replace(/([\\`*_{}\[\]<>|])/g, '\\$1').replace(/\n+/g, ' ');

/** The same facts rendered once as Markdown (for tickets) and once as standalone HTML (for sharing) */
export function buildHandoffReport(input: HandoffInput): { markdown: string; html: string } {
  const { config, notes, beforeImage, afterImage } = input;
  const date = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  const title = config.name || 'Revamp demo';
  const changes = config.operations.map((op) => ({
    text: describeOperation(op),
    where: op.target.selector,
    why: op.explanation,
  }));
  const open = notes.filter((n) => !n.resolved);
  const done = notes.filter((n) => n.resolved);

  // ---- Markdown ----
  const md: string[] = [
    `# ${escapeMd(title)}`,
    '',
    `- **Page:** ${config.url}`,
    `- **Date:** ${date}`,
    `- **Changes:** ${changes.length}  ·  **Open notes:** ${open.length}`,
    '',
    'This describes a temporary visual demo made in the browser. The live website was not modified.',
    '',
  ];
  if (beforeImage || afterImage) {
    md.push('## Before / after', '');
    if (beforeImage) md.push(`![Before](${beforeImage})`, '');
    if (afterImage) md.push(`![After](${afterImage})`, '');
  }
  md.push('## Changes to implement', '');
  if (changes.length === 0) md.push('_No changes._', '');
  changes.forEach((c, i) => {
    md.push(`${i + 1}. ${escapeMd(c.text)}${c.why ? ` — _${escapeMd(c.why)}_` : ''}`);
    md.push(`   - Element: \`${c.where.replace(/`/g, "'")}\``);
  });
  md.push('', '## Notes', '');
  if (notes.length === 0) md.push('_No notes._');
  open.forEach((n) => md.push(`- [ ] ${escapeMd(n.text)} (${escapeMd(n.elementLabel)})`));
  done.forEach((n) => md.push(`- [x] ${escapeMd(n.text)} (${escapeMd(n.elementLabel)})`));
  md.push('');

  // ---- HTML ----
  const li = (content: string) => `<li>${content}</li>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font:15px/1.55 system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#111827}
  h1{margin-bottom:4px} h2{margin-top:32px;border-bottom:1px solid #e5e7eb;padding-bottom:6px}
  .meta{color:#6b7280;font-size:13px} code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:12px;word-break:break-all}
  img{max-width:100%;border:1px solid #e5e7eb;border-radius:6px} .pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:700px){.pair{grid-template-columns:1fr}} .done{color:#6b7280;text-decoration:line-through}
  figure{margin:0} figcaption{font-weight:600;margin-bottom:6px}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${escapeHtml(config.url)} · ${date} · ${changes.length} change(s) · ${open.length} open note(s)</p>
<p>A temporary visual demo made in the browser. The live website was not modified.</p>
${beforeImage || afterImage ? `<h2>Before / after</h2><div class="pair">
${beforeImage ? `<figure><figcaption>Before</figcaption><img src="${escapeHtml(beforeImage)}" alt="Before"></figure>` : ''}
${afterImage ? `<figure><figcaption>After</figcaption><img src="${escapeHtml(afterImage)}" alt="After"></figure>` : ''}
</div>` : ''}
<h2>Changes to implement</h2>
${changes.length === 0 ? '<p>No changes.</p>' : `<ol>${changes
    .map((c) => li(`${escapeHtml(c.text)}${c.why ? ` <em>— ${escapeHtml(c.why)}</em>` : ''}<br><code>${escapeHtml(c.where)}</code>`))
    .join('')}</ol>`}
<h2>Notes</h2>
${notes.length === 0 ? '<p>No notes.</p>' : `<ul>${[
    ...open.map((n) => li(`☐ ${escapeHtml(n.text)} <span class="meta">(${escapeHtml(n.elementLabel)})</span>`)),
    ...done.map((n) => li(`<span class="done">☑ ${escapeHtml(n.text)}</span> <span class="meta">(${escapeHtml(n.elementLabel)})</span>`)),
  ].join('')}</ul>`}
</body></html>`;

  return { markdown: md.join('\n'), html };
}

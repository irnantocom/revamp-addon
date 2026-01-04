Baik, konteks yang kamu inginkan **perlu dibedakan secara eksplisit antara “element-level” dan “page-level”**. Ini penting supaya AI:

* **Tidak bergantung pada `elementContext`**
* Berani menganalisis **seluruh HTML + CSS halaman**
* Memberi output yang **lebih global & konsisten**
* Tetap aman untuk dieksekusi oleh extension kamu

Di bawah ini aku berikan **konteks SYSTEM prompt versi baru** yang sudah **adaptive**:

* ✔ Jika ADA selected element → element-level
* ✔ Jika TIDAK ADA selected element → page-level (full DOM & CSS)

---

## ✅ Konteks SYSTEM Prompt (Versi Adaptive)

Gunakan ini untuk menggantikan `content` system prompt kamu.

```js
content: `
You are an AI assistant specialized in live web page transformation and DOM manipulation inside a Chrome Extension.

You can operate in TWO MODES depending on the context:

────────────────────────────
MODE 1: ELEMENT-LEVEL EDITING
────────────────────────────
If a selected element context is provided:
- Focus ONLY on the selected element and its immediate structure
- Do NOT make assumptions about the rest of the page
- Suggest minimal and targeted changes

${elementContext || ''}

────────────────────────────
MODE 2: PAGE-LEVEL TRANSFORMATION
────────────────────────────
If NO selected element is provided:
- Assume the user wants to modify the OVERALL PAGE
- Analyze the ENTIRE visible page structure:
  - HTML hierarchy
  - Layout sections (header, hero, content, footer, etc.)
  - Typography patterns
  - Color system
  - Spacing and alignment
- Treat the page as a redesign or refactor task
- Apply changes consistently across the page

Your responsibilities:
1. Understand the user's intent clearly
2. Decide whether the task is ELEMENT-LEVEL or PAGE-LEVEL
3. Explain what will be changed and WHY
4. Output actionable instructions in JSON format only

────────────────────────────
ALLOWED ACTION FORMATS
────────────────────────────

For TEXT changes:
\`\`\`json
{"action": "text", "value": "New text content here"}
\`\`\`

For CSS changes (single or multiple properties):
\`\`\`json
{"action": "css", "value": {"property-name": "value"}}
\`\`\`

For HTML changes (full replacement or section-level):
\`\`\`json
{"action": "html", "value": "<div>New HTML content</div>"}
\`\`\`

For ATTRIBUTE changes:
\`\`\`json
{"action": "attribute", "attribute": "src", "value": "new-value"}
\`\`\`

────────────────────────────
IMPORTANT RULES
────────────────────────────
- Output JSON only inside code blocks
- Do NOT include JavaScript
- Do NOT manipulate data outside the DOM
- Do NOT reference implementation details of the extension
- Always explain the reasoning before presenting JSON
- Assume the user will click an "Apply" button to execute changes

Use Context7 for reasoning and best practices.
`
```

---

## 🔧 Perubahan Logika di Extension (WAJIB)

Supaya konteks ini bekerja optimal, **jangan kirim `elementContext` jika tidak ada element terpilih**:

```js
const systemPrompt = buildSystemPrompt(
  selectedElement ? elementContext : null
);
```

Atau minimal:

```js
${elementContext ? elementContext : 'No element is currently selected.'}
```

---

## 🧠 Contoh Perilaku AI (Tanpa Selected Element)

**User input:**

> Buat tampilan halaman ini lebih modern dan corporate

**AI akan:**

* Menganalisis:

  * Heading hierarchy
  * Font size consistency
  * Color palette
  * Section spacing
* Mengusulkan:

  * CSS global (font, spacing, warna)
  * HTML section refactor (hero, CTA, dll)

Contoh output:

```json
{"action":"css","value":{"font-family":"Inter, sans-serif","line-height":"1.6"}}
```

---

## 🚀 Next Level (Opsional Tapi Powerful)

Kalau kamu mau naik level:

### 1. Tambahkan `scope` Flag

```json
{ "scope": "page" }
{ "scope": "element" }
```

### 2. Tambahkan `selector`

```json
{
  "action": "css",
  "selector": "body, p, h1, h2",
  "value": { "color": "#1a1a1a" }
}
```

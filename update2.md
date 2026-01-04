Untuk membuat **panel extension bisa di-geser (draggable) dan di-close**, caranya **100% dilakukan di content script**.
Di bawah ini aku kasih **pola produksi** (dipakai DevTools / Elementor-style), bukan sekadar demo.

---

# 1️⃣ Struktur Panel (HTML)

Buat **header khusus** sebagai drag handle + tombol close.

```js
const panel = document.createElement("div");
panel.id = "ext-panel";
panel.innerHTML = `
  <div class="ext-header">
    <span>Extension Panel</span>
    <button id="ext-close">✕</button>
  </div>
  <div class="ext-body">
    Panel content here
  </div>
`;
document.body.appendChild(panel);
```

---

# 2️⃣ CSS Panel (Floating + UX aman)

```js
const style = document.createElement("style");
style.textContent = `
#ext-panel {
  position: fixed;
  top: 120px;
  right: 20px;
  width: 320px;
  height: 420px;
  background: #fff;
  z-index: 999999;
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0,0,0,.25);
  font-family: system-ui, sans-serif;
  overflow: hidden;
}

.ext-header {
  height: 40px;
  background: #111;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  cursor: move;
  user-select: none;
}

.ext-body {
  padding: 12px;
  height: calc(100% - 40px);
  overflow: auto;
}

#ext-close {
  background: none;
  border: none;
  color: #fff;
  font-size: 18px;
  cursor: pointer;
}
`;
document.head.appendChild(style);
```

---

# 3️⃣ Drag Logic (Smooth & Stabil)

Gunakan **mousedown → mousemove → mouseup**
👉 **drag hanya lewat header**, bukan seluruh panel.

```js
const header = panel.querySelector(".ext-header");

let isDragging = false;
let offsetX = 0;
let offsetY = 0;

header.addEventListener("mousedown", e => {
  isDragging = true;
  offsetX = e.clientX - panel.getBoundingClientRect().left;
  offsetY = e.clientY - panel.getBoundingClientRect().top;

  document.body.style.userSelect = "none";
});

document.addEventListener("mousemove", e => {
  if (!isDragging) return;

  panel.style.left = `${e.clientX - offsetX}px`;
  panel.style.top  = `${e.clientY - offsetY}px`;
  panel.style.right = "auto";
});

document.addEventListener("mouseup", () => {
  isDragging = false;
  document.body.style.userSelect = "";
});
```

✔️ Tidak glitch
✔️ Tidak lompat
✔️ Tidak block klik halaman

---

# 4️⃣ Close Panel (Destroy DOM)

```js
document.getElementById("ext-close").onclick = () => {
  panel.remove();
};
```

👉 kalau mau **toggle buka/tutup**, jangan `remove()`, tapi:

```js
panel.style.display = "none";
```

---

# 5️⃣ Cegah Klik Panel Memicu Klik Halaman

WAJIB untuk extension inspector-style:

```js
panel.addEventListener("mousedown", e => e.stopPropagation());
panel.addEventListener("click", e => e.stopPropagation());
```

---

# 6️⃣ BONUS: Simpan Posisi Panel (Persist)

Supaya reload halaman **panel tetap di posisi terakhir**.

```js
// load
const pos = JSON.parse(localStorage.getItem("ext-panel-pos") || "{}");
if (pos.x && pos.y) {
  panel.style.left = pos.x + "px";
  panel.style.top  = pos.y + "px";
  panel.style.right = "auto";
}

// save
document.addEventListener("mouseup", () => {
  if (!isDragging) return;
  localStorage.setItem("ext-panel-pos", JSON.stringify({
    x: panel.offsetLeft,
    y: panel.offsetTop
  }));
});
```

---

# 🔥 Pola Profesional (Dipakai Tool Besar)

| Fitur           | Best Practice   |
| --------------- | --------------- |
| Drag            | Header only     |
| Close           | Remove DOM      |
| Z-index         | ≥ 999999        |
| Style isolation | Prefix class    |
| Persist         | localStorage    |
| Event safety    | stopPropagation |

---


Singkatnya: **❌ tidak bisa** pakai *default model* atau *tanpa menyebut model* saat memanggil **Gemini API**.
Model **WAJIB** dispesifikkan, dan error yang kamu dapat **100% karena model / endpoint tidak cocok**.

Mari kita bedah pelan-pelan + solusi paling aman untuk Chrome Extension + AI chatbot kamu.

---

## 🔴 Penyebab Error yang Kamu Alami

Pesan:

```
models/gemini-1.5-pro is not found for API version v1beta
or is not supported for generateContent
```

Artinya **salah satu (atau lebih) dari ini terjadi**:

1. ❌ `gemini-1.5-pro` **tidak tersedia** di endpoint `v1beta`
2. ❌ Model tersebut **tidak support method** `generateContent`
3. ❌ API key **tidak punya akses** ke model tersebut
4. ❌ Kamu mencampur **model lama vs API baru**

---

## ❓ Apakah Bisa Tanpa Set Model?

**Tidak.**

Gemini API **tidak punya default model** seperti:

```js
model: "default"
```

atau

```js
model: undefined
```

➡️ Request akan **selalu gagal**.

---

## ✅ SOLUSI PALING AMAN (RECOMMENDED)

### Gunakan model yang **pasti supported** untuk `generateContent`

### ✅ Model yang STABIL & AMAN:

```txt
gemini-1.5-flash
```

### Contoh request yang BENAR:

```js
POST https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent
```

```js
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "Halo, kamu siapa?" }]
    }
  ]
}
```

➡️ **Ini model paling cocok untuk chatbot extension**

* cepat
* murah
* latency rendah
* support text chat

---

## ⚠️ Kenapa `gemini-1.5-pro` sering error?

| Masalah   | Penjelasan                                        |
| --------- | ------------------------------------------------- |
| Endpoint  | Tidak semua region / API key support              |
| Method    | Beberapa model hanya untuk streaming / multimodal |
| Quota     | Sering restricted                                 |
| Stability | Lebih sering berubah                              |

👉 **Pro lebih cocok backend server**, bukan langsung dari extension.

---

## 🧠 Best Practice untuk Chrome Extension AI Chatbot

### 1️⃣ Jangan hardcode 1 model

Gunakan fallback model.

```js
const MODEL_PRIORITY = [
  "gemini-1.5-flash",
  "gemini-1.0-pro"
];
```

---

### 2️⃣ Auto retry jika model gagal

```js
async function callGemini(prompt) {
  for (const model of MODEL_PRIORITY) {
    try {
      return await requestGemini(model, prompt);
    } catch (e) {
      console.warn(`Model ${model} failed`);
    }
  }
  throw new Error("All Gemini models failed");
}
```

---

### 3️⃣ Jangan expose API Key langsung di extension (PENTING 🔥)

Karena kamu WordPress dev & ngerti API:

* **JANGAN** panggil Gemini langsung dari content script
* **Gunakan backend proxy** (WP REST API / Cloudflare Worker / Supabase)

⚠️ Kalau tidak → API key kamu **akan dicuri**

---

## 🔐 Arsitektur yang BENAR

```
Chrome Extension
   ↓
Backend Proxy (WP / Node / CF Worker)
   ↓
Gemini API
```

---

## 🔧 Contoh Endpoint Proxy (Pseudo)

```js
POST /api/ai-chat
{
  prompt: "ubah teks hero jadi corporate tone"
}
```

Backend yang:

* inject API key
* handle model fallback
* sanitize prompt
* rate limit

---

## ✅ Ringkasan Jawaban

| Pertanyaan           | Jawaban                  |
| -------------------- | ------------------------ |
| Bisa tanpa model?    | ❌ Tidak bisa             |
| Default model?       | ❌ Tidak ada              |
| Model aman?          | ✅ gemini-1.5-flash       |
| Pro cocok extension? | ❌ Tidak disarankan       |
| Solusi terbaik       | Proxy backend + fallback |

---

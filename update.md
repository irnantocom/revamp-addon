Pada **Chrome Extension**, perilaku *window / UI extension* **sangat tergantung jenis konteks UI** yang kamu gunakan.
Kalau problemnya adalah **UI extension tertutup saat kamu klik elemen halaman**, itu *default behavior* untuk beberapa tipe extension.

Di bawah ini penjelasan **opsi yang BENAR + best practice** (relevan dengan use-case kamu: manipulasi halaman langsung, revamp UI, dsb).

---

## 1️⃣ Popup extension → **TIDAK BISA** dibuat tetap terbuka ❌

Jika kamu pakai:

```json
"action": {
  "default_popup": "popup.html"
}
```

➡️ **Popup akan otomatis tertutup** saat:

* klik di luar popup
* klik elemen di halaman web
* fokus berpindah

🔴 **Ini LIMITASI Chrome**, bukan bug.

> Jadi **tidak ada workaround resmi** agar popup tetap terbuka.

---

## 2️⃣ SOLUSI PALING BENAR: Gunakan **Injected Floating Panel (Content Script UI)** ✅

Untuk kasus:

> “extension tetap terbuka walaupun klik elemen halaman”

➡️ **Buat UI langsung di dalam halaman** menggunakan **content script**.

### Arsitektur:

```
Extension
 ├─ popup.html (optional)
 ├─ background.js
 └─ contentScript.js  ← inject UI ke halaman
```

---

### Contoh: Floating Panel yang TETAP TERBUKA

#### `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Page Manipulator",
  "version": "1.0",
  "permissions": ["scripting", "activeTab"],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["contentScript.js"]
    }
  ]
}
```

---

#### `contentScript.js`

```js
if (!document.getElementById("my-extension-panel")) {
  const panel = document.createElement("div");
  panel.id = "my-extension-panel";

  panel.style.cssText = `
    position: fixed;
    top: 100px;
    right: 20px;
    width: 320px;
    height: 400px;
    background: #fff;
    z-index: 999999;
    border-radius: 10px;
    box-shadow: 0 10px 40px rgba(0,0,0,.25);
    padding: 12px;
  `;

  panel.innerHTML = `
    <h3>Extension Panel</h3>
    <button id="test">Klik elemen halaman</button>
  `;

  document.body.appendChild(panel);
}
```

➡️ Panel **tidak akan tertutup**, meskipun:

* klik elemen halaman
* scroll
* inspect DOM

---

## 3️⃣ Supaya Klik Panel TIDAK memicu klik halaman

Tambahkan:

```js
panel.addEventListener("mousedown", e => e.stopPropagation());
panel.addEventListener("click", e => e.stopPropagation());
```

Atau CSS:

```css
pointer-events: auto;
```

---

## 4️⃣ Advanced: Mode “Select Element” seperti Elementor / Inspect

Karena kamu mau **manipulasi halaman langsung**, ini pattern yang biasa dipakai:

```js
document.addEventListener("click", e => {
  if (e.target.closest("#my-extension-panel")) return;

  e.preventDefault();
  e.stopPropagation();

  console.log("Selected element:", e.target);
}, true);
```

➡️ Panel tetap hidup
➡️ Halaman bisa diklik & dianalisis

---

## 5️⃣ Alternatif (jarang dipakai): Extension Page (Window Terpisah)

```js
chrome.windows.create({
  url: chrome.runtime.getURL("ui.html"),
  type: "popup",
  width: 400,
  height: 600
});
```

✔️ Tidak tertutup
❌ UX kurang enak untuk manipulasi DOM langsung

---

## 🔥 Rekomendasi TERBAIK untuk use-case kamu

Berdasarkan konteks kamu:

* revamp UI
* adapt template
* manipulasi DOM langsung
* mirip Elementor / Webflow inspector

👉 **Gunakan Content Script Floating Panel**

Ini juga **cara yang dipakai**:

* Chrome DevTools
* React Developer Tools
* Vue Devtools
* Elementor editor

---


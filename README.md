# Soundboard — untuk pentas

Soundboard lokal. Suara disimpan di **folder `sounds/`**, layout pad diatur di
**`board.json`** — semua bisa diatur lewat file, tanpa klik-klik di aplikasi.

## Cara jalankan

```bash
node serve.js
```

Lalu buka **http://localhost:5173** (biasanya otomatis terbuka).
Server ini hanya untuk membaca folder lokal — tidak ada internet yang dipakai.

> Buka `index.html` langsung (double-click) tidak bisa, karena browser
> tidak mengizinkan halaman `file://` membaca folder.

## Struktur project

```
soundboard/
├── serve.js        server lokal + pindai folder sounds/
├── board.json      layout pad: file, nama, hotkey, loop, volume
├── sounds/         taruh semua file audio di sini (boleh subfolder)
│   └── contoh-beep.wav
├── index.html
├── styles.css
└── app.js
```

### 1. Tambah suara — cara paling cepat

**Seret file audio dari Finder langsung ke pad.** File otomatis tersalin ke
folder `sounds/`, langsung terpasang, dan tersimpan di `board.json`.
(Tidak perlu buka 📂, tidak perlu klik Muat ulang.)

Cara lain: klik 📂 pada pad → daftar file dari `sounds/` terbuka (sudah
otomatis terbaru, ada pencarian) → klik untuk memasang.

Subfolder bebas, misalnya:

```
sounds/
├── fx/tawa.wav
├── fx/tepuk-tangan.wav
├── musik/backing-track.mp3
└── voice/pengumuman.m4a
```

Di aplikasi: klik 📂 pada pad → semua file dari folder itu muncul (ada kolom
pencarian) → klik untuk memasang. Daftar selalu di-refresh otomatis saat
dialog dibuka; tombol **Muat ulang** tetap ada untuk jaga-jaga.

Format yang diterima: `.mp3` `.wav` `.m4a` `.aac` `.ogg` `.opus` `.flac` `.webm` `.aiff`.
Nama file duplikat otomatis diberi akhiran `-1`, `-2`, …

### 2. Kelola pad lewat UI (CRUD)

Buka **⚙ Kelola pad** (di bar atas) — semua bisa diatur tanpa menyentuh JSON:

| Aksi | Cara |
|---|---|
| **Create** | tombol **+ Tambah pad** (atau dari layar kosong) |
| **Read** | daftar semua pad: nama, suara, hotkey, loop, volume |
| **Update** | edit langsung di kolomnya (nama, hotkey, loop, volume %) |
| **Ganti suara** | klik kolom *Suara* → pilih dari `sounds/`, atau **✕ Kosongkan pad** |
| **Delete** | tombol **✕** di baris pad (ada konfirmasi) |
| **Urutkan** | tombol **↑ ↓** — urutan = posisi pad di grid |

Semua perubahan otomatis tersimpan ke `board.json` (lihat indikator `board.json ✓`).

### 3. Atur layout langsung di `board.json`

Bisa juga di-edit manual lewat editor teks:

```json
{
  "master": 0.9,
  "pads": [
    { "file": "fx/tawa.wav",         "name": "Tawa penonton", "key": "1", "loop": false, "volume": 0.9 },
    { "file": "musik/backing.mp3",   "name": "Backing",       "key": "q", "loop": true,  "volume": 0.7 },
    { "file": null, "name": "", "key": "w", "loop": false, "volume": 0.9 }
  ]
}
```

| Field | Arti |
|---|---|
| `master` | volume utama 0–1 |
| `file` | path relatif dari folder `sounds/` (`null` = pad kosong) |
| `name` | tampilan di pad (kosongkan = pakai nama file) |
| `key` | hotkey (`null` = tanpa hotkey) |
| `loop` | `true` = diulang terus |
| `volume` | volume pad 0–1 |

Urutan array = posisi pad (bebas, 0–64 pad). Simpan file, lalu muat ulang browser.

### 4. Salin ke laptop lain

Copy seluruh folder project (termasuk `sounds/` dan `board.json`) → jalankan
`node serve.js` → langsung sama persis tampilannya.

## Deploy ke GitHub Pages

Aplikasi punya **mode statis + fallback**: kalau `node serve.js` tidak jalan
(mis. dibuka dari GitHub Pages), app otomatis baca `board.json` dan
`sounds.json` langsung sebagai file statis.

```bash
node serve.js --manifest   # regenerate sounds.json (daftar file audio)
git add -A && git commit -m "update" && git push
```

Lalu di GitHub: **Settings → Pages → Branch: `main` / `/ (root)`**.
Buka `https://sakhandaru.github.io/kelompok-1/`.

| Fitur | Lokal (`node serve.js`) | GitHub Pages (statis) |
|---|---|---|
| Putar suara, hotkey, loop, fade, master | ✓ | ✓ |
| Baca `board.json` + pilih suara | ✓ | ✓ |
| Simpan perubahan pad | ✓ | ✗ (indikator `mode statis — baca saja`) |
| Upload / seret file audio | ✓ | ✗ |

Catatan:

- `sounds.json` dibuat otomatis tiap server dinyalakan dan tiap upload;
  jalankan `node serve.js --manifest` sebelum push kalau menambah file
  `sounds/` tanpa membuka server.
- Setiap kali pad disimpan di mode lokal, commit `board.json` supaya
  versi online ikut terbaru.

## Kontrol saat pentas

| Aksi | Cara |
|---|---|
| Putar / berhenti | klik pad, atau hotkey (default `1-4`, `QWER`, `ASDF`, `ZXCV`) |
| Stop semua suara | tombol **STOP SEMUA** atau `Esc` |
| Ganti hotkey | klik badge angka di pad, lalu tekan tombol baru |
| Loop | tombol 🔁 |
| Fade out halus (1.6 dtk) | tombol ↘ — enak untuk mengakhiri backing track |
| Volume pad / master | slider di pad / di bar atas |
| Keluaran ke soundcard | dropdown **Output** di bar atas (atau System Settings → Sound) |

## Catatan

- Jangan edit `board.json` saat aplikasi sedang terbuka (bisa tertimpa).
- Keamanan server: hanya mendengarkan `127.0.0.1` (tidak terlihat dari
  jaringan Wi-Fi), menolak header `Host` & `Origin` asing (anti DNS
  rebinding / CSRF), upload dibatasi 300 MB dan hanya ekstensi audio.
- Untuk pengaturan output yang paling andal saat pentas, pakai pengaturan
  audio macOS: **System Settings → Sound → Output**.
- Port bisa diganti: `PORT=3000 node serve.js`
- Membuka tanpa server? `node serve.js --no-open` (kalau tidak mau auto-buka browser).

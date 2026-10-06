#!/usr/bin/env node
/**
 * Server lokal untuk soundboard — tanpa dependensi.
 * Jalankan:  node serve.js   (lalu buka http://localhost:5173)
 *
 * Fitur:
 *  - menyajikan file statis (index.html, styles.css, app.js)
 *  - GET  /api/files   -> daftar file audio di folder sounds/ (rekursif)
 *  - GET  /api/board   -> isi board.json
 *  - POST /api/board   -> simpan board.json (dari aplikasi)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const SOUNDS_DIR = path.join(ROOT, "sounds");
const BOARD_FILE = path.join(ROOT, "board.json");
const PORT = Number(process.env.PORT) || 5173;

const AUDIO_EXT = new Set([
  ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".webm", ".aiff", ".aif",
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

fs.mkdirSync(SOUNDS_DIR, { recursive: true });

/* ---------- util ---------- */
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function emptyBoard() {
  return { master: 0.9, pads: [] };
}

function readBoard() {
  try {
    const raw = fs.readFileSync(BOARD_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.pads)) throw new Error("pads harus array");
    return data;
  } catch (e) {
    if (e.code === "ENOENT") {
      const b = emptyBoard();
      fs.writeFileSync(BOARD_FILE, JSON.stringify(b, null, 2) + "\n");
      return b;
    }
    console.warn("[board.json] tidak valid:", e.message, "-> pakai default sementara");
    return emptyBoard();
  }
}

/* daftar file audio di folder sounds/ (rekursif) */
function listSounds(dir = SOUNDS_DIR, prefix = "") {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = prefix ? prefix + "/" + e.name : e.name;
    if (e.isDirectory()) out.push(...listSounds(path.join(dir, e.name), rel));
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(rel);
  }
  return out.sort((a, b) => a.localeCompare(b, "id"));
}

/* manifest statis sounds.json — dipakai app saat dibuka tanpa server
   (mis. GitHub Pages): daftar file audio hasil scan terakhir. */
const MANIFEST_FILE = path.join(ROOT, "sounds.json");
function writeManifest() {
  try {
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify({ files: listSounds() }, null, 2) + "\n");
  } catch (e) {
    console.warn("[sounds.json] gagal ditulis:", e.message);
  }
}

/* mode cepat: regenerate manifest tanpa buka server
   (pakai sebelum push ke GitHub Pages) */
if (process.argv.includes("--manifest")) {
  writeManifest();
  console.log("sounds.json diperbarui (" + listSounds().length + " file)");
  process.exit(0);
}
writeManifest(); // manifest selalu sinkron tiap server dinyalakan

/* ---------- validasi board.json yang dikirim browser ---------- */
function sanitizeBoard(input) {
  const board = { master: 0.9, pads: [] };
  if (typeof input.master === "number" && input.master >= 0 && input.master <= 1) {
    board.master = input.master;
  }
  if (Array.isArray(input.pads)) {
    input.pads.slice(0, 64).forEach((raw) => {
      if (!raw || typeof raw !== "object") return;
      const pad = { file: null, name: "", key: null, loop: false, volume: 0.9 };
      if (typeof raw.file === "string") {
        const clean = path.normalize(raw.file).replace(/^([/\\.]+)/, "");
        if (!clean.includes("..") && !path.isAbsolute(clean)) pad.file = clean;
      }
      if (typeof raw.name === "string") pad.name = raw.name.slice(0, 80);
      if (typeof raw.key === "string") pad.key = raw.key.slice(0, 12);
      pad.loop = !!raw.loop;
      if (typeof raw.volume === "number") pad.volume = Math.min(1, Math.max(0, raw.volume));
      board.pads.push(pad);
    });
  }
  return board;
}

/* ---------- server ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = url.pathname;

  /* --- penjaga keamanan --- */
  // 1) hanya mesin sendiri yang boleh akses (Host harus localhost/127.0.0.1)
  const host = req.headers.host || "";
  const localHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
  if (!localHosts.has(host)) {
    return json(res, 403, { ok: false, error: "Host tidak diizinkan (hanya untuk mesin lokal)" });
  }
  // 2) tolak permintaan tulis dari origin lain (mencegah CSRF dari situs jahat)
  if (req.method !== "GET" && req.headers.origin && req.headers.origin !== `http://${host}`) {
    return json(res, 403, { ok: false, error: "Origin ditolak" });
  }

  if (route === "/api/files" && req.method === "GET") {
    return json(res, 200, { files: listSounds() });
  }

  if (route === "/api/board" && req.method === "GET") {
    return json(res, 200, readBoard());
  }

  if (route === "/api/board" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 5e5) req.destroy(); // jaga-jaga
    });
    req.on("end", () => {
      try {
        const board = sanitizeBoard(JSON.parse(body));
        // tulis atomik (tmp lalu rename) supaya board.json tidak korup bila crash di tengah
        const tmp = BOARD_FILE + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(board, null, 2) + "\n");
        fs.renameSync(tmp, BOARD_FILE);
        console.log("[simpan] board.json diperbarui");
        json(res, 200, { ok: true });
      } catch (e) {
        console.warn("[simpan] gagal:", e.message);
        json(res, 400, { ok: false, error: e.message });
      }
    });
    return;
  }

  /* terima file audio yang di-drag dari Finder, simpan ke folder sounds/ */
  if (route === "/api/upload" && req.method === "POST") {
    const rawName = url.searchParams.get("name") || "suara.wav";
    const sub = (url.searchParams.get("dir") || "").replace(/[^\w\-. ]/g, "").trim();
    const safeName = path.basename(rawName).replace(/[\/\\:*?"<>|]/g, "_").replace(/^\.+/, "").slice(0, 120);
    const ext = path.extname(safeName);
    if (!AUDIO_EXT.has(ext.toLowerCase())) {
      return json(res, 415, { ok: false, error: "format tidak didukung: " + (ext || "(tanpa ekstensi)") });
    }
    // folder tujuan wajib di dalam sounds/ (tolak "..", dst.)
    const targetDir = path.resolve(path.join(SOUNDS_DIR, sub));
    if (targetDir !== SOUNDS_DIR && !targetDir.startsWith(SOUNDS_DIR + path.sep)) {
      return json(res, 400, { ok: false, error: "Folder tujuan tidak valid" });
    }
    try { fs.mkdirSync(targetDir, { recursive: true }); } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }

    let final = path.join(targetDir, safeName);
    const base = path.basename(safeName, ext);
    for (let i = 1; fs.existsSync(final); i++) final = path.join(targetDir, `${base}-${i}${ext}`);

    // batasi ukuran upload supaya disk tidak habis (300 MB)
    const MAX_UPLOAD = 300 * 1024 * 1024;
    let received = 0, aborted = false;
    req.on("data", (c) => {
      received += c.length;
      if (received > MAX_UPLOAD && !aborted) {
        aborted = true;
        try { fs.unlinkSync(final); } catch {}
        json(res, 413, { ok: false, error: "File terlalu besar (maks 300 MB)" });
        req.destroy();
      }
    });

    const ws = fs.createWriteStream(final);
    req.pipe(ws);
    ws.on("close", () => {
      if (aborted) return;
      const rel = path.relative(SOUNDS_DIR, final).split(path.sep).join("/");
      console.log("[upload] sounds/" + rel);
      writeManifest(); // daftar file di manifest ikut ter-update
      json(res, 200, { ok: true, path: rel });
    });
    ws.on("error", (e) => { if (!aborted) json(res, 500, { ok: false, error: e.message }); });
    return;
  }

  /* file statis — wajib tetap di dalam folder project */
  let rel = decodeURIComponent(route === "/" ? "/index.html" : route);
  const filePath = path.resolve(path.join(ROOT, rel));
  const up = path.relative(ROOT, filePath);
  if (up.startsWith("..") || path.isAbsolute(up)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 — tidak ditemukan: " + rel);
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
});

server.on("error", async (err) => {
  if (err.code !== "EADDRINUSE") {
    console.error("\n  Gagal menjalankan server:", err.message, "\n");
    process.exit(1);
  }

  // sudah ada server lain di port ini — cek apakah itu soundboard
  let sudahJalan = false;
  try {
    const r = await fetch(`http://localhost:${PORT}/api/board`, { signal: AbortSignal.timeout(1500) });
    sudahJalan = r.ok;
  } catch {}

  if (sudahJalan) {
    const addr = `http://localhost:${PORT}`;
    console.log("");
    console.log(`  Soundboard sudah berjalan di ${addr}`);
    console.log("  Buka link itu di browser (atau tekan ⌘R untuk refresh).");
    console.log("  Kalau mau jalankan dari Terminal sendiri, matikan yang lama dulu:");
    console.log(`    lsof -ti tcp:${PORT} | xargs kill`);
    console.log("");
    if (!process.argv.includes("--no-open")) {
      try { spawn(process.platform === "darwin" ? "open" : "start", [addr], { detached: true, stdio: "ignore" }).unref(); } catch {}
    }
    return;
  }

  console.log("");
  console.log(`  Port ${PORT} dipakai program lain.`);
  console.log(`  Jalankan dengan port lain:  PORT=5174 node serve.js`);
  console.log("");
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = `http://localhost:${PORT}`;
  console.log("");
  console.log("  SOUNDBOARD siap dipakai");
  console.log("  -------------------------------");
  console.log("  URL       : " + addr);
  console.log("  Suara     : " + SOUNDS_DIR);
  console.log("  Layout    : " + BOARD_FILE);
  console.log("  -------------------------------");
  console.log("  Taruh file audio di folder sounds/, lalu klik 📂 di pad.");
  console.log("");
  if (!process.argv.includes("--no-open")) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try { spawn(cmd, [addr], { detached: true, stdio: "ignore" }).unref(); } catch {}
  }
});

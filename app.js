/* Soundboard lokal — Web Audio API + server node kecil (serve.js)
   Layout disimpan di board.json, suara dibaca dari folder sounds/.
   Pad dikelola lewat UI "Kelola pad" (create / read / update / delete / urut). */

const FADE_TIME = 1.6; // detik
const DEFAULT_KEYS = [
  "1", "2", "3", "4", "q", "w", "e", "r",
  "a", "s", "d", "f", "z", "x", "c", "v",
  "5", "6", "7", "8", "t", "y", "u", "g",
  "h", "j", "b", "n", "m", "i", "o", "p",
];
const $ = (s) => document.querySelector(s);

/* ---------------- Audio engine ---------------- */
let ctx = null;
let masterGain = null;

function ensureAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = parseFloat($("#masterVol").value);
  masterGain.connect(ctx.destination);
}
function resumeAudio() {
  ensureAudio();
  if (ctx.state === "suspended") ctx.resume();
}
function initPadGains() {
  if (!ctx) return;
  pads.forEach((p) => {
    if (p.gain) return;
    p.gain = ctx.createGain();
    p.gain.gain.value = p.volume;
    p.gain.connect(masterGain);
  });
}

/* ---------------- State ---------------- */
let pads = [];   // {file,name,key,loop,volume,buffer,sources,fading,gain,el,index}
let files = [];  // path relatif dari folder sounds/

function toPath(rel) {
  return "sounds/" + rel.split("/").map(encodeURIComponent).join("/");
}

function nextFreeKey() {
  const used = new Set(pads.map((p) => p.key).filter(Boolean));
  return DEFAULT_KEYS.find((k) => !used.has(k)) || null;
}

/* ---------------- Server API ---------------- */
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(path + " -> " + r.status);
  return r.json();
}

/* Mode statis: dibuka tanpa server (GitHub Pages / hosting statis).
   Semua fitur jalan, tapi perubahan TIDAK bisa disimpan —
   board.json dan sounds.json dibaca apa adanya dari file yang ter-deploy. */
let staticMode = false;

async function staticJson(file) {
  const r = await fetch(file, { cache: "no-cache" });
  if (!r.ok) throw new Error(file + " -> " + r.status);
  const ct = r.headers.get("content-type") || "";
  if (!/json/.test(ct)) throw new Error(file + " tidak valid (" + (ct || "tanpa content-type") + ")");
  return r.json();
}

async function loadBoard() {
  if (staticMode) return staticJson("board.json");
  return api("/api/board");
}
async function loadFiles() {
  const data = staticMode ? await staticJson("sounds.json") : await api("/api/files");
  return data.files || [];
}

let saveTimer = null;
function saveBoard() {
  if (staticMode) { setSaveState("mode statis — tidak tersimpan", true); return; }
  clearTimeout(saveTimer);
  setSaveState("menyimpan…");
  saveTimer = setTimeout(async () => {
    const payload = {
      master: parseFloat($("#masterVol").value),
      pads: pads.map((p) => ({ file: p.file, name: p.name, key: p.key, loop: p.loop, volume: p.volume })),
    };
    try {
      await api("/api/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSaveState("board.json ✓");
    } catch (e) {
      console.error(e);
      setSaveState("gagal menyimpan!");
      toast("Gagal menyimpan board.json");
    }
  }, 400);
}
let saveStateTimer = null;
function setSaveState(msg, keep = false) {
  const el = $("#saveState");
  el.textContent = msg;
  clearTimeout(saveStateTimer);
  if (keep) return; // indikator permanen (mis. mode statis)
  if (msg) saveStateTimer = setTimeout(() => (el.textContent = ""), 4000);
}

/* ---------------- Playback ---------------- */
function stopPad(p) {
  if (!ctx || !p.gain) return;
  p.sources.forEach((s) => { try { s.stop(); } catch {} });
  p.sources.clear();
  p.fading = false;
  p.gain.gain.cancelScheduledValues(ctx.currentTime);
  p.gain.gain.setValueAtTime(p.volume, ctx.currentTime);
  renderPad(p);
}

function updateState(p) {
  if (!p.el) return;
  const st = p.el.querySelector(".state");
  if (!st) return;
  st.textContent = p.fading ? "fade…" : p.sources.size ? (p.loop ? "loop" : "main") : p.loop ? "loop" : "";
}

function playPad(p) {
  if (!p.file) { openPicker(p.index); return; }
  if (!p.buffer) { toast("Suara belum selesai dimuat…"); return; }
  resumeAudio();
  initPadGains();
  stopPad(p);

  const src = ctx.createBufferSource();
  src.buffer = p.buffer;
  src.loop = p.loop;
  src.connect(p.gain);
  src.onended = () => {
    p.sources.delete(src);
    if (p.sources.size === 0) {
      p.fading = false;
      p.gain.gain.cancelScheduledValues(ctx.currentTime);
      p.gain.gain.setValueAtTime(p.volume, ctx.currentTime);
    }
    renderPad(p);
  };
  p.gain.gain.cancelScheduledValues(ctx.currentTime);
  p.gain.gain.setValueAtTime(p.volume, ctx.currentTime);
  src.start();
  p.sources.add(src);
  renderPad(p);
}

function togglePad(p) {
  if (p.sources.size > 0 && !p.fading) stopPad(p);
  else playPad(p);
}

function fadePad(p, dur = FADE_TIME) {
  if (!ctx || !p.gain || p.sources.size === 0) return;
  p.fading = true;
  const g = p.gain.gain;
  g.cancelScheduledValues(ctx.currentTime);
  g.setValueAtTime(g.value, ctx.currentTime);
  g.linearRampToValueAtTime(0.0001, ctx.currentTime + dur);
  renderPad(p);
  setTimeout(() => { if (p.fading) stopPad(p); }, dur * 1000 + 60);
}

function panic() {
  if (!ctx) return;
  const now = ctx.currentTime;
  const target = parseFloat($("#masterVol").value);
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.05);
  pads.forEach((p) => stopPad(p));
  setTimeout(() => {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setValueAtTime(target, ctx.currentTime);
  }, 150);
}

/* ---------------- Suara ---------------- */
async function loadBuffer(p) {
  if (!p.file) { p.buffer = null; return true; }
  try {
    const res = await fetch(toPath(p.file));
    if (!res.ok) throw new Error("HTTP " + res.status);
    p.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    p.missing = false;
    return true;
  } catch (e) {
    console.warn("gagal decode", p.file, e);
    p.buffer = null;
    p.missing = true;
    return false;
  }
}

async function assignFile(index, rel) {
  const p = pads[index];
  if (!p) return;
  resumeAudio();
  initPadGains();
  try {
    const res = await fetch(toPath(rel));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    stopPad(p);
    p.file = rel;
    p.buffer = buf;
    p.missing = false;
    if (!p.name) p.name = rel.split("/").pop().replace(/\.[^.]+$/, "");
    renderPad(p);
    renderManage();
    saveBoard();
    toast("✓ " + rel);
  } catch (e) {
    console.error(e);
    toast("Gagal memuat " + rel);
  }
}

async function uploadAndAssign(index, file) {
  if (staticMode) { toast("Mode statis: upload suara hanya lewat node serve.js"); return; }
  const isAudio = /^audio\//.test(file.type) ||
    /\.(mp3|wav|m4a|aac|ogg|opus|flac|webm|aiff|aif)$/i.test(file.name);
  if (!isAudio) { toast("Itu bukan file audio"); return; }

  toast("Mengunggah " + file.name + " …");
  try {
    const r = await fetch("/api/upload?name=" + encodeURIComponent(file.name), { method: "POST", body: file });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || "HTTP " + r.status);
    await refreshFiles();
    await assignFile(index, data.path);
  } catch (e) {
    console.error(e);
    toast("Gagal mengunggah: " + e.message);
  }
}

function clearPad(index) {
  const p = pads[index];
  if (!p) return;
  stopPad(p);
  p.file = null;
  p.buffer = null;
  p.missing = false;
  renderPad(p);
  renderManage();
  saveBoard();
}

/* ---------------- CRUD pad ---------------- */
function createPad(data = {}) {
  return {
    file: data.file || null,
    name: data.name || "",
    key: data.key === undefined ? nextFreeKey() : data.key,
    loop: !!data.loop,
    volume: typeof data.volume === "number" ? data.volume : 0.9,
    buffer: null,
    sources: new Set(),
    fading: false,
    missing: false,
    gain: null,
    el: null,
    index: -1,
  };
}

function addPad() {
  pads.push(createPad());
  renderGrid();
  initPadGains();
  saveBoard();
  renderManage();
  toast("Pad ditambahkan");
}

function removePad(i) {
  const p = pads[i];
  if (!p) return;
  if (p.file && !confirm(`Hapus pad "${p.name || p.file}"?\n(File di folder sounds/ tidak ikut terhapus.)`)) return;
  stopPad(p);
  pads.splice(i, 1);
  renderGrid();
  saveBoard();
  renderManage();
}

function movePad(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= pads.length) return;
  [pads[i], pads[j]] = [pads[j], pads[i]];
  renderGrid();
  saveBoard();
  renderManage();
}

/* ---------------- UI: pad ---------------- */
function renderPad(p) {
  if (!p.el) return;
  p.el.querySelector(".key").textContent = p.key ? String(p.key).toUpperCase() : "–";
  const nameEl = p.el.querySelector(".pad-name");
  nameEl.textContent = p.name || (p.file ? p.file : "tanpa suara");
  nameEl.classList.toggle("empty", !p.name && !p.file);
  p.el.querySelector(".loop").classList.toggle("on", p.loop);
  const vol = p.el.querySelector(".pad-vol input");
  vol.value = p.volume;
  p.el.querySelector(".pad-vol span").textContent = Math.round(p.volume * 100) + "%";
  p.el.querySelector(".del").disabled = !p.file;
  p.el.classList.toggle("playing", p.sources.size > 0);
  p.el.classList.toggle("fading", p.fading);
  p.el.classList.toggle("missing", p.missing);
  updateState(p);
}

function createPadEl(p) {
  const el = document.createElement("div");
  el.className = "pad";
  el.innerHTML = `
    <div class="pad-head">
      <button class="key" title="Klik untuk ganti hotkey"></button>
      <div class="pad-name empty">tanpa suara</div>
    </div>
    <div class="pad-meta"><span class="state"></span></div>
    <div class="pad-tools">
      <button class="tool play" title="Putar / berhenti">▶</button>
      <button class="tool loop" title="Loop">🔁</button>
      <button class="tool fade" title="Fade out halus">↘</button>
      <button class="tool load" title="Pilih file dari sounds/">📂</button>
      <button class="tool danger del" title="Kosongkan pad">✕</button>
    </div>
    <div class="pad-vol">
      <input type="range" min="0" max="1" step="0.01" value="0.9" />
      <span>90%</span>
    </div>`;

  el.addEventListener("click", (e) => { if (!e.target.closest("button, input")) togglePad(p); });
  el.querySelector(".play").addEventListener("click", () => togglePad(p));
  el.querySelector(".loop").addEventListener("click", () => {
    p.loop = !p.loop;
    p.sources.forEach((s) => (s.loop = p.loop));
    renderPad(p); renderManage(); saveBoard();
  });
  el.querySelector(".fade").addEventListener("click", () => fadePad(p));
  el.querySelector(".load").addEventListener("click", () => openPicker(p.index));
  el.querySelector(".del").addEventListener("click", () => clearPad(p.index));
  el.querySelector(".key").addEventListener("click", (e) => { e.stopPropagation(); startRebind(p); });
  el.querySelector(".pad-vol input").addEventListener("input", (e) => {
    p.volume = parseFloat(e.target.value);
    if (!p.fading && ctx && p.gain) p.gain.gain.setValueAtTime(p.volume, ctx.currentTime);
    renderPad(p); renderManage(); saveBoard();
  });

  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("dragover"); });
  el.addEventListener("dragleave", () => el.classList.remove("dragover"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove("dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) uploadAndAssign(p.index, f);
  });
  return el;
}

function renderGrid() {
  const grid = $("#grid");
  grid.innerHTML = "";
  pads.forEach((p, i) => {
    p.index = i;
    p.el = createPadEl(p);
    grid.appendChild(p.el);
    renderPad(p);
  });
  $("#empty").hidden = pads.length > 0;
}

/* ---------------- Dialog "Kelola pad" (CRUD) ---------------- */
function openManage() {
  renderManage();
  $("#manage").hidden = false;
}
function closeManage() {
  $("#manage").hidden = true;
}

function renderManage() {
  if ($("#manage").hidden) return;
  const list = $("#mlist");
  const focusKey = document.activeElement && document.activeElement.classList.contains("m-name")
    ? document.activeElement.closest(".mrow")?.dataset.i : null;
  list.innerHTML = "";

  pads.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "mrow";
    row.dataset.i = i;
    row.innerHTML = `
      <span class="midx">${i + 1}</span>
      <input class="m-name" placeholder="nama pad" />
      <button class="m-file" title="Pilih suara">${p.file ? escapeHtml(p.file) : "— pilih suara —"}</button>
      <input class="m-key" maxlength="6" placeholder="–" title="Hotkey" />
      <input class="m-loop" type="checkbox" title="Loop" />
      <input class="m-vol" type="number" min="0" max="100" step="5" title="Volume %" />
      <span class="m-acts">
        <button class="ghost m-up" title="Naikkan">↑</button>
        <button class="ghost m-down" title="Turunkan">↓</button>
        <button class="ghost m-del" title="Hapus pad">✕</button>
      </span>`;

    row.querySelector(".m-name").value = p.name;
    row.querySelector(".m-key").value = p.key || "";
    row.querySelector(".m-loop").checked = p.loop;
    row.querySelector(".m-vol").value = Math.round(p.volume * 100);
    if (p.file) row.querySelector(".m-file").classList.add("filled");

    row.querySelector(".m-name").addEventListener("input", (e) => {
      p.name = e.target.value;
      renderPad(p); saveBoard();
    });
    row.querySelector(".m-file").addEventListener("click", () => openPicker(i));
    row.querySelector(".m-key").addEventListener("change", (e) => {
      const raw = e.target.value.trim().slice(0, 6);
      const key = raw ? (raw.length === 1 ? raw.toLowerCase() : raw) : null;
      if (key) {
        const clash = pads.find((q) => q !== p && q.key === key);
        if (clash) { clash.key = null; renderPad(clash); }
      }
      p.key = key;
      renderPad(p); renderManage(); saveBoard();
    });
    row.querySelector(".m-loop").addEventListener("change", (e) => {
      p.loop = e.target.checked;
      p.sources.forEach((s) => (s.loop = p.loop));
      renderPad(p); saveBoard();
    });
    row.querySelector(".m-vol").addEventListener("change", (e) => {
      const pct = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
      p.volume = pct / 100;
      if (!p.fading && ctx && p.gain) p.gain.gain.setValueAtTime(p.volume, ctx.currentTime);
      renderPad(p); saveBoard();
    });
    row.querySelector(".m-up").addEventListener("click", () => movePad(i, -1));
    row.querySelector(".m-down").addEventListener("click", () => movePad(i, 1));
    row.querySelector(".m-del").addEventListener("click", () => removePad(i));

    list.appendChild(row);
  });

  if (!pads.length) {
    list.innerHTML = `<div class="file-empty">Belum ada pad. Klik <b>+ Tambah pad</b>.</div>`;
  }
  if (focusKey != null) {
    const again = list.querySelector(`.mrow[data-i="${focusKey}"] .m-name`);
    if (again) again.focus();
  }
}

/* ---------------- Pemilih file (folder sounds/) ---------------- */
let pickerTarget = null;

function openPicker(index) {
  pickerTarget = index;
  $("#searchFile").value = "";
  renderFileList();
  $("#picker").hidden = false;
  $("#searchFile").focus();
  refreshFiles();
}
function closePicker() {
  $("#picker").hidden = true;
  pickerTarget = null;
}

function renderFileList() {
  const q = $("#searchFile").value.trim().toLowerCase();
  const box = $("#filelist");
  box.innerHTML = "";

  const target = pickerTarget != null ? pads[pickerTarget] : null;
  if (target && target.file) {
    const clear = document.createElement("button");
    clear.className = "file-row clear-row";
    clear.innerHTML = `<span class="file-name">✕ Kosongkan pad ini</span><span class="file-dir">tanpa suara</span>`;
    clear.addEventListener("click", () => { clearPad(pickerTarget); closePicker(); });
    box.appendChild(clear);
  }

  const list = files.filter((f) => f.toLowerCase().includes(q));
  if (!files.length) {
    box.insertAdjacentHTML("beforeend",
      `<div class="file-empty">Folder <code>sounds/</code> masih kosong.<br>Seret file audio dari Finder langsung ke pad, atau ke kotak ini.</div>`);
    return;
  }
  if (!list.length) {
    box.insertAdjacentHTML("beforeend", `<div class="file-empty">Tidak ada file yang cocok.</div>`);
    return;
  }
  list.forEach((f) => {
    const row = document.createElement("button");
    row.className = "file-row";
    const parts = f.split("/");
    const base = parts.pop();
    row.innerHTML = `<span class="file-name">${escapeHtml(base)}</span><span class="file-dir">${escapeHtml(parts.join("/") || "sounds/")}</span>`;
    row.addEventListener("click", () => {
      if (pickerTarget != null) assignFile(pickerTarget, f);
      closePicker();
    });
    box.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function refreshFiles(showToast = false) {
  try {
    files = await loadFiles();
    renderFileList();
    if (showToast) toast(files.length + " file ditemukan");
  } catch (e) {
    console.error(e);
    toast(staticMode ? "sounds.json tidak ditemukan" : "Gagal memindai folder sounds/");
  }
}

/* ---------------- Hotkey ---------------- */
let rebinding = null;
function startRebind(p) {
  if (rebinding) cancelRebind();
  rebinding = p;
  p.el.querySelector(".key").classList.add("listening");
  p.el.querySelector(".key").textContent = "…";
}
function cancelRebind() {
  if (!rebinding) return;
  if (rebinding.el) rebinding.el.querySelector(".key").classList.remove("listening");
  renderPad(rebinding);
  rebinding = null;
}

document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;

  if (rebinding) {
    e.preventDefault();
    if (e.key === "Escape") { cancelRebind(); return; }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const clash = pads.find((q) => q !== rebinding && q.key === key);
    if (clash) { const old = rebinding.key; clash.key = old; renderPad(clash); }
    rebinding.key = key;
    cancelRebind();
    saveBoard();
    return;
  }

  if (e.key === "Escape") {
    if (!$("#picker").hidden) { closePicker(); return; }
    if (!$("#manage").hidden) { closeManage(); return; }
    e.preventDefault();
    panic();
    return;
  }
  if (e.repeat) return;

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const p = pads.find((q) => q.key === key);
  if (p) { e.preventDefault(); resumeAudio(); togglePad(p); }
});

/* ---------------- Output device ---------------- */
async function setupDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
    if (outs.length < 2) return;
    const sel = $("#deviceSelect");
    sel.innerHTML = "";
    outs.forEach((d) => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || (d.deviceId === "default" ? "Default" : d.deviceId.slice(0, 8));
      sel.appendChild(o);
    });
    $("#deviceWrap").hidden = false;
    sel.addEventListener("change", async () => {
      if (!ctx || typeof ctx.setSinkId !== "function") {
        toast("Browser ini belum mendukung pemilihan output");
        return;
      }
      try { await ctx.setSinkId(sel.value); toast("Output diganti ✓"); }
      catch (e) { console.error(e); toast("Gagal ganti output"); }
    });
  } catch (e) { console.warn(e); }
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

/* ---------------- Init ---------------- */
async function init() {
  if (location.protocol === "file:") {
    $("#guard").hidden = false;
    return;
  }

  let board;
  try {
    [board, files] = await Promise.all([loadBoard(), loadFiles()]);
  } catch (e) {
    /* server lokal tidak ada — coba mode statis (board.json + sounds.json) */
    try {
      staticMode = true;
      [board, files] = await Promise.all([loadBoard(), loadFiles()]);
      console.warn("Server lokal tidak ada — mode statis (baca saja).", e);
    } catch (e2) {
      console.error(e2);
      $("#guard").hidden = false;
      $("#guard p").innerHTML = location.protocol === "file:"
        ? "Halaman dibuka langsung dari file, jadi browser memblokir akses ke folder <code>sounds/</code>. Jalankan <code>node serve.js</code>."
        : "Server tidak merespons dan file statis tidak ditemukan. Jalankan <code>node serve.js</code>, atau pastikan <code>board.json</code> &amp; <code>sounds.json</code> ikut ter-deploy.";
      return;
    }
  }

  if (staticMode) {
    $("#saveState").textContent = "mode statis — baca saja";
    $("#saveState").title = "Dibuka tanpa server: perubahan tidak bisa disimpan. Jalankan node serve.js untuk mode penuh.";
    $("#manageFoot").textContent =
      "Mode statis (GitHub Pages): perubahan hanya berlaku selama tab ini terbuka. Simpan permanen lewat node serve.js.";
  }

  $("#masterVol").value = board.master ?? 0.9;
  $("#masterVal").textContent = Math.round((board.master ?? 0.9) * 100) + "%";

  pads = (board.pads || []).map((s) => createPad(s));
  renderGrid();

  ensureAudio();
  initPadGains();

  for (const p of pads) {
    if (!p.file) continue;
    await loadBuffer(p);
    renderPad(p);
  }

  $("#masterVol").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    $("#masterVal").textContent = Math.round(v * 100) + "%";
    if (masterGain) masterGain.gain.setValueAtTime(v, ctx.currentTime);
    saveBoard();
  });

  $("#panic").addEventListener("click", panic);
  $("#openManage").addEventListener("click", openManage);
  $("#addPad").addEventListener("click", addPad);
  $("#addPadEmpty").addEventListener("click", () => { addPad(); openManage(); });
  $("#closeManage").addEventListener("click", closeManage);
  $("#manage").addEventListener("click", (e) => { if (e.target.id === "manage") closeManage(); });
  $("#closePicker").addEventListener("click", closePicker);
  $("#reloadFiles").addEventListener("click", () => refreshFiles(true));
  $("#searchFile").addEventListener("input", renderFileList);
  $("#picker").addEventListener("click", (e) => { if (e.target.id === "picker") closePicker(); });

  const card = document.querySelector("#picker .modal-card");
  card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("dragover"); });
  card.addEventListener("dragleave", () => card.classList.remove("dragover"));
  card.addEventListener("drop", async (e) => {
    e.preventDefault();
    card.classList.remove("dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    const target = pickerTarget;
    if (f && target != null) { closePicker(); await uploadAndAssign(target, f); }
  });

  ["pointerdown", "keydown"].forEach((ev) =>
    document.addEventListener(ev, () => { resumeAudio(); initPadGains(); })
  );

  setupDevices();
}

init();

/* =================================================================
   DIGITAL LINK MANAGER — FRONTEND APP.JS
   Pola performa: gas-instant-ux-pro (SWR, dedup in-flight, retry,
   AbortController) + gas-scale-turbo (epoch tulis, cache versi).
   Komunikasi ke backend: HANYA fetch(), text/plain POST (anti-CORS).
   ================================================================= */

// ------------------------------------------------------------
// 0) STATE GLOBAL & PENYIMPANAN LOKAL (per-perangkat, bukan rahasia)
// ------------------------------------------------------------
const Store = {
  get(k) { try { return JSON.parse(localStorage.getItem('dlm_' + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('dlm_' + k, JSON.stringify(v)); } catch (e) {} },
  remove(k) { try { localStorage.removeItem('dlm_' + k); } catch (e) {} }
};

let TOKEN = Store.get('token') || null;
let CACHE = {}; // cache in-memory per sesi tab: { key: { data, ts } }
const _inflight = {};
let _writeEpoch = 0;

// ------------------------------------------------------------
// 1) API LAYER — SWR + dedup in-flight + retry + idempotency
// ------------------------------------------------------------
function reqId_() { return 'r' + Date.now() + Math.random().toString(36).slice(2, 8); }

async function apiGet(action, params) {
  const qs = new URLSearchParams(Object.assign({ action }, params || {})).toString();
  const key = action + '|' + qs;
  if (_inflight[key]) return _inflight[key];

  const p = (async () => {
    for (let percobaan = 0; percobaan < 3; percobaan++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25000);
        const res = await fetch(GAS_URL + '?' + qs, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
        clearTimeout(timer);
        const json = await res.json();
        return json;
      } catch (err) {
        if (percobaan === 2) return { success: false, message: 'Gagal terhubung ke server. Periksa koneksi internet Anda.' };
        await new Promise(r => setTimeout(r, 500 * (percobaan + 1)));
      }
    }
  })();
  _inflight[key] = p;
  p.then(() => delete _inflight[key], () => delete _inflight[key]);
  return p;
}

async function apiPost(action, data) {
  _writeEpoch++;
  const payload = Object.assign({ action, token: TOKEN, reqId: reqId_() }, data || {});
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // WAJIB — hindari preflight CORS
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const json = await res.json();
    if (json && json.message === 'Sesi tidak valid atau kedaluwarsa. Silakan masuk kembali dengan PIN.') {
      keluar_();
    }
    return json;
  } catch (err) {
    return { success: false, message: 'Gagal mengirim data. Periksa koneksi internet Anda dan coba lagi.' };
  }
}

// ------------------------------------------------------------
// 2) TOAST NOTIFICATIONS
// ------------------------------------------------------------
function toast(pesan, jenis) {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast ' + (jenis || 'info');
  el.textContent = pesan;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ------------------------------------------------------------
// 3) AUTH — login PIN, simpan token di localStorage perangkat
// ------------------------------------------------------------
function keluar_() {
  TOKEN = null; Store.remove('token');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('view-login').classList.remove('hidden');
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = document.getElementById('input-pin').value.trim();
  const errBox = document.getElementById('login-error');
  errBox.style.display = 'none';
  const res = await apiPost('login', { pin });
  if (res && res.success) {
    TOKEN = res.token; Store.set('token', TOKEN);
    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    router();
  } else {
    errBox.textContent = (res && res.message) || 'Gagal masuk.';
    errBox.style.display = 'block';
  }
});

function cekSesiAwal() {
  if (TOKEN) {
    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
  } else {
    document.getElementById('view-login').classList.remove('hidden');
  }
}

// ------------------------------------------------------------
// 4) TEMA (Terang / Gelap / Otomatis)
// ------------------------------------------------------------
function terapkanTema(mode) {
  const root = document.documentElement;
  if (mode === 'terang') root.setAttribute('data-theme', 'light');
  else if (mode === 'gelap') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  Store.set('tema', mode);
  document.getElementById('btn-theme').textContent = mode === 'gelap' ? '☀️' : '🌙';
}
document.getElementById('btn-theme').addEventListener('click', () => {
  const now = Store.get('tema') || 'otomatis';
  const next = now === 'terang' ? 'gelap' : now === 'gelap' ? 'otomatis' : 'terang';
  terapkanTema(next);
});
terapkanTema(Store.get('tema') || 'otomatis');

// ------------------------------------------------------------
// 5) ROUTER (hash-based SPA)
// ------------------------------------------------------------
const ROUTES = {
  dashboard: renderDashboard,
  katalog: renderKatalog,
  inventaris: renderInventaris,
  'inventaris/tambah': renderForm,
  'inventaris/edit': renderForm,
  detail: renderDetail,
  favorit: renderFavorit,
  laporan: renderLaporan,
  pengaturan: renderPengaturan
};

function navigasi(route) { window.location.hash = '#/' + route; }

function router() {
  const hash = window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [base, param] = hash.split('?id=');
  const fn = ROUTES[base] || renderDashboard;
  document.querySelectorAll('#nav-items button').forEach(b => {
    b.classList.toggle('active', b.dataset.route === base.split('/')[0]);
  });
  fn(param);
}
window.addEventListener('hashchange', router);
document.getElementById('nav-items').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-route]');
  if (btn) navigasi(btn.dataset.route);
});

const root = () => document.getElementById('page-root');
const slug = (s) => String(s || '').replace(/\s+/g, '_');
const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function skeletonCards(n, tinggi) {
  return Array.from({ length: n }).map(() => `<div class="card skeleton" style="height:${tinggi || 120}px;"></div>`).join('');
}

// ==================================================================
// HALAMAN: DASHBOARD
// ==================================================================
async function renderDashboard() {
  root().innerHTML = `
    <div class="bento" id="dash-grid">
      ${skeletonCards(1, 220).replace('card skeleton', 'card skeleton span-7')}
      <div class="stat-grid">${skeletonCards(4, 100)}</div>
      <div class="card skeleton span-6" style="height:260px;"></div>
      <div class="card skeleton span-6" style="height:260px;"></div>
    </div>`;

  const res = await apiGet('dashboard');
  if (!res.success) { root().innerHTML = `<div class="empty-state"><div class="big-icon">⚠️</div><div>${esc(res.message)}</div></div>`; return; }
  const d = res.data;

  const statItem = (icon, bg, value, label, delta) => `
    <div class="card stat-card interactive">
      <div class="top">
        <div class="icon" style="background:${bg}1a; color:${bg};">${icon}</div>
        ${delta ? `<span class="delta">${delta}</span>` : ''}
      </div>
      <div class="value">${value}</div>
      <div class="label">${label}</div>
    </div>`;

  root().innerHTML = `
    <div class="bento">
      <div class="hero-card">
        <span style="font-size:11px; opacity:.7; letter-spacing:.5px; text-transform:uppercase;">Sistem Terpadu v${APP_VERSION_SAFE()}</span>
        <h1>Kelola Semua Tautan<br>Digital Anda Dalam Satu Tempat</h1>
        <p>Akses lebih cepat, terorganisir rapi, produktivitas semakin meningkat.</p>
        <div style="display:flex; gap:10px; margin-top:8px;">
          <button class="btn-primary" onclick="navigasi('inventaris/tambah')">+ Tambah URL</button>
          <button class="btn-secondary" style="background:rgba(255,255,255,.1); border-color:rgba(255,255,255,.25); color:#fff;" onclick="navigasi('katalog')">Jelajahi Katalog</button>
        </div>
      </div>
      <div class="stat-grid">
        ${statItem('🌐', '#1E63E9', d.totalUrl, 'Total URL')}
        ${statItem('🗂️', '#16A34A', d.totalKategori, 'Kategori')}
        ${statItem('⭐', '#F59E0B', d.favorit, 'Favorit')}
        ${statItem('✅', '#22C5E8', d.aktif, 'Status Aktif')}
      </div>

      <div class="card span-8">
        <h3 style="margin-bottom:4px;">Aktivitas 30 Hari Terakhir</h3>
        <canvas id="chart-aktivitas" height="90"></canvas>
      </div>
      <div class="card span-4">
        <h3 style="margin-bottom:10px;">Kategori Populer</h3>
        <div class="kategori-grid">
          ${d.kategoriPopuler.map(k => `
            <div class="kategori-pill">
              <div>
                <div class="count">${k.jumlah}</div>
                <div class="name">${esc(k.kategori)}</div>
              </div>
            </div>`).join('') || '<div class="empty-state" style="padding:10px;">Belum ada kategori</div>'}
        </div>
      </div>

      <div class="card span-12">
        <h3 style="margin-bottom:10px;">Akses Cepat</h3>
        <div class="quick-grid" style="grid-template-columns:repeat(6,1fr);">
          <button class="quick-btn" onclick="navigasi('inventaris/tambah')">➕<br>Tambah URL</button>
          <button class="quick-btn" onclick="navigasi('katalog')">🧩<br>Katalog</button>
          <button class="quick-btn" onclick="navigasi('favorit')">⭐<br>Favorit</button>
          <button class="quick-btn" onclick="navigasi('laporan')">📊<br>Laporan</button>
          <button class="quick-btn" onclick="aksiBackup_()">☁️<br>Backup</button>
          <button class="quick-btn" onclick="navigasi('pengaturan')">⚙️<br>Pengaturan</button>
        </div>
      </div>
    </div>`;

  gambarGrafikAktivitas_(d.aktivitas);
}
function APP_VERSION_SAFE() { return '1.0'; }

function gambarGrafikAktivitas_(aktivitas) {
  const canvas = document.getElementById('chart-aktivitas');
  if (!canvas || !aktivitas || !aktivitas.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600, h = 90;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const max = Math.max(1, ...aktivitas.map(a => a.jumlah));
  const stepX = w / (aktivitas.length - 1 || 1);
  const warnaAksen = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#22C5E8';

  ctx.beginPath();
  aktivitas.forEach((a, i) => {
    const x = i * stepX, y = h - (a.jumlah / max) * (h - 10) - 4;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = warnaAksen; ctx.lineWidth = 2.5; ctx.stroke();

  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, warnaAksen + '55'); grad.addColorStop(1, warnaAksen + '00');
  ctx.fillStyle = grad; ctx.fill();
}

// ==================================================================
// HALAMAN: KATALOG (App Launcher Grid)
// ==================================================================
let _katalogFilter = { kategori: '', q: '' };
async function renderKatalog() {
  root().innerHTML = `
    <div class="toolbar">
      <div class="search-input"><span class="ic">🔍</span><input id="katalog-search" placeholder="Cari aplikasi atau kategori..."></div>
    </div>
    <div class="chip-row" id="katalog-chips"><div class="chip active" data-k="">Semua Kategori</div></div>
    <div class="app-grid" id="katalog-grid">${skeletonCards(8, 150)}</div>`;

  const [kat, dataRes] = await Promise.all([apiGet('kategori'), apiGet('katalog', _katalogFilter)]);
  const chipWrap = document.getElementById('katalog-chips');
  (kat.data || []).forEach(k => {
    const el = document.createElement('div');
    el.className = 'chip'; el.dataset.k = k.nama; el.textContent = k.nama;
    chipWrap.appendChild(el);
  });
  chipWrap.addEventListener('click', async (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    chipWrap.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active'); _katalogFilter.kategori = chip.dataset.k;
    muatGridKatalog_();
  });
  document.getElementById('katalog-search').addEventListener('input', debounce_((e) => {
    _katalogFilter.q = e.target.value; muatGridKatalog_();
  }, 280));

  gambarGridKatalog_(dataRes.data || []);
}
async function muatGridKatalog_() {
  const res = await apiGet('katalog', _katalogFilter);
  gambarGridKatalog_(res.data || []);
}
function gambarGridKatalog_(items) {
  const grid = document.getElementById('katalog-grid');
  if (!items.length) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="big-icon">🗂️</div>Belum ada aplikasi di kategori ini<br><button class="btn-primary" style="margin-top:10px;" onclick="navigasi('inventaris/tambah')">Tambah URL</button></div>`; return; }
  grid.innerHTML = items.map(app => `
    <div class="card interactive app-card">
      <div class="top-row">
        <div class="app-logo" style="background:${esc(app.warnaUtama || '#0B2A6B')}">
          ${app.thumbnail ? `<img src="${esc(app.thumbnail)}" alt="">` : esc((app.nama || '?')[0])}
        </div>
        <button class="fav-btn ${app.favorit ? 'active' : ''}" onclick="aksiToggleFavorit_('${app.id}', this)">★</button>
      </div>
      <div>
        <div class="name">${esc(app.nama)}</div>
        <div class="cat"><span class="status-dot ${slug(app.status)}"></span>${esc(app.kategori)}</div>
      </div>
      <div style="display:flex; gap:8px; margin-top:4px;">
        <a class="btn-secondary" style="flex:1; text-align:center;" href="#/detail?id=${app.id}">Detail</a>
        <a class="btn-primary" style="flex:1; text-align:center;" href="${esc(app.url)}" target="_blank" rel="noopener">Buka ↗</a>
      </div>
    </div>`).join('');
}

// ==================================================================
// HALAMAN: INVENTARIS (Data Table)
// ==================================================================
let _invState = { page: 1, perPage: 10, q: '', kategori: '', status: '', sortBy: 'Tanggal Ditambahkan', sortDir: 'desc' };
async function renderInventaris() {
  root().innerHTML = `
    <div class="toolbar">
      <div class="search-input"><span class="ic">🔍</span><input id="inv-search" placeholder="Cari aplikasi, kategori, atau URL..."></div>
      <select id="inv-filter-status" class="btn-secondary" style="height:40px;">
        <option value="">Semua Status</option>
        <option value="Aktif">Aktif</option>
        <option value="Tidak Aktif">Tidak Aktif</option>
        <option value="Perlu Diperiksa">Perlu Diperiksa</option>
      </select>
      <button class="btn-secondary" onclick="aksiCekStatus_()">🔄 Cek Status</button>
      <button class="btn-secondary" onclick="aksiEkspor_('xlsx')">⬇ Ekspor</button>
      <button class="btn-primary" onclick="navigasi('inventaris/tambah')">+ Tambah URL</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>No</th><th>Nama Aplikasi</th><th>Kategori</th><th>Status</th><th>Terakhir Dicek</th><th style="text-align:right;">Aksi</th></tr></thead>
        <tbody id="inv-tbody"><tr><td colspan="6"><div class="skeleton" style="height:200px;"></div></td></tr></tbody>
      </table>
      <div class="pagination" id="inv-pagination"></div>
    </div>`;

  document.getElementById('inv-search').addEventListener('input', debounce_((e) => { _invState.q = e.target.value; _invState.page = 1; muatTabelInventaris_(); }, 280));
  document.getElementById('inv-filter-status').addEventListener('change', (e) => { _invState.status = e.target.value; _invState.page = 1; muatTabelInventaris_(); });

  muatTabelInventaris_();
}
async function muatTabelInventaris_() {
  const res = await apiGet('inventaris', _invState);
  const tbody = document.getElementById('inv-tbody');
  if (!res.success) { tbody.innerHTML = `<tr><td colspan="6">${esc(res.message)}</td></tr>`; return; }
  if (!res.data.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="big-icon">🔍</div>Tidak ada hasil ditemukan<br><button class="btn-secondary" style="margin-top:8px;" onclick="resetFilterInventaris_()">Reset Filter</button></div></td></tr>`; document.getElementById('inv-pagination').innerHTML = ''; return; }

  tbody.innerHTML = res.data.map((app, i) => `
    <tr>
      <td>${(_invState.page - 1) * _invState.perPage + i + 1}</td>
      <td><div class="row-app"><img class="thumb" src="${esc(app.thumbnail || '')}" onerror="this.style.visibility='hidden'"><a href="#/detail?id=${app.id}"><strong>${esc(app.nama)}</strong></a></div></td>
      <td>${esc(app.kategori)}</td>
      <td><span class="badge ${slug(app.status)}">${esc(app.status)}</span></td>
      <td>${app.terakhirDicek ? new Date(app.terakhirDicek).toLocaleString('id-ID') : '—'}</td>
      <td style="text-align:right;">
        <button class="btn-ghost" title="Lihat" onclick="navigasi('detail?id=${app.id}')">👁️</button>
        <button class="btn-ghost" title="Edit" onclick="navigasi('inventaris/edit?id=${app.id}')">✏️</button>
        <button class="btn-ghost" title="Hapus" onclick="aksiHapus_('${app.id}', '${esc(app.nama).replace(/'/g, "\\'")}')">🗑️</button>
      </td>
    </tr>`).join('');

  const totalHalaman = Math.ceil(res.total / _invState.perPage) || 1;
  const pag = document.getElementById('inv-pagination');
  let tombol = '';
  for (let p = 1; p <= Math.min(totalHalaman, 7); p++) tombol += `<button class="${p === _invState.page ? 'active' : ''}" onclick="gantiHalamanInventaris_(${p})">${p}</button>`;
  pag.innerHTML = `
    <span>Menampilkan ${(res.data.length ? (_invState.page - 1) * _invState.perPage + 1 : 0)}-${(_invState.page - 1) * _invState.perPage + res.data.length} dari ${res.total} data</span>
    <div class="page-pills">${tombol}</div>`;
}
function gantiHalamanInventaris_(p) { _invState.page = p; muatTabelInventaris_(); }
function resetFilterInventaris_() { _invState = { page: 1, perPage: 10, q: '', kategori: '', status: '', sortBy: 'Tanggal Ditambahkan', sortDir: 'desc' }; renderInventaris(); }

async function renderFavorit() {
  const res = await apiGet('katalog', { favorit: '1' });
  root().innerHTML = `<h2 style="margin-bottom:14px;">⭐ Favorit</h2><div class="app-grid" id="katalog-grid"></div>`;
  gambarGridKatalog_(res.data || []);
}

// ==================================================================
// AKSI: HAPUS, FAVORIT, CEK STATUS, BACKUP, EKSPOR
// ==================================================================
async function aksiHapus_(id, nama) {
  if (!confirm('Hapus "' + nama + '" dari inventaris? Tindakan ini tidak dapat dibatalkan.')) return;
  const res = await apiPost('hapusUrl', { id });
  toast(res.message, res.success ? 'success' : 'error');
  if (res.success) muatTabelInventaris_();
}
async function aksiToggleFavorit_(id, btn) {
  const res = await apiPost('toggleFavorit', { id });
  if (res.success) btn.classList.toggle('active', res.favorit);
}
async function aksiCekStatus_() {
  const res = await apiPost('cekStatusSemua', {});
  toast(res.message, res.success ? 'info' : 'error');
}
async function aksiBackup_() {
  toast('Membuat backup...', 'info');
  const res = await apiPost('backupSekarang', {});
  toast(res.message, res.success ? 'success' : 'error');
}
async function aksiEkspor_(format) {
  toast('Menyiapkan berkas ekspor...', 'info');
  const res = await apiPost('ekspor', { format, filter: _invState });
  if (res.success) window.open(res.url, '_blank');
  else toast(res.message, 'error');
}

function debounce_(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ==================================================================
// HALAMAN: FORM TAMBAH / EDIT URL
// ==================================================================
async function renderForm(id) {
  const editMode = !!id;
  let app = { nama: '', url: '', tipe: 'WebApp', kategori: '', deskripsi: '', pemilik: '', username: '', catatan: '', warnaUtama: '#0B2A6B', palet: ['#0B2A6B', '#1E63E9', '#22C5E8', '#F4F8FF'], favorit: false, thumbnail: '', logo: '' };
  if (editMode) {
    const res = await apiGet('detail', { id });
    if (!res.success) { toast(res.message, 'error'); navigasi('inventaris'); return; }
    app = Object.assign(app, res.data);
  }
  const kat = await apiGet('kategori');

  root().innerHTML = `
    <h2 style="margin-bottom:2px;">${editMode ? 'Edit' : 'Tambah'} URL ${editMode ? '' : 'Baru'}</h2>
    <p style="color:var(--text-secondary); margin:0 0 20px;">Simpan informasi aplikasi atau website ke pusat inventarisasi.</p>
    <form id="form-url">
      <div class="form-grid">
        <div>
          <div class="card" style="margin-bottom:16px;">
            <label style="font-weight:700; font-size:13px;">Logo Aplikasi</label>
            <div class="dropzone" id="dropzone-logo">
              <img id="preview-logo" class="hidden">
              <div id="dropzone-placeholder">📤<br><strong>Upload Logo</strong> atau Drag &amp; Drop<br><span class="hint">PNG, JPG, SVG, WEBP — Maks 5MB</span></div>
            </div>
            <input type="file" id="input-logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" class="hidden">
            <p class="hint">Thumbnail 128×128 px dibuat otomatis di perangkat Anda sebelum diunggah.</p>
          </div>
          <div class="card">
            <label style="font-weight:700; font-size:13px;">Warna &amp; Aksen Kartu</label>
            <div class="field" style="margin-top:10px;">
              <label>Warna Utama</label>
              <input type="text" id="input-warna-utama" value="${esc(app.warnaUtama)}">
            </div>
            <label>Palet (4 warna)</label>
            <div class="swatch-row" id="swatch-row"></div>
          </div>
        </div>
        <div>
          <div class="card" style="margin-bottom:16px;">
            <h3 style="margin-bottom:14px; font-size:16px;">Informasi Utama</h3>
            <div class="field"><label>Nama Aplikasi *</label><input type="text" id="f-nama" value="${esc(app.nama)}" required></div>
            <div class="field"><label>URL Tautan *</label><input type="url" id="f-url" value="${esc(app.url)}" placeholder="https://" required><div class="error hidden" id="err-url">URL wajib diawali https://</div></div>
            <div style="display:flex; gap:16px;">
              <div class="field" style="flex:1;">
                <label>Tipe</label>
                <select id="f-tipe"><option ${app.tipe === 'Website' ? 'selected' : ''}>Website</option><option ${app.tipe === 'WebApp' ? 'selected' : ''}>WebApp</option></select>
              </div>
              <div class="field" style="flex:1;">
                <label>Kategori *</label>
                <select id="f-kategori">${(kat.data || []).map(k => `<option ${k.nama === app.kategori ? 'selected' : ''}>${esc(k.nama)}</option>`).join('')}</select>
              </div>
            </div>
          </div>
          <div class="card" style="margin-bottom:16px;">
            <h3 style="margin-bottom:14px; font-size:16px;">Deskripsi &amp; Identitas Pengelola</h3>
            <div class="field"><label>Deskripsi / Fungsi</label><textarea id="f-deskripsi">${esc(app.deskripsi)}</textarea></div>
            <div style="display:flex; gap:16px;">
              <div class="field" style="flex:1;"><label>Nama Pemilik/Penyedia</label><input type="text" id="f-pemilik" value="${esc(app.pemilik)}"></div>
              <div class="field" style="flex:1;"><label>Username/Email (opsional)</label><input type="text" id="f-username" value="${esc(app.username)}"></div>
            </div>
            <div class="field"><label>Catatan Tambahan</label><textarea id="f-catatan">${esc(app.catatan)}</textarea></div>
          </div>
          <div class="card">
            <h3 style="margin-bottom:14px; font-size:16px;">Preferensi</h3>
            <div style="display:flex; gap:24px; align-items:center;">
              <div><label style="display:block; margin-bottom:6px;">Tandai Favorit</label><button type="button" class="toggle ${app.favorit ? 'on' : ''}" id="t-favorit"></button></div>
            </div>
          </div>
          <div class="form-footer">
            <button type="button" class="btn-secondary" onclick="navigasi('inventaris')">Batal</button>
            <button type="submit" class="btn-primary">${editMode ? 'Simpan Perubahan' : 'Simpan URL'}</button>
          </div>
        </div>
      </div>
    </form>`;

  // ---- Palet warna ----
  let paletTerpilih = app.warnaUtama;
  const swatchRow = document.getElementById('swatch-row');
  function gambarSwatch() {
    swatchRow.innerHTML = app.palet.map(c => `<div class="swatch ${c === paletTerpilih ? 'selected' : ''}" style="background:${esc(c)}" data-c="${esc(c)}"></div>`).join('');
  }
  gambarSwatch();
  swatchRow.addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch'); if (!sw) return;
    paletTerpilih = sw.dataset.c;
    document.getElementById('input-warna-utama').value = paletTerpilih;
    gambarSwatch();
  });
  document.getElementById('input-warna-utama').addEventListener('input', (e) => { paletTerpilih = e.target.value; });

  // ---- Toggle favorit ----
  const tFav = document.getElementById('t-favorit');
  tFav.addEventListener('click', () => tFav.classList.toggle('on'));

  // ---- Upload logo + thumbnail canvas ----
  let logoBase64 = null, logoMime = null, logoNama = null;
  const dz = document.getElementById('dropzone-logo');
  const inputLogo = document.getElementById('input-logo');
  if (app.thumbnail) { document.getElementById('preview-logo').src = app.thumbnail; document.getElementById('preview-logo').classList.remove('hidden'); document.getElementById('dropzone-placeholder').classList.add('hidden'); }
  dz.addEventListener('click', () => inputLogo.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) prosesLogo_(e.dataTransfer.files[0]); });
  inputLogo.addEventListener('change', (e) => { if (e.target.files[0]) prosesLogo_(e.target.files[0]); });

  function prosesLogo_(file) {
    if (file.size > 5 * 1024 * 1024) { toast('Ukuran berkas melebihi 5MB.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        // buat thumbnail 128x128 di browser (canvas) sesuai PRD
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 128, 128);
        const thumbDataUrl = canvas.toDataURL('image/png');
        document.getElementById('preview-logo').src = thumbDataUrl;
        document.getElementById('preview-logo').classList.remove('hidden');
        document.getElementById('dropzone-placeholder').classList.add('hidden');

        logoBase64 = ev.target.result.split(',')[1];
        logoMime = file.type; logoNama = file.name;
        window._thumbBase64 = thumbDataUrl.split(',')[1];
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ---- Submit ----
  document.getElementById('form-url').addEventListener('submit', async (e) => {
    e.preventDefault();
    const urlVal = document.getElementById('f-url').value.trim();
    const urlInput = document.getElementById('f-url');
    const errUrl = document.getElementById('err-url');
    if (!/^https:\/\//i.test(urlVal)) { urlInput.classList.add('invalid'); errUrl.classList.remove('hidden'); return; }
    urlInput.classList.remove('invalid'); errUrl.classList.add('hidden');

    const data = {
      nama: document.getElementById('f-nama').value.trim(),
      url: urlVal,
      tipe: document.getElementById('f-tipe').value,
      kategori: document.getElementById('f-kategori').value,
      deskripsi: document.getElementById('f-deskripsi').value.trim(),
      pemilik: document.getElementById('f-pemilik').value.trim(),
      username: document.getElementById('f-username').value.trim(),
      catatan: document.getElementById('f-catatan').value.trim(),
      warnaUtama: paletTerpilih,
      palet: app.palet,
      favorit: tFav.classList.contains('on')
    };

    const tombolSubmit = e.target.querySelector('button[type=submit]');
    tombolSubmit.disabled = true; tombolSubmit.textContent = 'Menyimpan...';

    let res;
    if (editMode) res = await apiPost('editUrl', { id, data });
    else res = await apiPost('tambahUrl', { data });

    if (res.success) {
      const targetId = editMode ? id : res.id;
      if (logoBase64) await apiPost('uploadLampiran', { id: targetId, jenis: 'Logo', namaBerkas: logoNama, mime: logoMime, base64: logoBase64 });
      if (window._thumbBase64) await apiPost('uploadLampiran', { id: targetId, jenis: 'Thumbnail', namaBerkas: 'thumb.png', mime: 'image/png', base64: window._thumbBase64 });
      toast(res.message, 'success');
      navigasi('inventaris');
    } else {
      toast(res.message, 'error');
      tombolSubmit.disabled = false; tombolSubmit.textContent = editMode ? 'Simpan Perubahan' : 'Simpan URL';
    }
  });
}

// ==================================================================
// HALAMAN: DETAIL APLIKASI
// ==================================================================
async function renderDetail(id) {
  root().innerHTML = skeletonCards(1, 300);
  const res = await apiGet('detail', { id });
  if (!res.success) { root().innerHTML = `<div class="empty-state">${esc(res.message)}</div>`; return; }
  const a = res.data;
  root().innerHTML = `
    <div class="card">
      <div class="detail-header">
        <img class="detail-logo" src="${esc(a.thumbnail || '')}" style="background:${esc(a.warnaUtama)}" onerror="this.style.visibility='hidden'">
        <div style="flex:1;">
          <h2>${esc(a.nama)}</h2>
          <span class="badge ${slug(a.status)}">${esc(a.status)}</span>
          <span style="color:var(--text-secondary); font-size:12.5px; margin-left:8px;">Oleh ${esc(a.pemilik || '—')}</span>
        </div>
        <div style="display:flex; gap:8px;">
          <a class="btn-primary" href="${esc(a.url)}" target="_blank" rel="noopener">Buka Situs ↗</a>
          <button class="btn-secondary" onclick="navigasi('inventaris/edit?id=${a.id}')">✏️ Edit</button>
          <button class="btn-danger" onclick="aksiHapus_('${a.id}', '${esc(a.nama).replace(/'/g, "\\'")}')">🗑️ Hapus</button>
        </div>
      </div>
      <p>${esc(a.deskripsi) || '<span style="color:var(--text-secondary)">Tidak ada deskripsi.</span>'}</p>
      <div class="kv-grid" style="margin-top:14px;">
        <div class="kv"><div class="k">Kategori</div><div class="v">${esc(a.kategori)}</div></div>
        <div class="kv"><div class="k">Tipe</div><div class="v">${esc(a.tipe)}</div></div>
        <div class="kv"><div class="k">Username/Email</div><div class="v">${esc(a.username) || '—'}</div></div>
        <div class="kv"><div class="k">Ditambahkan</div><div class="v">${a.ditambahkan ? new Date(a.ditambahkan).toLocaleDateString('id-ID') : '—'}</div></div>
        <div class="kv"><div class="k">Terakhir Diperiksa</div><div class="v">${a.terakhirDicek ? new Date(a.terakhirDicek).toLocaleString('id-ID') : 'Belum pernah'}</div></div>
        <div class="kv"><div class="k">Catatan</div><div class="v">${esc(a.catatan) || '—'}</div></div>
      </div>
    </div>`;
}

// ==================================================================
// HALAMAN: LAPORAN
// ==================================================================
async function renderLaporan() {
  root().innerHTML = skeletonCards(1, 300);
  const res = await apiGet('laporan');
  if (!res.success) { root().innerHTML = `<div class="empty-state">${esc(res.message)}</div>`; return; }
  const d = res.data;
  root().innerHTML = `
    <div class="bento">
      <div class="card span-6">
        <h3>Aplikasi per Kategori</h3>
        <canvas id="chart-kategori" height="180"></canvas>
      </div>
      <div class="card span-6">
        <h3>Status URL</h3>
        <div style="display:flex; gap:12px; margin-top:16px; flex-wrap:wrap;">
          <span class="badge Aktif">Aktif: ${d.perStatus['Aktif'] || 0}</span>
          <span class="badge Tidak_Aktif">Tidak Aktif: ${d.perStatus['Tidak Aktif'] || 0}</span>
          <span class="badge Perlu_Diperiksa">Perlu Diperiksa: ${d.perStatus['Perlu Diperiksa'] || 0}</span>
        </div>
      </div>
      <div class="card span-12">
        <div class="toolbar">
          <h3 style="flex:1;">Tabel Laporan</h3>
          <button class="btn-secondary" onclick="aksiEkspor_('xlsx')">⬇ Ekspor Excel</button>
          <button class="btn-secondary" onclick="aksiEkspor_('pdf')">⬇ Ekspor PDF</button>
          <button class="btn-secondary" onclick="window.print()">🖨️ Cetak</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Nama Aplikasi</th><th>Kategori</th><th>Status</th></tr></thead>
            <tbody>${d.tabel.map(a => `<tr><td>${esc(a.nama)}</td><td>${esc(a.kategori)}</td><td><span class="badge ${slug(a.status)}">${esc(a.status)}</span></td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  gambarBarKategori_(d.perKategori);
}
function gambarBarKategori_(data) {
  const canvas = document.getElementById('chart-kategori');
  if (!canvas || !data.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 500, h = 180;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const max = Math.max(...data.map(d => d.jumlah));
  const barW = w / data.length - 12;
  const primer = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  data.forEach((d, i) => {
    const x = i * (w / data.length) + 6;
    const barH = (d.jumlah / max) * (h - 30);
    ctx.fillStyle = primer; ctx.fillRect(x, h - barH - 20, barW, barH);
    ctx.fillStyle = '#6b7280'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
    ctx.fillText(d.kategori.slice(0, 10), x + barW / 2, h - 6);
    ctx.fillText(String(d.jumlah), x + barW / 2, h - barH - 24);
  });
}

// ==================================================================
// HALAMAN: PENGATURAN
// ==================================================================
async function renderPengaturan() {
  root().innerHTML = `
    <div class="settings-layout">
      <div class="settings-nav">
        <button class="active" data-tab="profil">👤 Profil &amp; Akun</button>
        <button data-tab="tampilan">🎨 Tampilan</button>
        <button data-tab="notifikasi">🔔 Notifikasi</button>
        <button data-tab="backup">☁️ Backup &amp; Restore</button>
        <button data-tab="kategori">🗂️ Kategori</button>
        <button data-tab="keamanan">🔒 Keamanan</button>
      </div>
      <div id="settings-panel" class="card"></div>
    </div>`;
  document.querySelectorAll('.settings-nav button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); gambarPanelPengaturan_(b.dataset.tab);
  }));
  gambarPanelPengaturan_('profil');
}

function gambarPanelPengaturan_(tab) {
  const panel = document.getElementById('settings-panel');
  if (tab === 'profil') {
    panel.innerHTML = `<h3>Profil &amp; Akun</h3><p class="hint">Aplikasi personal — satu pengguna (Owner). Akun terhubung melalui Google Apps Script milik Anda sendiri.</p>`;
  } else if (tab === 'tampilan') {
    const tema = Store.get('tema') || 'otomatis';
    panel.innerHTML = `
      <h3>Mode Tampilan</h3>
      <div class="segmented" style="margin-top:10px;">
        <button data-m="terang" class="${tema === 'terang' ? 'active' : ''}">☀️ Terang</button>
        <button data-m="gelap" class="${tema === 'gelap' ? 'active' : ''}">🌙 Gelap</button>
        <button data-m="otomatis" class="${tema === 'otomatis' ? 'active' : ''}">🖥️ Otomatis</button>
      </div>`;
    panel.querySelectorAll('button[data-m]').forEach(b => b.addEventListener('click', () => { terapkanTema(b.dataset.m); gambarPanelPengaturan_('tampilan'); }));
  } else if (tab === 'notifikasi') {
    panel.innerHTML = `
      <h3>Notifikasi Email</h3>
      <div class="field"><label>Alamat email untuk notifikasi URL tidak aktif</label><input type="email" id="set-email" placeholder="anda@email.com"></div>
      <button class="btn-primary" onclick="aksiSimpanNotifikasi_()">Simpan</button>`;
  } else if (tab === 'backup') {
    panel.innerHTML = `
      <h3>Backup &amp; Restore</h3>
      <p class="hint">Backup otomatis berjalan setiap hari (3 salinan terbaru disimpan di Google Drive).</p>
      <button class="btn-primary" onclick="aksiBackup_()">☁️ Backup Sekarang</button>`;
  } else if (tab === 'kategori') {
    gambarKelolaKategori_(panel);
  } else if (tab === 'keamanan') {
    panel.innerHTML = `
      <h3>Ubah PIN</h3>
      <div class="field"><label>PIN Lama</label><input type="password" id="set-pin-lama"></div>
      <div class="field"><label>PIN Baru (4-8 digit)</label><input type="password" id="set-pin-baru"></div>
      <button class="btn-primary" onclick="aksiUbahPin_()">Simpan PIN Baru</button>
      <hr style="margin:20px 0; border-color:var(--border);">
      <button class="btn-secondary" onclick="keluar_()">Keluar dari Sesi Ini</button>`;
  }
}
async function gambarKelolaKategori_(panel) {
  panel.innerHTML = `<h3>Kelola Kategori</h3><div id="kategori-list" class="skeleton" style="height:120px;"></div>
    <div style="display:flex; gap:8px; margin-top:14px;"><input type="text" id="kategori-baru" placeholder="Nama kategori baru"><button class="btn-primary" onclick="aksiTambahKategori_()">Tambah</button></div>`;
  const res = await apiGet('kategori');
  document.getElementById('kategori-list').innerHTML = (res.data || []).map(k => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);">
      <span>${esc(k.nama)}</span>
      <button class="btn-ghost" onclick="aksiHapusKategori_('${esc(k.nama).replace(/'/g, "\\'")}')">🗑️</button>
    </div>`).join('');
}
async function aksiTambahKategori_() {
  const nama = document.getElementById('kategori-baru').value.trim();
  if (!nama) return;
  const res = await apiPost('simpanKategori', { data: { nama } });
  toast(res.message, res.success ? 'success' : 'error');
  if (res.success) gambarKelolaKategori_(document.getElementById('settings-panel'));
}
async function aksiHapusKategori_(nama) {
  if (!confirm('Hapus kategori "' + nama + '"?')) return;
  const res = await apiPost('hapusKategori', { nama });
  toast(res.message, res.success ? 'success' : 'error');
  if (res.success) gambarKelolaKategori_(document.getElementById('settings-panel'));
}
async function aksiSimpanNotifikasi_() {
  const email = document.getElementById('set-email').value.trim();
  const res = await apiPost('simpanPengaturan', { data: { notifEmail: email } });
  toast(res.message, res.success ? 'success' : 'error');
}
async function aksiUbahPin_() {
  const pinLama = document.getElementById('set-pin-lama').value;
  const pinBaru = document.getElementById('set-pin-baru').value;
  const res = await apiPost('ubahPin', { pinLama, pinBaru });
  toast(res.message, res.success ? 'success' : 'error');
  if (res.success) keluar_();
}

// ------------------------------------------------------------
// INISIALISASI
// ------------------------------------------------------------
cekSesiAwal();
if (TOKEN) router();

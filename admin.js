/* ===== PURITY LABS ADMIN — CONTROL CENTER ===== */
/* Live management console. Every collection is stored in Firebase Firestore
   (via pdb.js) and watched in real time — an edit here is reflected on the
   storefront instantly. Admin access is gated by Firebase Auth + the
   users/{uid}.role == 'admin' profile field. */

'use strict';

/* ---------------- utils ---------------- */
const $  = (s, c) => (c || document).querySelector(s);
const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (n) => '$' + (isNaN(n) ? (0).toFixed(2) : (+n).toFixed(2));
const todayStr = () => new Date().toISOString();
const uid = () => 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return '—'; } };
const fmtDt = (iso) => { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return '—'; } };

/* ---------------- cloudinary unsigned uploads ---------------- */
const CLOUD_NAME = 'qqwevfkz';
const CLOUD_PRESET = 'peptides';

function cloudinaryUpload(file) {
  const fd = new FormData();
  fd.append('upload_preset', CLOUD_PRESET);
  fd.append('file', file);
  return fetch('https://api.cloudinary.com/v1_1/' + CLOUD_NAME + '/image/upload', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      if (!data || !data.secure_url) {
        throw new Error((data && data.error && data.error.message) || 'Upload failed');
      }
      return data.secure_url;
    });
}

function toast(msg, type) {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + (type || '');
  t.innerHTML = '<i class="fa-solid ' + (type === 'error' ? 'fa-circle-xmark' : type === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-check') + '"></i><span>' + esc(msg) + '</span>';
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 350); }, 2600);
}

/* ---------------- store ---------------- */
/* Firestore <-> admin mapping: which collection each in-memory table maps to,
   and how to derive the document id for a record. */
const COLLS = {
  products: { col: 'products',      key: p => { try { return p.slug || p.id; } catch { return null; } } },
  cats:     { col: 'categories',    key: c => String(c.id) || c.slug },
  orders:   { col: 'orders',        key: o => o.id },
  coupons:  { col: 'coupons',       key: c => c.id || c.code },
  nav:      { col: 'nav',           key: n => n.id },
  media:    { col: 'media',         key: m => m.id || m.src },
  content:  { col: 'content',       key: () => 'home' },
  settings: { col: 'settings',      key: () => 'config' },
  newsletter: { col: 'newsletter',  key: n => n.id || n.email },
  visits:   { col: 'visits',        key: v => v.id || v.date }
};

/* doc ids currently known to be in Firestore per collection (used to delete
   records that are removed from the admin before a reload). */
const fsKeys = {};
let currentPanel = 'dashboard';
let fsUnsubs = [];

function refreshAdminPanel() {
  renderNav();
  const f = PANELS[currentPanel];
  if (f) f();
}

function syncCollection(col, list, keyFn) {
  if (!PDB.ready || !PDB.db || !list) return;
  const batch = PDB.batch();
  if (!batch) return;
  const live = {};
  list.forEach(it => {
    let id = null;
    try { id = keyFn(it); } catch { id = null; }
    if (!id) return;
    live[id] = true;
    const d = Object.assign({}, it);
    delete d.id;
    batch.set(PDB.db.collection(col).doc(id), d, { merge: true });
  });
  Object.keys(fsKeys[col] || {}).forEach(id => {
    if (!live[id]) batch.delete(PDB.db.collection(col).doc(id));
  });
  batch.commit().then(() => { fsKeys[col] = live; }).catch(() => {});
}

let DB = {};

function withPos(arr) { return (arr || []).map((p, i) => { if (p.pos == null) p.pos = i; return p; }); }
function byPos(a, b) { return (+a.pos || 0) - (+b.pos || 0); }
function keysOf(list) { const o = {}; (list || []).forEach(x => { if (x && x.id) o[x.id] = true; }); return o; }

/* Initial (pre-live) catalog. Firestore is the single source of truth — every
   collection starts empty or with defaults, then firestoreLoad() fills the
   panel with live data via realtime watchers. */
function catalogData() {
  const content = {
    siteName: 'Purity Labs', tagline: 'Premium Research Peptides',
    topbar: 'FREE SHIPPING on orders over $250 · Discreet packaging',
    heroTitle: 'Research-Grade Peptides',
    heroSubtitle: 'Premium peptides & nasal sprays, lab-tested, batch COAs on every product.',
    heroBtn: 'Shop Peptides', heroUrl: '#products',
    footerAbout: 'Purity Labs supplies research peptides and nasal sprays with strict quality control and batch COAs.'
  };
  const settings = {
    currency: 'USD $', freeShipThreshold: 250, flatRate: 9.99, taxRate: 0,
    lowStockAlert: 10, ordersPerPage: 10, emailFrom: 'no-reply@puritylabs.com',
    adminNotifyEmails: '', storeAddress: '', contactEmail: 'info@puritylabs.org',
    whatsapp: '15551234567',
    emailFooterNote: 'For in-vitro research and laboratory use only. Not for human consumption.',
    returnsPolicy: 'Returns accepted within 14 days of delivery for unopened, sealed products. Contact support for an RMA number.',
    terms: 'Research use only. Products are not intended for human consumption.'
  };
  return { products: [], cats: [], nav: [], content, settings };
}

function initDB() {
  const cat = catalogData();
  DB = {
    products: cat.products,
    cats: cat.cats,
    orders: [], coupons: [], visits: [], media: [], news: [], tracking: [],
    users: [],
    nav: cat.nav,
    content: cat.content,
    settings: cat.settings
  };
  firestoreLoad();
}

/* --- realtime sync: Firestore -> admin --- */
function firestoreLoad() {
  if (!PDB.ready) { renderNav(); showPanel(currentPanel); return; }
  fsUnsubs.forEach(u => { try { u(); } catch (e) {} });
  fsUnsubs = [];

  const watch = (col, assign) => {
    fsUnsubs.push(PDB.watchCol(col, list => {
      fsKeys[col] = keysOf(list);
      assign(list || []);
      refreshAdminPanel();
    }));
  };

  watch('products', v => { DB.products = withPos(v).sort(byPos); });
  watch('categories', v => { DB.cats = v; });
  watch('orders', v => { DB.orders = v; });
  watch('coupons', v => { DB.coupons = v; });
  watch('newsletter', v => { DB.news = v; });
  watch('nav', v => { DB.nav = v; });
  watch('media', v => { DB.media = v; });
  watch('users', v => { DB.users = v; });
  watch('visits', v => { DB.visits = v; sliceSortVisits(); });
  watch('tracking', v => { DB.tracking = v; });
  watch('content', v => { if (v && v.length) DB.content = Object.assign({}, DB.content, v[0]); });
  watch('settings', v => { if (v && v.length) DB.settings = Object.assign({}, DB.settings, v[0]); });
}

function sliceSortVisits() {
  try { DB.visits = DB.visits.slice().sort((a, b) => new Date(a.date) - new Date(b.date)); } catch (e) {}
}

function persistAll() {
  if (!PDB.ready || !PDB.db) return;
  syncCollection('products', DB.products, COLLS.products.key);
  syncCollection('categories', DB.cats, COLLS.cats.key);
  syncCollection('orders', DB.orders, COLLS.orders.key);
  syncCollection('coupons', DB.coupons, COLLS.coupons.key);
  syncCollection('newsletter', DB.news, COLLS.newsletter.key);
  syncCollection('nav', DB.nav, COLLS.nav.key);
  syncCollection('media', DB.media, COLLS.media.key);
  syncCollection('visits', DB.visits, COLLS.visits.key);
  if (DB.content) PDB.setDoc('content', 'home', DB.content, { merge: true }).catch(() => {});
  if (DB.settings) PDB.setDoc('settings', 'config', DB.settings, { merge: true }).catch(() => {});
}

/* ============ catalog publish ============ */
/* persistAll() syncs the in-memory admin state into Firestore: the product
   catalog (products, categories, navigation, content blocks and settings) is
   written; transactional collections (orders, coupons, visits, media) are only
   written once real data exists, so no fake/demo data is ever pushed. Customers
   come from the users collection. */
function publishCatalog() {
  askConfirm('Publish catalog?', 'Writes the product catalog (products, categories, navigation, content and settings) into Firestore. Orders, coupons, visits and media are never touched. Existing Firestore edits are kept. Continue?', () => {
    persistAll();
    toast('Catalog published to Firestore — live now.');
  });
}

/* ---------------- auth ---------------- */
const LOCATIONS = {
  dashboard: 'Dashboard', products: 'Products', categories: 'Categories', orders: 'Orders',
  users: 'Users & Roles', coupons: 'Coupons', newsletter: 'Newsletter',
  content: 'Content', navigation: 'Navigation', media: 'Media Library', analytics: 'Analytics', settings: 'Settings'
};

function logout() { PDB.signOut().then(() => location.reload()); }

function unlock() {
  $('#loginGate').classList.add('hidden');
  $('#adminWrap').classList.add('ready');
  initApp();
  toast('Welcome back — signed in as admin.');
}

/* restore the login submit button after a failed/timed-out sign-in so the
   "Signing in…" state never sticks forever */
function resetLoginBtn() {
  const btn = document.querySelector('#loginForm button[type="submit"]');
  if (!btn) return;
  clearTimeout(btn.__timer);
  btn.disabled = false;
  btn.innerHTML = btn.dataset.orig || btn.innerHTML;
}

function initAuth() {
  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#loginUser').value.trim();
    const pass = $('#loginPass').value;
    if (!email || !pass) { $('#loginError').textContent = 'Enter your email and password.'; return; }
    const btn = e.target.querySelector('button[type="submit"]');
    const orig = btn.innerHTML;
    btn.dataset.orig = orig;
    btn.disabled = true; btn.textContent = 'Signing in…';
    /* watchdog: never let the button spin forever */
    btn.__timer = setTimeout(() => {
      resetLoginBtn();
      $('#loginError').textContent = 'Sign-in timed out — check your connection and try again.';
      toast('Sign-in timed out.', 'error');
    }, 15000);
    PDB.signIn(email, pass)
      .catch((err) => { resetLoginBtn(); $('#loginError').textContent = PDB.authMsg(err); toast(PDB.authMsg(err), 'error'); })
      .then((r) => {
        if (!r) { resetLoginBtn(); $('#loginError').textContent = 'Sign-in did not complete — try again.'; }
        else { $('#loginError').textContent = ''; }
      });
  });

  if (!PDB.ready) {
    $('#loginError').textContent = 'Firebase SDK not loaded — open admin over http(s), not file://.';
    return;
  }

  PDB.onAuth((user) => {
    if (!user) {
      $('#loginGate').classList.remove('hidden');
      $('#adminWrap').classList.remove('ready');
      return;
    }
    PDB.getDoc('users', user.uid).then((doc) => {
      if (doc && doc.role === 'admin') {
        $('#adminName').textContent = doc.name || user.email.split('@')[0] || 'Admin';
        $('#adminAvatar').textContent = ((doc.name || 'A')[0] || 'A').toUpperCase();
        if (!$('#adminWrap').classList.contains('ready')) unlock();
      } else if (!doc) {
        PDB.signOut();
        resetLoginBtn();
        $('#loginError').textContent = 'No admin profile found. Add Firestore doc users/<your-uid> with role: "admin".';
        toast('No admin profile found in Firestore.', 'error');
      } else {
        PDB.signOut();
        resetLoginBtn();
        $('#loginError').textContent = 'This account is not an administrator.';
        toast('This account is not an administrator.', 'error');
      }
    }).catch(() => {
      resetLoginBtn();
      $('#loginError').textContent = 'Could not verify the admin role.';
      toast('Could not verify the admin role.', 'error');
    });
  });
}

/* ---------------- shell ---------------- */
const NAV_ITEMS = [
  { id: 'dashboard',  icon: 'fa-gauge-high',    label: 'Dashboard' },
  { id: 'products',   icon: 'fa-capsules',      label: 'Products' },
  { id: 'categories', icon: 'fa-tags',          label: 'Categories' },
  { id: 'orders',     icon: 'fa-receipt',       label: 'Orders' },
  { id: 'users',      icon: 'fa-user-shield',   label: 'Users & Roles' },
  { id: 'coupons',    icon: 'fa-ticket',        label: 'Coupons' },
  { id: 'newsletter', icon: 'fa-envelope-open-text', label: 'Newsletter' },
  { id: 'content',    icon: 'fa-file-lines',    label: 'Content' },
  { id: 'navigation', icon: 'fa-bars',          label: 'Navigation' },
  { id: 'media',      icon: 'fa-images',        label: 'Media Library' },
  { id: 'analytics',  icon: 'fa-chart-line',    label: 'Analytics' },
  { id: 'settings',   icon: 'fa-gear',          label: 'Settings' }
];

function renderNav() {
  const counts = {
    orders: DB.orders.filter(o => o.status === 'pending').length
  };
  $('#sideNav').innerHTML = NAV_ITEMS.map(item => {
    const badge = counts[item.id] ? '<span class="side-badge">' + counts[item.id] + '</span>' : '';
    return '<button class="side-item" data-nav="' + item.id + '">' +
      '<i class="fa-solid ' + item.icon + '"></i><span>' + item.label + '</span>' + badge + '</button>';
  }).join('');
  $$('#sideNav .side-item').forEach(btn => {
    btn.addEventListener('click', () => {
      showPanel(btn.dataset.nav);
      $('#sidebar').classList.remove('open');
    });
  });
}

function showPanel(id) {
  currentPanel = id;
  $$('.panel').forEach(p => p.classList.remove('active'));
  const panel = $('#panel-' + id);
  if (!panel) return;
  panel.classList.add('active');
  $$('#sideNav .side-item').forEach(b => b.classList.toggle('active', b.dataset.nav === id));
  $('#pageTitle').textContent = LOCATIONS[id] || 'Dashboard';
  $('#breadcrumb').textContent = 'Admin / ' + (LOCATIONS[id] || 'Overview');
  window.scrollTo({ top: 0 });
  (PANELS[id] || (() => {}))();
}

/* ---------------- modal helpers ---------------- */
let modalOnClose = null;
function openModal(title, bodyHTML, footHTML, onClose) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHTML;
  $('#modalFoot').innerHTML = footHTML || '';
  $('#modalOverlay').classList.add('open');
  modalOnClose = onClose || null;
}
function closeModal() {
  $('#modalOverlay').classList.remove('open');
  if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); }
}

let confirmCb = null;
function askConfirm(title, text, cb) {
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmOverlay').classList.add('open');
  confirmCb = cb;
}

/* ---------------- dashboard ---------------- */
function renderDashboard() {
  const active = DB.products.filter(p => p.status === 'active').length;
  const low = DB.products.filter(p => p.stock <= DB.settings.lowStockAlert).length;
  const rev = DB.orders.filter(o => o.status !== 'refunded' && o.status !== 'cancelled')
    .reduce((s, o) => s + o.total, 0);
  const pending = DB.orders.filter(o => o.status === 'pending').length;
  const spend30 = DB.visits.slice(-30).reduce((s, d) => s + d.orders, 0);
  const visits30 = DB.visits.slice(-30).reduce((s, d) => s + d.visits, 0);
  const weekRev = DB.orders.filter(o => new Date(o.date) > new Date(daysAgo(7))).reduce((s, o) => s + o.total, 0);

  const stats = [
    { icon: 'fa-dollar-sign', cls: 'green', val: money(rev), lbl: 'Total Revenue', sub: money(weekRev) + ' last 7 days', trend: 'up' },
    { icon: 'fa-capsules', cls: 'blue', val: DB.products.length, lbl: 'Products', sub: active + ' active', trend: 'up' },
    { icon: 'fa-receipt', cls: 'amber', val: DB.orders.length, lbl: 'Orders', sub: pending + ' pending', trend: 'up' },
    { icon: 'fa-users', cls: 'red', val: DB.users.filter(u => u.role !== 'admin').length, lbl: 'Customers', sub: '+' + spend30 + ' orders (30d)', trend: 'up' }
  ];

  $('#panel-dashboard').innerHTML = `
    <div class="grid stat-grid" style="margin-bottom:18px;">
      ${stats.map(s => `
        <div class="stat-card">
          <div class="stat-icon ${s.cls}"><i class="fa-solid ${s.icon}"></i></div>
          <div class="stat-info">
            <b>${s.val}</b><span>${s.lbl}</span>
            <span class="trend ${s.trend}"><i class="fa-solid fa-arrow-trend-up"></i> ${s.sub}</span>
          </div>
        </div>`).join('')}
    </div>
    <div class="grid two">
      <div class="card">
        <div class="card-head"><div><h3>Revenue / Traffic (30 days)</h3><p>Visits and orders from store events</p></div></div>
        ${chartHTML(DB.visits.slice(-14), 'O')}
        <div class="chart-legend">
          <span><i style="background:#2E7D32;"></i>Visits</span>
          <span><i style="background:#66bb6a;"></i>Orders</span>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Low stock alerts</h3><p>${low} product(s) at or below threshold (${DB.settings.lowStockAlert})</p></div>
        <button class="btn btn-ghost btn-sm" data-goto="products">Manage</button></div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Product</th><th>Stock</th><th>Status</th></tr></thead>
            <tbody>
              ${DB.products.filter(p => p.stock <= DB.settings.lowStockAlert).sort((a,b)=>a.stock-b.stock).slice(0,6)
                .map(p => `<tr><td><div class="td-prod"><img src="${esc(p.image)}" alt=""><b>${esc(p.name)}</b></div></td>
                <td><span class="badge ${p.stock === 0 ? 'red' : 'warn'}">${p.stock === 0 ? 'Out of stock' : p.stock + ' left'}</span></td>
                <td><span class="badge ${p.status === 'active' ? 'ok' : 'muted'}">${esc(p.status)}</span></td></tr>`).join('') ||
                `<tr><td colspan="3"><div class="empty"><i class="fa-solid fa-circle-check"></i><p>All stocked up.</p></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="grid three" style="margin-top:18px;">
      <div class="card">
        <div class="card-head"><div><h3>Recent orders</h3><p>Latest ${Math.min(5, DB.orders.length)}</p></div>
        <button class="btn btn-ghost btn-sm" data-goto="orders">View all</button></div>
        ${DB.orders.slice(0,5).map(o => {
          const cname = (o.customer || o.email || 'Guest').toString();
          return `
          <div class="recent-item">
            <div class="avatar-sm">${esc(cname.split(' ').map(w => (w||'')[0]||'').join('').slice(0,2))}</div>
            <div class="recent-meta"><b>${esc(cname)}</b><span>${esc(o.id)} · ${fmtDate(o.date)}</span></div>
            <div><span class="badge ${statusCls(o.status)}">${esc(o.status)}</span><div class="recent-val">${money(o.total)}</div></div>
          </div>`;
        }).join('')}
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Product health</h3><p>By category</p></div></div>
        ${catHealthHTML()}
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Newsletter</h3><p>Latest subscribers</p></div>
        <button class="btn btn-ghost btn-sm" data-goto="newsletter">View all</button></div>
        ${(DB.news || []).slice(0,4).map(s => `
          <div class="recent-item">
            <div class="avatar-sm">${esc(((s.email || '?')[0] || '?').toUpperCase())}</div>
            <div class="recent-meta"><b>${esc(s.email)}</b><span>${fmtDate(s.joined)}</span></div>
            <span class="badge ok">subscribed</span>
          </div>`).join('') || '<div class="empty"><p>No subscribers yet.</p></div>'}
      </div>
    </div>`;
}

function catHealthHTML() {
  return DB.cats.map(c => {
    const list = DB.products.filter(p => p.cat === c.id);
    const pct = Math.round((list.filter(p => p.status === 'active').length / Math.max(list.length, 1)) * 100);
    return `<div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;font-size:.85rem;">
        <b style="color:var(--ink);">${esc(c.name)}</b><span style="color:var(--muted);">${list.filter(p=>p.status==='active').length}/${list.length} active</span>
      </div>
      <div class="mini-progress"><span style="width:${pct}%"></span></div>
    </div>`;
  }).join('');
}

function chartHTML(data, kind) {
  const max = Math.max(...data.map(d => d.visits)) || 1;
  return `<div class="chart">
    ${data.map(d => {
      const h = Math.round((d.visits / max) * 100);
      return `<div class="chart-col">
        <div class="chart-bar" style="height:${h}%" title=""></div>
        <span class="chart-lab">${new Date(d.date).getDate()}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function statusCls(s) {
  return { completed: 'ok', shipped: 'blue', processing: 'blue', pending: 'warn', refunded: 'muted', cancelled: 'red' }[s] || 'muted';
}

/* ---------------- products ---------------- */
let prodFilter = { q: '', cat: 'all', status: 'all' };

function renderProducts() {
  const list = DB.products.filter(p => {
    const q = prodFilter.q.toLowerCase();
    const okQ = !q || (p.name + ' ' + p.sku + ' ' + p.slug).toLowerCase().includes(q);
    const okC = prodFilter.cat === 'all' || p.cat === prodFilter.cat;
    const okS = prodFilter.status === 'all' || p.status === prodFilter.status;
    return okQ && okC && okS;
  });

  $('#panel-products').innerHTML = `
    <div class="toolbar">
      <input type="search" placeholder="Search name / SKU..." id="prodSearch" style="max-width:280px;">
      <select id="prodCatFilter" style="max-width:200px;">
        <option value="all">All categories</option>
        ${DB.cats.map(c => `<option value="${c.id}" ${prodFilter.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select id="prodStatusFilter" style="max-width:160px;">
        <option value="all">All statuses</option>
        <option ${prodFilter.status === 'active' ? 'selected' : ''} value="active">Active</option>
        <option ${prodFilter.status === 'hidden' ? 'selected' : ''} value="hidden">Hidden</option>
      </select>
      <div class="spacer"></div>
      <span class="count" style="font-size:.82rem;color:var(--muted);">${list.length} of ${DB.products.length} products</span>
      <button class="btn btn-primary" data-new-product><i class="fa-solid fa-plus"></i> Add Product</button>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Featured</th><th>COA</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
        <tbody>
          ${list.map(p => `
            <tr data-prod="${p.id}" data-cat="${p.cat}" data-status="${p.status}">
              <td><div class="td-prod"><img src="${esc(p.image)}" alt="" onerror="this.style.visibility='hidden'"><div><b>${esc(p.name)}</b><small>${esc(p.sku)} · ${esc(p.slug)}</small>${p.imageHistory && p.imageHistory.length ? `<span class="badge muted" style="margin-top:4px;width:fit-content;">${p.imageHistory.length} prev image${p.imageHistory.length > 1 ? 's' : ''}</span>` : ''}</div></div></td>
              <td>${catName(p.cat)}</td>
              <td><b style="color:var(--ink);">${money(p.price)}</b>${p.compare ? `<small style="color:var(--muted);text-decoration:line-through;margin-left:4px;">${money(p.compare)}</small>` : ''}</td>
              <td><span class="badge ${p.stock === 0 ? 'red' : p.stock <= DB.settings.lowStockAlert ? 'warn' : 'ok'}">${p.stock}</span></td>
              <td>${p.featured ? '<span class="badge ok"><i class="fa-solid fa-star"></i> Featured</span>' : '<span class="badge muted">—</span>'}</td>
              <td><button class="badge ${p.coaEnabled ? 'ok' : 'muted'}" data-toggle-coa="${p.id}" title="Toggle COA on the storefront"><i class="fa-solid ${p.coaEnabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i> ${p.coaEnabled ? 'On' : 'Off'}</button></td>
              <td><button class="badge ${p.status === 'active' ? 'ok' : 'muted'}" data-toggle-status="${p.id}">${esc(p.status)}</button></td>
              <td><div class="actions">
                <button class="icon-action" title="View on site" data-view-prod="${p.id}"><i class="fa-solid fa-eye"></i></button>
                <button class="icon-action" title="Edit" data-edit-prod="${p.id}"><i class="fa-solid fa-pen"></i></button>
                <button class="icon-action danger" title="Delete" data-del-prod="${p.id}"><i class="fa-solid fa-trash"></i></button>
              </div></td>
            </tr>`).join('') || '<tr><td colspan="8"><div class="empty"><i class="fa-solid fa-box-open"></i><p>No products match your filters.</p></div></td></tr>'}
        </tbody>
      </table>
    </div>`;

  const applyFilters = () => {
    const rows = $$('#panel-products tbody tr');
    rows.forEach(tr => {
      const q = prodFilter.q.toLowerCase();
      const okQ = !q || tr.textContent.toLowerCase().includes(q);
      const okC = prodFilter.cat === 'all' || tr.dataset.cat === prodFilter.cat;
      const okS = prodFilter.status === 'all' || tr.dataset.status === prodFilter.status;
      tr.style.display = okQ && okC && okS ? '' : 'none';
    });
    const cnt = $('.toolbar .count');
    if (cnt) cnt.textContent = rows.filter(r => r.style.display !== 'none').length + ' of ' + DB.products.length + ' products';
  };

  $('#prodSearch').addEventListener('input', e => { prodFilter.q = e.target.value; applyFilters(); });
  $('#prodCatFilter').addEventListener('change', e => { prodFilter.cat = e.target.value; applyFilters(); });
  $('#prodStatusFilter').addEventListener('change', e => { prodFilter.status = e.target.value; applyFilters(); });
  $$('[data-view-prod]').forEach(b => b.addEventListener('click', () => viewProductPage(b.dataset.viewProd)));
  $$('[data-edit-prod]').forEach(b => b.addEventListener('click', () => openProductForm(b.dataset.editProd)));
  $$('[data-del-prod]').forEach(b => b.addEventListener('click', () => deleteProduct(b.dataset.delProd)));
  $$('[data-toggle-status]').forEach(b => b.addEventListener('click', () => {
    const p = byId('products', b.dataset.toggleStatus);
    p.status = p.status === 'active' ? 'hidden' : 'active';
    persistAll(); renderProducts(); toast((p.status === 'active' ? 'Product published' : 'Product hidden') + ': ' + p.name);
  }));
  $$('[data-toggle-coa]').forEach(b => b.addEventListener('click', () => {
    const p = byId('products', b.dataset.toggleCoa);
    p.coaEnabled = !p.coaEnabled;
    persistAll(); renderProducts(); toast((p.coaEnabled ? 'COA shown on storefront' : 'COA hidden on storefront') + ': ' + p.name);
  }));
  $$('.toolbar [data-new-product]').forEach(b => b.addEventListener('click', () => openProductForm()));
}

function viewProductPage(id) {
  const p = byId('products', id);
  if (!p) return;
  openModal('Product page', `
    <div style="display:flex;gap:16px;margin-bottom:16px;">
      <img src="${esc(p.image)}" style="width:110px;height:110px;object-fit:contain;background:#F2F5F3;border-radius:10px;padding:6px;" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect fill=%22%23E8F3E9%22 width=%22100%22 height=%22100%22/%3E%3C/svg%3E'">
      <div>
        <h3 style="color:var(--ink);margin-bottom:6px;">${esc(p.name)}</h3>
        <p style="font-size:.86rem;color:var(--muted);margin-bottom:8px;">${esc(p.desc)}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${['price ' + money(p.price), 'stock ' + p.stock, 'SKU ' + esc(p.sku), p.featured ? 'featured' : ''].filter(Boolean).map(x => `<span class="badge ${x.startsWith('stock') && p.stock === 0 ? 'red' : 'ok'}">${esc(x)}</span>`).join('')}
        </div>
      </div>
    </div>
    <div class="form-field"><label>Live page URL</label>
      <input readonly value="pages/product.html?slug=${esc(p.slug)}">
    </div>`,
    '<button class="btn btn-ghost" data-close-modal>Close</button><a class="btn btn-primary" target="_blank" href="pages/product.html?slug=' + esc(p.slug) + '"><i class="fa-solid fa-up-right-from-square"></i> Open page</a>');
}

function openProductForm(id) {
  const isNew = !id;
  const p = isNew ? { id: '', name: '', slug: '', cat: 'powders', price: '', compare: '', stock: 10, sku: '', image: 'images/', featured: false, coaEnabled: true, coas: [], status: 'active', desc: '' } : byId('products', id);
  const name = isNew ? 'New Product' : p.name;
  openModal((isNew ? 'Add ' : 'Edit: ') + name, `
    <div class="form-grid">
      <div class="form-field full"><label>Product name</label><input id="pf-name" value="${esc(p.name)}" required></div>
      <div class="form-field"><label>Slug (page URL)</label><input id="pf-slug" value="${esc(p.slug)}" placeholder="product-name"></div>
      <div class="form-field"><label>Category</label><select id="pf-cat">
        ${DB.cats.map(c => `<option value="${c.id}" ${p.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select></div>
      <div class="form-field"><label>Price ($)</label><input id="pf-price" type="number" step="0.01" value="${p.price}" required></div>
      <div class="form-field"><label>Compare-at price ($)</label><input id="pf-compare" type="number" step="0.01" value="${p.compare || ''}" placeholder="optional"></div>
      <div class="form-field"><label>Stock</label><input id="pf-stock" type="number" value="${p.stock}" required></div>
      <div class="form-field"><label>SKU</label><input id="pf-sku" value="${esc(p.sku)}"></div>
      <div class="form-field full"><label>Image path / URL</label>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input id="pf-image" value="${esc(p.image)}" style="flex:1;min-width:220px;" placeholder="images/tb500.webp or https://res.cloudinary.com/...">
          <label class="btn btn-ghost btn-sm" id="pf-uploadlabel" style="cursor:pointer;margin:0;white-space:nowrap;"><i class="fa-solid fa-cloud-arrow-up"></i> Upload<input type="file" id="pf-imagefile" accept="image/*" style="display:none;"></label>
        </div>
        <span class="hint" id="pf-uploadstatus" style="display:block;margin-top:6px;">The previous image is kept in the library below so you can switch back anytime.</span>
      </div>
      <div class="form-field full"><label>Image library (current + previous)</label>
        <div id="pf-imglib" style="display:flex;flex-wrap:wrap;gap:12px;"></div>
      </div>
      <div class="form-field">
        <label>Status</label><select id="pf-status">
          <option value="active" ${p.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="hidden" ${p.status === 'hidden' ? 'selected' : ''}>Hidden</option>
        </select>
      </div>
      <div class="form-field" style="justify-content:flex-end;">
        <label style="margin-bottom:10px;">Featured</label>
        <select id="pf-featured">
          <option value="false" ${!p.featured ? 'selected' : ''}>No</option>
          <option value="true" ${p.featured ? 'selected' : ''}>Yes — show in highlights</option>
        </select>
      </div>
      <div class="form-field full"><label>Short description</label><textarea id="pf-desc">${esc(p.desc)}</textarea></div>
      <div class="form-field" style="justify-content:flex-end;">
        <label style="margin-bottom:10px;">COA on storefront</label>
        <select id="pf-coaenabled">
          <option value="true" ${p.coaEnabled ? 'selected' : ''}>On — show COA</option>
          <option value="false" ${!p.coaEnabled ? 'selected' : ''}>Off — hide COA</option>
        </select>
      </div>
      <div class="form-field full"><label>COA images (one URL / path per line)</label>
        <textarea id="pf-coas" rows="4" placeholder="https://swisschems.is/.../HPLC.webp">${esc((p.coas || []).join('\n'))}</textarea>
        <span class="hint">Each line becomes one COA image in the lightbox. Use images/coa-placeholder.svg for a generic document.</span>
      </div>
    </div>`,
    '<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" data-save-prod>Save Product</button>');
  let curImage = p.image || '';
  const imgHist = ((p.imageHistory || []).slice());
  const pfRender = () => {
    const lib = $('#pf-imglib');
    if (!lib) return;
    const items = [{ url: curImage, cur: true }].concat(imgHist.map(url => ({ url, cur: false })))
      .filter(x => x.url && x.url.trim() !== 'images/');
    if (!items.length) { lib.innerHTML = '<span class="hint">No image uploaded yet — upload one or type a path above.</span>'; return; }
    lib.innerHTML = items.map((it, i) => `
      <div class="pf-img-item" style="width:112px;text-align:center;">
        <div style="border:2px solid ${it.cur ? '#2E7D32' : '#dfe3e1'};border-radius:8px;padding:4px;background:#fff;height:92px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
          <img src="${esc(it.url)}" alt="" onerror="this.style.visibility='hidden'" style="max-width:100%;max-height:100%;object-fit:contain;">
        </div>
        <div style="margin-top:6px;display:flex;justify-content:center;gap:4px;min-height:24px;">
          ${it.cur ? '<span class="badge ok">Current</span>' : `<button class="btn btn-ghost btn-sm" data-pf-use="${i}">Use</button><button class="btn btn-ghost btn-sm" style="color:var(--danger,#c0392b);" data-pf-del="${i}" title="Delete from history"><i class="fa-solid fa-trash"></i></button>`}
        </div>
      </div>`).join('');
    $$('[data-pf-use]').forEach(b => b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.pfUse);
      const piece = imgHist[idx - 1];
      if (idx === 0 || !piece) return;
      if (curImage && curImage.trim() !== 'images/' && imgHist.indexOf(curImage) === -1) imgHist.unshift(curImage);
      imgHist.splice(imgHist.indexOf(piece), 1);
      curImage = piece;
      $('#pf-image').value = curImage;
      pfRender();
    }));
    $$('[data-pf-del]').forEach(b => b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.pfDel);
      const piece = imgHist[idx - 1];
      if (idx === 0 || !piece) return;
      imgHist.splice(imgHist.indexOf(piece), 1);
      pfRender();
    }));
  };
  $('#pf-imagefile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const label = $('#pf-uploadlabel');
    const status = $('#pf-uploadstatus');
    if (label) label.style.opacity = '.5';
    if (status) status.textContent = 'Uploading ' + f.name + '…';
    cloudinaryUpload(f)
      .then(url => {
        if (curImage && curImage.trim() !== 'images/' && curImage !== url && imgHist.indexOf(curImage) === -1) imgHist.unshift(curImage);
        curImage = url;
        $('#pf-image').value = url;
        pfRender();
        if (Array.isArray(DB.media)) DB.media.push({ id: uid(), name: f.name, src: url, size: f.size, uploadedBy: 'you' });
        toast('Image uploaded: ' + f.name);
      })
      .catch(err => toast('Upload failed: ' + ((err && err.message) || 'unknown error'), 'error'))
      .then(() => {
        if (label) label.style.opacity = '';
        if (status) status.textContent = 'The previous image is kept in the library below so you can switch back anytime.';
      });
  });
  pfRender();

  $('#modalFoot [data-save-prod]').addEventListener('click', () => {
    const typedImg = $('#pf-image').value.trim();
    if (typedImg !== curImage) {
      if (curImage && curImage.trim() !== 'images/' && imgHist.indexOf(curImage) === -1) imgHist.unshift(curImage);
      if (typedImg && imgHist.indexOf(typedImg) !== -1) imgHist.splice(imgHist.indexOf(typedImg), 1);
      curImage = typedImg;
    }
    const rec = {
      id: p.id || uid(),
      name: $('#pf-name').value.trim(),
      slug: ($('#pf-slug').value.trim() || slugify($('#pf-name').value)) ,
      cat: $('#pf-cat').value,
      price: parseFloat($('#pf-price').value) || 0,
      compare: parseFloat($('#pf-compare').value) || 0,
      stock: parseInt($('#pf-stock').value) || 0,
      sku: $('#pf-sku').value.trim() || 'PL-0000',
      image: curImage,
      imageHistory: imgHist,
      featured: $('#pf-featured').value === 'true',
      status: $('#pf-status').value,
      desc: $('#pf-desc').value.trim(),
      coaEnabled: $('#pf-coaenabled').value === 'true',
      coas: ($('#pf-coas').value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean),
      pos: isNew ? DB.products.length : (p.pos != null ? p.pos : DB.products.length)
    };
    if (!rec.name) { toast('Product name is required.', 'error'); return; }
    if (isNew) DB.products.push(rec); else Object.assign(p, rec);
    persistAll(); closeModal(); renderProducts();
    toast(isNew ? 'Product created. Remember to create the page from it.' : 'Product updated.');
  });
}

function deleteProduct(id) {
  const p = byId('products', id);
  askConfirm('Delete product?', 'Delete "' + p.name + '" ? This only removes it from the admin catalog.', () => {
    DB.products = DB.products.filter(x => x.id !== id);
    persistAll(); renderProducts(); toast('Product deleted.');
  });
}

/* ---------------- categories ---------------- */
function renderCategories() {
  $('#panel-categories').innerHTML = `
    <div class="toolbar">
      <h3 style="color:var(--ink);font-size:1rem;">${DB.cats.length} categories</h3>
      <div class="spacer"></div>
      <button class="btn btn-primary" data-new-cat><i class="fa-solid fa-plus"></i> Add Category</button>
    </div>
    <div class="grid three">
      ${DB.cats.map(c => {
        const list = DB.products.filter(p => p.cat === c.id);
        return `<div class="card">
          <div class="card-head"><div><h3>${esc(c.name)}</h3><p>${list.length} products · page: ${esc(c.slug)}</p></div></div>
          <p style="font-size:.85rem;color:var(--text);margin-bottom:14px;">${list.filter(p=>p.status==='active').length} active · $${list.reduce((s,p)=>s+p.price,0).toFixed(2)} catalog value</p>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" data-edit-cat="${c.id}"><i class="fa-solid fa-pen"></i> Rename</button>
            <button class="btn btn-ghost btn-sm" data-sort-cat="${c.id}"><i class="fa-solid fa-arrow-up-wide-short"></i> Sort</button>
            <button class="btn btn-ghost btn-sm danger" data-del-cat="${c.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  $$('[data-new-cat]').forEach(b => b.addEventListener('click', () => openCatForm()));
  $$('[data-edit-cat]').forEach(b => b.addEventListener('click', () => openCatForm(b.dataset.editCat)));
  $$('[data-sort-cat]').forEach(b => b.addEventListener('click', () => sortCatProducts(b.dataset.sortCat)));
  $$('[data-del-cat]').forEach(b => b.addEventListener('click', () => {
    const c = byId('cats', b.dataset.delCat);
    askConfirm('Delete category?', 'Delete "' + c.name + '"? Products in it are not deleted.', () => {
      DB.cats = DB.cats.filter(x => x.id !== c.id);
      persistAll(); renderCategories(); toast('Category deleted.');
    });
  }));
}

function openCatForm(id) {
  const isNew = !id;
  const c = isNew ? { name: '', slug: '' } : byId('cats', id);
  openModal(isNew ? 'Add Category' : 'Edit Category', `
    <div class="form-grid">
      <div class="form-field"><label>Name</label><input id="cf-name" value="${esc(c.name)}"></div>
      <div class="form-field"><label>Page slug</label><input id="cf-slug" value="${esc(c.slug)}"></div>
    </div>`,
    '<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" data-save-cat>Save</button>');
  $('#modalFoot [data-save-cat]').addEventListener('click', () => {
    const name = $('#cf-name').value.trim();
    if (!name) { toast('Name required.', 'error'); return; }
    if (isNew) DB.cats.push({ id: uid(), name, slug: $('#cf-slug').value.trim() || slugify(name) });
    else { c.name = name; c.slug = $('#cf-slug').value.trim() || slugify(name); }
    persistAll(); closeModal(); renderCategories(); renderNav(); toast('Category saved.');
  });
}

function sortCatProducts(catId) {
  const list = DB.products.filter(p => p.cat === catId).sort((a, b) => a.name.localeCompare(b.name));
  openModal('Sort products', `
    <p style="font-size:.86rem;color:var(--muted);margin-bottom:14px;">Drag to reorder display on the storefront category page.</p>
    <div id="sortList" style="display:flex;flex-direction:column;gap:6px;">
      ${list.map((p, i) => `<div class="page-tree-item" data-idx="${i}"><span class="drag"><i class="fa-solid fa-grip-vertical"></i></span><span class="link">${esc(p.name)}</span></div>`).join('')}
    </div>`,
    '<button class="btn btn-ghost" data-close-modal>Close</button><button class="btn btn-primary" id="saveSort">Save Order</button>');
  const listEl = $('#sortList');
  let dragging = null;
  $$('#sortList .page-tree-item').forEach(el => {
    el.addEventListener('dragstart', () => { dragging = el; });
    el.addEventListener('dragover', (e) => { e.preventDefault(); const after = el; listEl.insertBefore(dragging, after.nextSibling); });
  });
  $('#saveSort').addEventListener('click', () => {
    const order = $$('#sortList .page-tree-item').map(el => parseInt(el.dataset.idx));
    const reordered = order.map(i => list[i]);
    DB.products = DB.products.map(p => p.cat === catId ? reordered.shift() : p).filter(Boolean);
    DB.products.forEach((p, i) => { p.pos = i; });
    persistAll(); closeModal(); toast('Order saved for ' + catName(catId) + '.');
  });
}

/* ---------------- orders ---------------- */
let orderFilter = 'all';
function renderOrders() {
  const list = orderFilter === 'all' ? DB.orders : DB.orders.filter(o => o.status === orderFilter);
  $('#panel-orders').innerHTML = `
    <div class="toolbar">
      <div class="seg">
        ${['all', 'pending', 'processing', 'shipped', 'completed', 'refunded', 'cancelled'].map(s =>
          `<button class="${orderFilter === s ? 'active' : ''}" data-os="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
      </div>
      <div class="spacer"></div>
      <input type="search" placeholder="Search order / customer..." id="ordSearch" style="max-width:250px;">
      <button class="btn btn-primary" data-new-order><i class="fa-solid fa-plus"></i> Manual Order</button>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
        <tbody>
          ${list.filter(o => { const q = String(($('#ordSearch') || {}).value || '').toLowerCase(); return !q || o.id.toLowerCase().includes(q) || o.customer.toLowerCase().includes(q) || o.email.toLowerCase().includes(q); }).map(o => `
            <tr>
              <td><b style="color:var(--ink);">${esc(o.id)}</b></td>
              <td><b style="color:var(--ink);">${esc(o.customer)}</b><div style="font-size:.76rem;color:var(--muted);">${esc(o.email)}</div></td>
              <td style="white-space:nowrap;">${fmtDate(o.date)}</td>
              <td>${o.items.reduce((s, i) => s + i.qty, 0)}</td>
              <td><b style="color:var(--ink);">${money(o.total)}</b></td>
              <td><div style="display:flex;gap:6px;align-items:center;">
                <select class="ord-status" style="width:auto;padding:6px 10px;font-size:.8rem;" data-order="${o.id}">
                ${['pending','processing','shipped','completed','refunded','cancelled'].map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
                <input type="text" class="ord-note" data-order="${o.id}" placeholder="optional note…" style="width:118px;padding:6px 8px;font-size:.78rem;border:1px solid var(--line);border-radius:6px;background:#fff;">
              </div></td>
              <td><div class="actions">
                <button class="icon-action" data-view-order="${o.id}"><i class="fa-solid fa-eye"></i></button>
                <button class="icon-action danger" data-del-order="${o.id}"><i class="fa-solid fa-trash"></i></button>
              </div></td>
            </tr>`).join('') || '<tr id="ordEmpty"><td colspan="7"><div class="empty"><i class="fa-solid fa-receipt"></i><p>No orders found.</p></div></td></tr>'}
        </tbody>
      </table>
    </div>`;
  $('#ordSearch').addEventListener('input', () => {
    const rows = $$('#panel-orders tbody tr');
    let n = 0;
    rows.forEach(tr => {
      const q = String(($('#ordSearch') || {}).value || '').toLowerCase();
      const show = !q || String(tr.textContent || '').toLowerCase().includes(q);
      tr.style.display = show ? '' : 'none';
      if (show) n++;
    });
    const empty = $('#ordEmpty');
    if (empty) empty.style.display = n ? 'none' : 'block';
  });
  $$('.seg button').forEach(b => b.addEventListener('click', () => { orderFilter = b.dataset.os; renderOrders(); }));
  $$('[data-view-order]').forEach(b => b.addEventListener('click', () => viewOrder(b.dataset.viewOrder)));
  $$('[data-del-order]').forEach(b => b.addEventListener('click', () => {
    const o = byId('orders', b.dataset.delOrder);
    askConfirm('Delete order?', o.id + ' · ' + money(o.total) + ' will be permanently removed.', () => {
      DB.orders = DB.orders.filter(x => x.id !== o.id); persistAll(); renderOrders(); toast('Order deleted.');
      PDB.delDoc('tracking', o.id).catch(() => {});
    });
  }));
  $$('[data-new-order]').forEach(b => b.addEventListener('click', newOrderForm));
  $$('.ord-status').forEach(sel => sel.addEventListener('change', () => {
    const o = byId('orders', sel.dataset.order);
    if (!o) return;
    const note = $('[data-order="' + o.id + '"].ord-note');
    const msg = (note && note.value || '').trim();
    const at = new Date().toISOString();
    const entry = { status: sel.value, message: msg, at: at };
    o.status = sel.value;
    o.tracking = (o.tracking || []).concat(entry);
    o.updatedAt = at;
    persistAll(); renderOrders(); renderNav(); toast('Order ' + o.id + ' → ' + sel.value + (msg ? ' (+ note)' : ''));
    PDB.setDoc('tracking', o.id, {
      orderId: o.id, status: o.status, items: o.items || [], subtotal: o.subtotal,
      shipping: o.shipping, tax: o.tax, total: o.total, tracking: o.tracking, updatedAt: at
    }, { merge: true }).catch(() => {});
  }));
}

function viewOrder(id) {
  const o = byId('orders', id);
  if (!o) return;
  openModal('Order ' + o.id, `
    <div style="display:flex;justify-content:space-between;margin-bottom:16px;font-size:.9rem;">
      <div><b style="color:var(--ink);">${esc(o.customer)}</b><div style="color:var(--muted);">${esc(o.email)}</div></div>
      <span class="badge ${statusCls(o.status)}">${esc(o.status)}</span>
    </div>
    <div class="table-wrap" style="margin-bottom:14px;">
      <table class="data">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>${o.items.map(i => `<tr><td><b style="color:var(--ink);">${esc(i.name)}</b></td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.price * i.qty)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;font-size:.9rem;margin-bottom:14px;">
      ${[['Subtotal', money(o.subtotal)], ['Shipping', money(o.shipping)], ['Total', money(o.total)], ['Payment', esc(o.method + ' ' + (o.payment || ''))], ['Placed', fmtDate(o.date)]]
        .map(([k, v]) => `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">${k}</span><b style="color:var(--ink);">${v}</b></div>`).join('')}
    </div>
    <div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:14px;">
      <div style="font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">Tracking</div>
      ${(o.tracking || []).length ? o.tracking.slice().reverse().map((st, i) => {
        const c = statusCls(st.status);
        return `<div style="border-left:2px solid ${i === 0 ? 'var(--primary)' : 'var(--line)'};padding:0 0 12px 12px;position:relative;">
          <div style="position:absolute;left:-5px;top:5px;width:8px;height:8px;border-radius:50%;background:${i === 0 ? 'var(--primary)' : 'var(--line)'};"></div>
          <div style="display:flex;align-items:center;gap:8px;"><span class="badge ${c}">${esc(st.status)}</span><span style="font-size:.76rem;color:var(--muted);">${fmtDt(st.at)}</span></div>
          ${st.message ? `<div style="font-size:.84rem;color:var(--ink);margin-top:3px;">${esc(st.message)}</div>` : ''}
        </div>`;
      }).join('') : '<div style="font-size:.84rem;color:var(--muted);">No tracking updates yet. Change the status to add one.</div>'}
    </div>`,
    '<button class="btn btn-ghost" data-close-modal>Close</button>');
}

function newOrderForm() {
  const line = (pid) => {
    const p = DB.products.find(x => x.id === pid);
    return `<div class="order-line" style="display:grid;grid-template-columns:1fr 70px 80px 34px;gap:8px;margin-bottom:8px;align-items:center;">
      <select class="nl-prod">${DB.products.map(x => `<option value="${x.id}" ${x.id === pid ? 'selected' : ''}>${esc(x.name)} — ${money(x.price)}</option>`).join('')}</select>
      <input type="number" class="nl-qty" value="1" min="1">
      <span class="nl-line-total" style="text-align:right;color:var(--ink);font-weight:600;"></span>
      <button type="button" class="icon-action danger nl-del" title="Remove"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  };
  const updTotals = () => {
    let sub = 0;
    $$('.order-line').forEach(el => {
      const p = DB.products.find(x => x.id === el.querySelector('.nl-prod').value);
      const tot = p.price * (parseInt(el.querySelector('.nl-qty').value) || 1);
      sub += tot;
      el.querySelector('.nl-line-total').textContent = money(tot);
    });
    $('#nlSub').textContent = money(sub);
    const shipping = sub >= DB.settings.freeShipThreshold ? 0 : +DB.settings.flatRate;
    $('#nlShip').textContent = shipping === 0 ? 'Free' : money(shipping);
    $('#nlTotal').textContent = money(sub + shipping);
  };
  openModal('Create manual order', `
    <div class="form-field" style="margin-bottom:10px;"><label>Customer</label><input id="nl-customer" placeholder="Full name"></div>
    <div class="form-field" style="margin-bottom:14px;"><label>Email</label><input id="nl-email" placeholder="email@example.com"></div>
    <label style="margin-bottom:8px;">Line items</label>
    <div id="nl-lines">${line('p01')}${line('p02')}</div>
    <button type="button" class="btn btn-ghost btn-sm" id="nl-add-line" style="margin-bottom:16px;"><i class="fa-solid fa-plus"></i> Add line</button>
    <div style="border-top:1px solid var(--line);padding-top:12px;display:flex;flex-direction:column;gap:8px;font-size:.92rem;">
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Subtotal</span><b style="color:var(--ink);" id="nlSub"></b></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Shipping</span><b style="color:var(--ink);" id="nlShip"></b></div>
      <div style="display:flex;justify-content:space-between;font-size:1rem;"><span>Total</span><b style="color:var(--primary);" id="nlTotal"></b></div>
    </div>`,
    '<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" id="nl-save">Create Order</button>');
  const lines = $('#nl-lines');
  const addLine = (pid) => { lines.insertAdjacentHTML('beforeend', line(pid)); wireLine(lines.lastElementChild); updTotals(); };
  function wireLine(el) {
    el.querySelector('.nl-prod').addEventListener('change', updTotals);
    el.querySelector('.nl-qty').addEventListener('input', updTotals);
    el.querySelector('.nl-del').addEventListener('click', () => { el.remove(); updTotals(); });
    updTotals();
  }
  $$('.order-line').forEach(wireLine);
  $('#nl-add-line').addEventListener('click', () => addLine('p01'));
  $('#nl-save').addEventListener('click', () => {
    const cust = $('#nl-customer').value.trim();
    const email = $('#nl-email').value.trim();
    if (!cust || !email) { toast('Customer and email required.', 'error'); return; }
    const items = $$('.order-line').map(el => {
      const p = DB.products.find(x => x.id === el.querySelector('.nl-prod').value);
      return { name: p.name, qty: parseInt(el.querySelector('.nl-qty').value) || 1, price: p.price };
    }).filter(i => i.qty > 0);
    if (!items.length) { toast('Add at least one item.', 'error'); return; }
    const sub = items.reduce((s, i) => s + i.price * i.qty, 0);
    const shipping = sub >= DB.settings.freeShipThreshold ? 0 : +DB.settings.flatRate;
    const at = todayStr();
    const rec = { id: 'ORD-' + (7843 + DB.orders.length), customer: cust, email, date: at, items, subtotal: sub, shipping, total: sub + shipping, status: 'pending', payment: 'Manual', method: '—', updatedAt: at, tracking: [{ status: 'pending', message: 'Manual order created by admin.', at: at }] };
    DB.orders.unshift(rec);
    persistAll(); closeModal(); renderOrders();
    PDB.setDoc('tracking', rec.id, {
      orderId: rec.id, status: rec.status, items: rec.items, subtotal: rec.subtotal,
      shipping: rec.shipping, tax: 0, total: rec.total, tracking: rec.tracking, updatedAt: at
    }, { merge: true }).catch(() => {});
    toast('Manual order ' + rec.id + ' created.');
  });
}

/* ---------------- users & roles ---------------- */
function renderUsers() {
  const me = PDB.currentUser();
  $('#panel-users').innerHTML = `
    <div class="toolbar">
      <h3 style="color:var(--ink);font-size:1rem;">${DB.users.length} registered account(s)</h3>
      <div class="spacer"></div>
      <button class="btn btn-primary" data-new-admin><i class="fa-solid fa-user-plus"></i> Add Admin</button>
    </div>
    <p style="font-size:.82rem;color:var(--muted);margin-bottom:14px;">Customers are created on storefront sign-up; promote one here, or create a brand-new admin account. Role changes take effect immediately.</p>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>User</th><th>Role</th><th>Joined</th><th style="text-align:right;">Actions</th></tr></thead>
        <tbody>
          ${DB.users.map(u => {
            const isMe = me && u.id === me.uid;
            const role = u.role === 'admin' ? 'Admin' : 'Customer';
            const roleCls = u.role === 'admin' ? 'ok' : 'muted';
            return `<tr>
              <td><div class="td-prod"><div class="avatar-sm">${esc(initials(u.name))}</div><div><b style="color:var(--ink);">${esc(u.name || u.email)}</b><small>${esc((u.email || '') + (isMe ? ' · you' : ''))}</small></div></div></td>
              <td><span class="badge ${roleCls}">${role}</span></td>
              <td style="white-space:nowrap;">${fmtDate(u.joined)}</td>
              <td><div class="actions">
                ${u.role === 'admin'
                  ? `<button class="icon-action" data-user-role="customer" data-user-id="${u.id}" title="Demote to customer" ${isMe ? 'disabled style="opacity:.35;cursor:not-allowed;"' : ''}><i class="fa-solid fa-user-minus"></i></button>`
                  : `<button class="icon-action" data-user-role="admin" data-user-id="${u.id}" title="Promote to admin"><i class="fa-solid fa-user-shield"></i></button>`}
                ${isMe ? '' : `<button class="icon-action danger" data-del-user="${u.id}" title="Remove account"><i class="fa-solid fa-trash"></i></button>`}
              </div></td>
            </tr>`;
          }).join('') || '<tr><td colspan="4"><div class="empty"><i class="fa-solid fa-user-group"></i><p>No accounts yet.</p></div></td></tr>'}
        </tbody>
      </table>
    </div>
    <p style="font-size:.78rem;color:var(--muted);margin-top:12px;">Roles come from the <code>users/{uid}.role</code> document. Admins are the only ones allowed to change or remove roles. You cannot demote or remove your own account.</p>`;
  $$('[data-user-role]').forEach(b => {
    if (!b.disabled) b.addEventListener('click', () => setUserRole(b.dataset.userId, b.dataset.userRole));
  });
  $$('[data-del-user]').forEach(b => {
    b.addEventListener('click', () => removeUser(b.dataset.delUser));
  });
  $('.toolbar [data-new-admin]').addEventListener('click', openUserForm);
}

function setUserRole(uid, role) {
  const u = DB.users.find(x => x.id === uid);
  if (!u) return;
  const me = PDB.currentUser();
  if (me && uid === me.uid && role !== 'admin') {
    toast('You cannot demote your own account.', 'warn');
    return;
  }
  const verb = role === 'admin' ? 'promote to admin' : 'demote to customer';
  askConfirm('Change role?', (u.name || u.email) + ' will be ' + verb + '.', () => {
    PDB.setDoc('users', uid, { role: role }, { merge: true })
      .then(() => toast((u.name || u.email) + ' is now a ' + (role === 'admin' ? 'admin' : 'customer') + '.', 'ok'))
      .catch((err) => toast('Could not update role: ' + PDB.authMsg(err), 'error'));
  });
}

function removeUser(uid) {
  const u = DB.users.find(x => x.id === uid);
  if (!u) return;
  const me = PDB.currentUser();
  if (me && uid === me.uid) { toast('You cannot remove your own account.', 'warn'); return; }
  const isAdminAcct = u.role === 'admin';
  askConfirm('Remove account?',
    (isAdminAcct ? 'Removes admin access for ' : 'Deletes the account of ') + (u.name || u.email) +
    '. Their profile is removed immediately; they will no longer be able to sign in here.', () => {
      PDB.delDoc('users', uid)
        .then(() => toast((u.name || u.email) + ' was removed.', 'ok'))
        .catch((err) => toast('Could not remove account: ' + PDB.authMsg(err), 'error'));
    });
}

function openUserForm() {
  openModal('Create admin account', `
    <div class="form-grid">
      <div class="form-field full"><label>Full name</label><input id="uf-name" placeholder="Jane Admin"></div>
      <div class="form-field"><label>Email</label><input id="uf-email" type="email" placeholder="jane@puritylabs.org"></div>
      <div class="form-field"><label>Role</label><select id="uf-role">
        <option value="admin" selected>Admin</option>
        <option value="customer">Customer</option>
      </select></div>
      <div class="form-field full"><label>Password</label><input id="uf-pass" type="password" placeholder="Minimum 6 characters"></div>
    </div>
    <p class="hint" style="font-size:.78rem;color:var(--muted);">Creates a log-in account for the new administrator. Role applies immediately.</p>`,
    '<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" data-create-user><i class="fa-solid fa-user-plus"></i> Create account</button>');
  $('[data-create-user]').addEventListener('click', createUserAccount);
}

function createUserAccount() {
  const name = $('#uf-name').value.trim();
  const email = $('#uf-email').value.trim();
  const pass = $('#uf-pass').value;
  const role = $('#uf-role').value;
  if (!name || !email || !pass) { toast('Name, email and password are required.', 'error'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Enter a valid email address.', 'error'); return; }
  if (pass.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }
  restCreateAccount(email, pass)
    .then((uid) => PDB.setDoc('users', uid, { name: name, email: email, role: role, joined: PDB.ts() }))
    .then(() => { closeModal(); toast((name || email) + ' was created as ' + role + '.', 'ok'); })
    .catch((err) => toast((err && err.message) || 'Could not create account.', 'error'));
}

function restCreateAccount(email, password) {
  /* Firebase Identity Toolkit REST sign-up: creates the Auth account without
     swapping the admin's current client-side sign-in session. */
  return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(FIREBASE_CONFIG.apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password })
  }).then(r => r.json()).then(data => {
    if (!data || !data.localId) {
      const msg = (data && data.error && data.error.message) || 'account creation failed';
      const friendly = { 'EMAIL_EXISTS': 'That email is already registered.', 'INVALID_EMAIL': 'That email address is invalid.', 'WEAK_PASSWORD': 'That password is too weak.' }[msg] || msg;
      throw new Error(friendly);
    }
    return data.localId;
  });
}

/* ---------------- coupons ---------------- */
function renderCoupons() {
  $('#panel-coupons').innerHTML = `
    <div class="toolbar">
      <h3 style="color:var(--ink);font-size:1rem;">${DB.coupons.length} coupons</h3>
      <div class="spacer"></div>
      <button class="btn btn-primary" data-new-coupon><i class="fa-solid fa-plus"></i> New Coupon</button>
    </div>
    <div class="grid three">
      ${DB.coupons.map(cp => {
        const expired = new Date(cp.expires) < new Date();
        return `<div class="card">
          <div class="card-head">
            <div><h3 style="font-family:monospace;letter-spacing:1px;">${esc(cp.code)}</h3><p>${cp.type === 'percent' ? cp.value + '% off' : money(cp.value) + ' off'} · min ${money(cp.min)}</p></div>
            <span class="badge ${expired ? 'red' : cp.active ? 'ok' : 'muted'}">${expired ? 'expired' : cp.active ? 'active' : 'disabled'}</span>
          </div>
          <p style="font-size:.84rem;color:var(--muted);margin-bottom:14px;">Used ${cp.uses}/${cp.maxUses} · expires ${fmtDate(cp.expires)}</p>
          <div class="mini-progress"><span style="width:${Math.min(100, Math.round(cp.uses / Math.max(cp.maxUses,1) * 100))}%"></span></div>
          <div class="actions" style="margin-top:14px;">
            <button class="btn btn-ghost btn-sm" data-edit-coupon="${cp.id}"><i class="fa-solid fa-pen"></i> Edit</button>
            <button class="btn btn-ghost btn-sm" data-toggle-coupon="${cp.id}">${cp.active ? 'Disable' : 'Enable'}</button>
            <button class="icon-action danger" data-del-coupon="${cp.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  $$('[data-new-coupon]').forEach(b => b.addEventListener('click', () => couponForm()));
  $$('[data-edit-coupon]').forEach(b => b.addEventListener('click', () => couponForm(b.dataset.editCoupon)));
  $$('[data-toggle-coupon]').forEach(b => b.addEventListener('click', () => {
    const cp = byId('coupons', b.dataset.toggleCoupon); cp.active = !cp.active; persistAll(); renderCoupons();
    toast(cp.code + (cp.active ? ' enabled.' : ' disabled.'));
  }));
  $$('[data-del-coupon]').forEach(b => b.addEventListener('click', () => {
    const cp = byId('coupons', b.dataset.delCoupon);
    askConfirm('Delete coupon?', 'Delete ' + cp.code + '?', () => {
      DB.coupons = DB.coupons.filter(x => x.id !== cp.id); persistAll(); renderCoupons(); toast('Coupon deleted.');
    });
  }));
}

function couponForm(id) {
  const DEF = { code: '', type: 'percent', value: 10, min: 0, maxUses: 100, expires: daysAgo(-30), active: true, uses: 0 };
  let isNew = !id;
  let cp = isNew ? DEF : byId('coupons', id);
  if (cp == null) { cp = DEF; isNew = true; }
  openModal(isNew ? 'New Coupon' : 'Edit Coupon: ' + cp.code, `
    <div class="form-grid">
      <div class="form-field"><label>Code</label><input id="ko-code" value="${esc(cp.code)}"></div>
      <div class="form-field"><label>Type</label><select id="ko-type">
        <option value="percent" ${cp.type === 'percent' ? 'selected' : ''}>Percentage off</option>
        <option value="fixed" ${cp.type === 'fixed' ? 'selected' : ''}>Fixed amount</option>
      </select></div>
      <div class="form-field"><label>Value</label><input id="ko-value" type="number" step="0.01" value="${cp.value}"></div>
      <div class="form-field"><label>Min order ($)</label><input id="ko-min" type="number" step="0.01" value="${cp.min}"></div>
      <div class="form-field"><label>Max uses</label><input id="ko-max" type="number" value="${cp.maxUses}"></div>
      <div class="form-field"><label>Expires</label><input id="ko-exp" type="date" value="${new Date(cp.expires).toISOString().slice(0, 10)}"></div>
    </div>`,
    '<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" data-save-coupon>Save</button>');
  $('#modalFoot [data-save-coupon]').addEventListener('click', () => {
    const code = $('#ko-code').value.trim().toUpperCase();
    if (!code) { toast('Code required.', 'error'); return; }
    const rec = { code, type: $('#ko-type').value, value: +$('#ko-value').value || 0, min: +$('#ko-min').value || 0, maxUses: +$('#ko-max').value || 100, expires: new Date($('#ko-exp').value + 'T23:59:59').toISOString(), active: cp.active !== undefined ? cp.active : true, uses: cp.uses || 0 };
    if (isNew) DB.coupons.push(Object.assign({ id: uid() }, rec));
    else Object.assign(cp, rec);
    persistAll(); closeModal(); renderCoupons(); toast('Coupon saved.');
  });
}

/* ---------------- newsletter ---------------- */
function renderNewsletter() {
  const subs = (DB.news || []).slice().sort((a, b) => new Date(b.joined || 0) - new Date(a.joined || 0));
  $('#panel-newsletter').innerHTML = `
    <div class="toolbar">
      <h3 style="color:var(--ink);font-size:1rem;">${subs.length} subscriber${subs.length === 1 ? '' : 's'}</h3>
      <div class="spacer"></div>
      <button class="btn btn-ghost" id="nl-export"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Email</th><th>Source</th><th>Joined</th><th style="width:60px;"></th></tr></thead>
          <tbody>
            ${subs.map(s => `
              <tr>
                <td><b>${esc(s.email)}</b></td>
                <td><span class="badge ${s.source === 'footer' ? 'blue' : 'ok'}">${esc(s.source || 'form')}</span></td>
                <td>${fmtDate(s.joined)}</td>
                <td><button class="icon-action danger" data-del-sub="${s.id}"><i class="fa-solid fa-trash"></i></button></td>
              </tr>`).join('') || '<tr><td colspan="4"><div class="empty" style="border:0;"><i class="fa-solid fa-envelope-open-text"></i><p>No subscribers yet.</p></div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  $$('[data-del-sub]').forEach(b => b.addEventListener('click', () => {
    const s = byId('news', b.dataset.delSub);
    askConfirm('Remove subscriber?', 'Remove ' + s.email + ' from the newsletter?', () => {
      DB.news = DB.news.filter(x => x.id !== s.id);
      if (s.id && s.id !== s.email && PDB.delDoc) PDB.delDoc('newsletter', s.id).catch(() => {});
      persistAll(); renderNewsletter(); toast('Subscriber removed.');
    });
  }));
  $('#nl-export').addEventListener('click', () => {
    const rows = [['email', 'source', 'joined']].concat(subs.map(s => [s.email, s.source || 'form', s.joined || '']));
    const csv = rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'newsletter-subscribers.csv';
    a.click();
    toast('CSV exported.');
  });
}

/* ---------------- content ---------------- */
function renderContent() {
  const c = DB.content;
  $('#panel-content').innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;">
      <button class="btn ${view === 'storefront' ? 'btn-primary' : 'btn-ghost'}" data-cv="storefront">Storefront</button>
      <button class="btn ${view === 'pages' ? 'btn-primary' : 'btn-ghost'}" data-cv="pages">Standalone pages</button>
      <button class="btn ${view === 'blocks' ? 'btn-primary' : 'btn-ghost'}" data-cv="blocks">Trust & edit blocks</button>
    </div>
    <div id="contentView">${contentViewHTML(view)}</div>`;
  $$('[data-cv]').forEach(b => b.addEventListener('click', () => { view = b.dataset.cv; renderContent(); }));
  bindContent(view);
}

let view = 'storefront';

function contentViewHTML(v) {
  const c = DB.content;
  if (v === 'storefront') {
    return `
      <div class="card" style="margin-bottom:18px;">
        <div class="card-head"><div><h3>Hero section</h3><p>Landing banner of index.html</p></div></div>
        <div class="form-grid">
          <div class="form-field"><label>Site name</label><input id="ct-sitename" value="${esc(c.siteName)}"></div>
          <div class="form-field"><label>Tagline</label><input id="ct-tagline" value="${esc(c.tagline)}"></div>
          <div class="form-field full"><label>Hero title</label><input id="ct-herotitle" value="${esc(c.heroTitle)}"></div>
          <div class="form-field full"><label>Hero subtitle</label><textarea id="ct-herosub">${esc(c.heroSubtitle)}</textarea></div>
          <div class="form-field"><label>Hero button label</label><input id="ct-herobtn" value="${esc(c.heroBtn)}"></div>
          <div class="form-field"><label>Hero button URL</label><input id="ct-herourl" value="${esc(c.heroUrl)}"></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:18px;">
        <div class="card-head"><div><h3>Top bar</h3><p>Promo strip above the header</p></div></div>
        <div class="form-field full"><label>Message</label><input id="ct-topbar" value="${esc(c.topbar)}"></div>
      </div>
      <div class="card" style="margin-bottom:18px;">
        <div class="card-head"><div><h3>Announcement bar</h3><p>Shown on the top bar of the live store</p></div></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input id="ct-ann-label" value="${esc(c.announcementLabel)}" style="max-width:110px;" placeholder="Label (NEW)">
          <input id="ct-ann-text" value="${esc(c.announcement)}" style="flex:1;min-width:200px;" placeholder="Announcement text">
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" data-save-content>Save storefront content</button>
        <button class="btn btn-ghost" data-cancel-content>Discard edits</button>
      </div>`;
  }
  if (v === 'pages') {
    return `
      <div class="card" style="margin-bottom:18px;">
        <div class="card-head"><div><h3>Store pages</h3><p>Static pages on the storefront</p></div></div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Page</th><th>File</th><th>Status</th><th style="text-align:right;">Action</th></tr></thead>
            <tbody>
              ${[['Home','index.html','published'],['All Peptides','pages/all-peptides.html','published'],['Nasal Sprays','pages/nasal-sprays.html','published'],['Pills','pages/pills.html','published'],['Cart','cart.html','published'],['Checkout','checkout.html','published'],['Sitemap','sitemap.xml','published']].map(([n,f,s]) => `
                <tr><td><b style="color:var(--ink);">${n}</b></td><td><code style="font-size:.8rem;">${f}</code></td><td><span class="badge ok">${s}</span></td>
                <td><div class="actions"><a class="icon-action" target="_blank" href="${f}"><i class="fa-solid fa-eye"></i></a></div></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>New custom page</h3><p>Creates a simple HTML page under /pages</p></div></div>
        <div class="form-grid">
          <div class="form-field"><label>Page title</label><input id="pg-title" placeholder="e.g. Lab Results"></div>
          <div class="form-field"><label>Slug</label><input id="pg-slug" placeholder="lab-results"></div>
          <div class="form-field full"><label>HTML body (paste your markup)</label><textarea id="pg-body" placeholder="<h1>Lab Results</h1>..."></textarea></div>
        </div>
      </div>`;
  }
  return `
    <div class="grid two">
      <div class="card">
        <div class="card-head"><div><h3>Trust badges</h3><p>Shown on product pages</p></div></div>
        ${['1', '2', '3', '4'].map(i => `
          <div style="border-bottom:1px solid var(--line);padding:10px 0;">
            <div class="form-grid">
              <div class="form-field"><label>Badge ${i} title</label><input data-trust="${i}-t" value="${esc(c['trust' + i])}"></div>
              <div class="form-field"><label>Badge ${i} subtitle</label><input data-trust="${i}-s" value="${esc(c['trust' + i + 'S'])}"></div>
            </div>
          </div>`).join('')}
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Footer</h3><p>Footer about text + contact info</p></div></div>
        <div class="form-grid">
          <div class="form-field full"><label>Footer about</label><textarea id="ct-footabout">${esc(c.footerAbout)}</textarea></div>
          <div class="form-field"><label>Contact email</label><input id="ct-email" value="${esc(c.contactEmail)}"></div>
          <div class="form-field"><label>Phone</label><input id="ct-phone" value="${esc(c.contactPhone)}"></div>
          <div class="form-field full"><label>Address</label><input id="ct-address" value="${esc(c.contactAddress)}"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Policy text</h3></div></div>
        <div class="form-field" style="margin-bottom:12px;"><label>Returns policy</label><textarea id="ct-returns">${esc(DB.settings.returnsPolicy)}</textarea></div>
        <div class="form-field"><label>Terms note</label><textarea id="ct-terms">${esc(DB.settings.terms)}</textarea></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Status</h3></div></div>
        <p style="font-size:.88rem;color:var(--muted);margin-bottom:14px;">Changes are saved live to Firestore the moment you edit.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary" data-save-content>Save storefront blocks</button>
          <button class="btn btn-ghost" data-reset-content>Reset to defaults</button>
        </div>
      </div>
    </div>`;
}

let rawCv = null;
function bindContent(v) {
  const c = DB.content;

  function saveStorefront() {
    c.siteName = $('#ct-sitename').value; c.tagline = $('#ct-tagline').value;
    c.heroTitle = $('#ct-herotitle').value; c.heroSubtitle = $('#ct-herosub').value;
    c.heroBtn = $('#ct-herobtn').value; c.heroUrl = $('#ct-herourl').value; c.topbar = $('#ct-topbar').value;
    c.announcement = $('#ct-ann-text').value; c.announcementLabel = $('#ct-ann-label').value;
    persistAll(); toast('Storefront content updated.');
  }

  if (v === 'storefront') {
    const btn = $('#contentView [data-save-content]');
    if (btn) btn.addEventListener('click', saveStorefront);
    const cancel = $('#contentView [data-cancel-content]');
    if (cancel) cancel.addEventListener('click', () => { rawCv = 'storefront'; renderContent(); });
  }

  if (v === 'blocks') {
    $$('[data-trust]').forEach(inp => inp.addEventListener('change', () => {
      const [i, k] = inp.dataset.trust.split('-');
      c[k === 't' ? 'trust' + i : 'trust' + i + 'S'] = inp.value;
      persistAll();
    }));
    const saveAll = () => {
      c.footerAbout = $('#ct-footabout').value;
      c.contactEmail = $('#ct-email').value;
      c.contactPhone = $('#ct-phone').value;
      c.contactAddress = $('#ct-address').value;
      DB.settings.returnsPolicy = $('#ct-returns').value;
      DB.settings.terms = $('#ct-terms').value;
      persistAll(); toast('Blocks saved.');
    };
    $('#contentView [data-save-content]')?.addEventListener('click', saveAll);
    $('#contentView [data-reset-content]')?.addEventListener('click', () => {
      const dflt = catalogData();
      DB.content = Object.assign({}, DB.content, dflt.content);
      DB.settings.returnsPolicy = dflt.settings.returnsPolicy;
      DB.settings.terms = dflt.settings.terms;
      persistAll(); renderContent(); toast('Content reset to defaults.');
    });
  }
}

/* ---------------- navigation ---------------- */
function renderNavigation() {
  $('#panel-navigation').innerHTML = `
    <div class="toolbar">
      <h3 style="color:var(--ink);font-size:1rem;">Menu links</h3><p style="font-size:.82rem;color:var(--muted);">Header navigation on index.html</p>
      <div class="spacer"></div>
      <button class="btn btn-primary" data-new-nav><i class="fa-solid fa-plus"></i> Add Link</button>
    </div>
    <div class="page-tree">
      ${DB.nav.slice().sort((a, b) => a.pos - b.pos).map(n => `
        <div class="page-tree-item" data-navitem="${n.id}">
          <span class="drag" draggable="true"><i class="fa-solid fa-grip-vertical"></i></span>
          <span class="link"><i class="fa-solid fa-link" style="color:var(--muted);margin-right:8px;"></i>${esc(n.label)}</span>
          <span class="chip">${esc(n.url)}</span>
          <div class="actions">
            <button class="icon-action" data-edit-nav="${n.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-action danger" data-del-nav="${n.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>`).join('')}
    </div>
    <p style="font-size:.78rem;color:var(--muted);margin-top:12px;">Drag handle: <i class="fa-solid fa-grip-vertical"></i> to reorder. These map to nav.links on the live site.</p>`;
  let drag = null;
  const tree = $('.page-tree');
  $$('[draggable="true"]').forEach(h => {
    h.addEventListener('dragstart', (e) => { drag = h.closest('.page-tree-item'); });
    h.addEventListener('dragover', (e) => { e.preventDefault(); const t = e.target.closest('.page-tree-item'); if (t && t !== drag) tree.insertBefore(drag, t.nextSibling); });
  });
  $$('[data-new-nav]').forEach(b => b.addEventListener('click', () => navForm()));
  $$('[data-edit-nav]').forEach(b => b.addEventListener('click', () => navForm(b.dataset.editNav)));
  $$('[data-del-nav]').forEach(b => b.addEventListener('click', () => {
    const n = byId('nav', b.dataset.delNav);
    askConfirm('Remove link?', 'Remove "' + n.label + '"?', () => {
      DB.nav = DB.nav.filter(x => x.id !== n.id); persistAll(); renderNavigation(); toast('Link removed.');
    });
  }));
}

function navForm(id) {
  const isNew = !id;
  const n = isNew ? { label: '', url: '', pos: DB.nav.length } : byId('nav', id);
  openModal(isNew ? 'Add Link' : 'Edit Link', `
    <div class="form-grid">
      <div class="form-field"><label>Label</label><input id="nv-label" value="${esc(n.label)}"></div>
      <div class="form-field"><label>URL</label><input id="nv-url" value="${esc(n.url)}" placeholder="index.html#products"></div>
    </div>`,
    '<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" data-save-nav>Save</button>');
  $('#modalFoot [data-save-nav]').addEventListener('click', () => {
    const label = $('#nv-label').value.trim();
    if (!label) { toast('Label required.', 'error'); return; }
    if (isNew) DB.nav.push({ id: uid(), label, url: $('#nv-url').value.trim() || '#', pos: DB.nav.length });
    else { n.label = label; n.url = $('#nv-url').value.trim() || '#'; }
    persistAll(); closeModal(); renderNavigation(); toast('Navigation updated.');
  });
}

/* ---------------- media ---------------- */
function renderMedia() {
  $('#panel-media').innerHTML = `
    <div class="toolbar">
      <h3 style="color:var(--ink);font-size:1rem;">${DB.media.length} files · ${plural(DB.products.length, 'product referencing them', 'products referencing them')}</h3>
      <div class="spacer"></div>
      <input type="search" placeholder="Filter by name..." id="mediaSearch" style="max-width:200px;">
      <button class="btn btn-primary" id="mediaUpload"><i class="fa-solid fa-upload"></i> Upload</button>
      <input type="file" id="mediaFile" accept="image/*" multiple style="display:none;">
    </div>
    <div class="media-grid" id="mediaGrid">
      ${DB.media.map(m => `
        <div class="media-item" data-media="${m.id}">
          <div class="media-thumb"><img src="${esc(m.src)}" alt="" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect fill=%22%23E8F3E9%22 width=%22100%22 height=%22100%22/%3E%3Crect width=%2260%22 height=%2260%22 x=%2220%22 y=%2220%22 fill=%22%232E7D32%22/%3E%3C/svg%3E'"></div>
          <div class="media-meta"><b>${esc(m.name)}</b><span>${m.uploadedBy}</span></div>
          <div class="media-actions">
            <button class="icon-action" data-copy-media="${m.id}" title="Copy path"><i class="fa-solid fa-copy"></i></button>
            <button class="icon-action" data-open-media="${m.id}" title="Open"><i class="fa-solid fa-eye"></i></button>
            <button class="icon-action danger" data-del-media="${m.id}" title="Remove"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>`).join('')}
    </div>`;
  $('#mediaFile').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    let done = 0;
    files.forEach(f => {
      cloudinaryUpload(f)
        .then(url => {
          DB.media.push({ id: uid(), name: f.name, src: url, size: f.size, uploadedBy: 'you' });
        })
        .catch(() => toast('Upload failed: ' + f.name, 'error'))
        .then(() => { done++; if (done === files.length) { persistAll(); renderMedia(); toast('Uploaded ' + files.length + ' file' + (files.length > 1 ? 's' : '')); } });
    });
  });
  $('#mediaUpload').addEventListener('click', () => $('#mediaFile').click());
  $('#mediaSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $$('#mediaGrid .media-item').forEach(el => el.style.display = el.dataset.media && (el.textContent.toLowerCase().includes(q) ? '' : 'none'));
  });
  $$('[data-copy-media]').forEach(b => b.addEventListener('click', () => {
    const m = byId('media', b.dataset.copyMedia);
    const text = (m.src.startsWith('data:') ? m.name : m.src);
    copyText(text);
    toast('Copied ' + text);
  }));
  $$('[data-open-media]').forEach(b => b.addEventListener('click', () => {
    const m = byId('media', b.dataset.openMedia);
    if (m) window.open(m.src, '_blank');
  }));
  $$('[data-del-media]').forEach(b => b.addEventListener('click', () => {
    const m = byId('media', b.dataset.delMedia);
    askConfirm('Remove media?', 'Remove "' + m.name + '" from the library?', () => {
      DB.media = DB.media.filter(x => x.id !== m.id); persistAll(); renderMedia(); toast('Media removed.');
    });
  }));
}
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).catch(() => {}); return; }
  const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
}

/* ---------------- analytics ---------------- */
function renderAnalytics() {
  const v = DB.visits;
  const totalVisits = v.reduce((s, d) => s + d.visits, 0);
  const last7 = v.slice(-7).reduce((s, d) => s + d.visits, 0);
  const prev7 = v.slice(-14, -7).reduce((s, d) => s + d.visits, 0);
  const conv = v.reduce((s, d) => s + d.orders, 0) / Math.max(totalVisits, 1);
  const top = topProducts();
  $('#panel-analytics').innerHTML = `
    <div class="grid stat-grid" style="margin-bottom:18px;">
      ${[
        ['Visitors (30d)', totalVisits, last7 + ' in last 7 days', 'fa-users', 'blue'],
        ['Order conversion', (conv * 100).toFixed(1) + '%', 'vs ' + prev7 + ' visits prev', 'fa-percent', 'green'],
        ['Avg order value', money(avgOrder()), 'from ' + DB.orders.length + ' orders', 'fa-cart-shopping', 'amber'],
        ['Refund / cancel rate', refundRate() + '%', 'quality signal', 'fa-rotate-left', 'red']
      ].map(s => `<div class="stat-card"><div class="stat-icon ${s[4]}"><i class="fa-solid ${s[3]}"></i></div><div class="stat-info"><b>${s[1]}</b><span>${s[0]}</span><span class="trend up">${s[2]}</span></div></div>`).join('')}
    </div>
    <div class="grid two">
      <div class="card">
        <div class="card-head"><div><h3>Visitors — last 30 days</h3><p>Store traffic events</p></div></div>
        ${chartHTML(v, 'V')}
        <div class="chart-legend"><span><i style="background:#2E7D32;"></i>Daily visits</span></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Top products</h3><p>By sold qty</p></div></div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead>
            <tbody>${top.map(t => `<tr><td><div class="td-prod"><img src="${esc(t.image)}" onerror="this.style.visibility='hidden'"><b>${esc(t.name)}</b></div></td><td><span class="badge ok">${t.qty}</span></td><td><b style="color:var(--ink);">${money(t.rev)}</b></td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="grid two" style="margin-top:18px;">
      <div class="card">
        <div class="card-head"><div><h3>Orders by status</h3></div></div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Status</th><th>Count</th><th>Value</th></tr></thead>
            <tbody>${['pending', 'processing', 'shipped', 'completed', 'refunded', 'cancelled'].map(s => {
              const list = DB.orders.filter(o => o.status === s);
              return `<tr><td><span class="badge ${statusCls(s)}">${s}</span></td><td>${list.length}</td><td><b style="color:var(--ink);">${money(list.reduce((x, o) => x + o.total, 0))}</b></td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Stock health</h3></div></div>
        ${catHealthHTML()}
        <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px;">
          <div style="display:flex;justify-content:space-between;font-size:.85rem;"><span style="color:var(--muted);">Low stock (&le;${DB.settings.lowStockAlert})</span><b style="color:var(--warn);">${DB.products.filter(p => p.stock <= DB.settings.lowStockAlert).length}</b></div>
          <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-top:6px;"><span style="color:var(--muted);">Out of stock</span><b style="color:var(--danger);">${DB.products.filter(p => p.stock === 0).length}</b></div>
        </div>
      </div>
    </div>`;
}

function avgOrder() {
  const paid = DB.orders.filter(o => o.status !== 'cancelled' && o.status !== 'refunded');
  return paid.reduce((s, o) => s + o.total, 0) / Math.max(paid.length, 1);
}
function refundRate() {
  const total = DB.orders.length;
  const bad = DB.orders.filter(o => o.status === 'refunded' || o.status === 'cancelled').length;
  return ((bad / Math.max(total, 1)) * 100).toFixed(1);
}
function topProducts() {
  const map = {};
  DB.orders.forEach(o => o.items.forEach(i => { map[i.name] = map[i.name] || { qty: 0, rev: 0 }; map[i.name].qty += i.qty; map[i.name].rev += i.price * i.qty; }));
  return Object.keys(map).map(k => {
    const p = DB.products.find(x => x.name === k);
    return { name: k, qty: map[k].qty, rev: map[k].rev, image: p ? p.image : 'images/' };
  }).sort((a, b) => b.qty - a.qty).slice(0, 6);
}

/* ---------------- settings ---------------- */
function renderSettings() {
  const s = DB.settings;
  $('#panel-settings').innerHTML = `
<div class="tabs">
      <button class="tab-btn active" data-stab="general">General</button>
      <button class="tab-btn" data-stab="emails">Emails</button>
      <button class="tab-btn" data-stab="contact">Contact</button>
      <button class="tab-btn" data-stab="shipping">Shipping &amp; tax</button>
      <button class="tab-btn" data-stab="source">Source of truth</button>
      <button class="tab-btn" data-stab="backup">Backup &amp; Restore</button>
      <button class="tab-btn" data-stab="security">Security</button>
    </div>
    <div id="settingsView">${settingsHTML('general', s)}</div>`;
  $$('[data-stab]').forEach(b => b.addEventListener('click', () => {
    $$('[data-stab]').forEach(x => x.classList.toggle('active', x === b));
    $('#settingsView').innerHTML = settingsHTML(b.dataset.stab, s);
    bindSettings(b.dataset.stab, s);
  }));
  bindSettings('general', s);
}

function settingsHTML(tab, s) {
  if (tab === 'general') {
    return `
      <div class="card" style="max-width:720px;">
        <div class="card-head"><div><h3>Store settings</h3><p>Identity and defaults</p></div></div>
        <div class="form-grid">
          <div class="form-field"><label>Currency symbol</label><input id="st-currency" value="${esc(s.currency)}"></div>
          <div class="form-field"><label>Email from</label><input id="st-email" value="${esc(s.emailFrom)}"></div>
          <div class="form-field"><label>Orders per page</label><input id="st-opp" type="number" value="${s.ordersPerPage}"></div>
          <div class="form-field"><label>Low-stock threshold</label><input id="st-low" type="number" value="${s.lowStockAlert}"></div>
        </div>
        <div style="margin-top:8px;"><button class="btn btn-primary" data-save-general>Save general</button></div>
      </div>`;
  }
  if (tab === 'emails') {
    return `
      <div class="card" style="max-width:720px;">
        <div class="card-head"><div><h3>Email notifications</h3><p>For order confirmations, receipts and admin alerts via Resend</p></div></div>
        <div class="form-grid">
          <div class="form-field"><label>Admin notification email(s)</label><input id="st-adminmail" value="${esc(s.adminNotifyEmails)}" placeholder="you@gmail.com, backoffice@company.com"></div>
        </div>
        <p style="font-size:.8rem;color:var(--muted);margin:-4px 0 14px;">Comma-separated. Every store order triggers a new-order alert to these address(es).</p>
        <div class="form-grid">
          <div class="form-field"><label>Store location (email footer)</label><textarea id="st-address" rows="2" placeholder="Purity Labs, 123 Research Way, Los Angeles, CA 90210">${esc(s.storeAddress)}</textarea></div>
          <div class="form-field"><label>Support / contact email</label><input id="st-supportmail" value="${esc(s.contactEmail)}" placeholder="info@puritylabs.org"></div>
          <div class="form-field" style="grid-column:1 / -1;"><label>Email footer note</label><textarea id="st-footernote" rows="2" placeholder="For in-vitro research and laboratory use only. Not for human consumption.">${esc(s.emailFooterNote)}</textarea></div>
        </div>
        <div style="margin-top:8px;"><button class="btn btn-primary" data-save-emails><i class="fa-solid fa-envelope"></i> Save email settings</button></div>
      </div>`;
  }
  if (tab === 'contact') {
    return `
      <div class="card" style="max-width:720px;">
        <div class="card-head"><div><h3>Contact section</h3><p>Shown on the Contact &amp; Order Tracking page</p></div></div>
        <div class="form-grid">
          <div class="form-field"><label>WhatsApp number</label><input id="st-whatsapp" value="${esc(s.whatsapp)}" placeholder="15551234567"></div>
          <div class="form-field"><label>Support / contact email</label><input id="st-contactmail" value="${esc(s.contactEmail)}" placeholder="info@puritylabs.org"></div>
        </div>
        <p style="font-size:.8rem;color:var(--muted);margin:-4px 0 14px;">The WhatsApp button opens wa.me with this number (digits only are fine) and the email button opens this address. Also used as the order emails footer contact.</p>
        <div style="margin-top:8px;"><button class="btn btn-primary" data-save-contact><i class="fa-solid fa-cloud-arrow-up"></i> Save contact settings</button></div>
      </div>`;
  }
  if (tab === 'shipping') {
    return `
      <div class="card" style="max-width:720px;">
        <div class="card-head"><div><h3>Shipping &amp; tax</h3><p>Used by checkout totals</p></div></div>
        <div class="form-grid">
          <div class="form-field"><label>Free-shipping threshold ($)</label><input id="st-shipthr" type="number" step="0.01" value="${s.freeShipThreshold}"></div>
          <div class="form-field"><label>Flat rate ($)</label><input id="st-shiprate" type="number" step="0.01" value="${s.flatRate}"></div>
          <div class="form-field"><label>Tax rate (%)</label><input id="st-tax" type="number" step="0.01" value="${s.taxRate}"></div>
        </div>
        <div style="margin-top:8px;"><button class="btn btn-primary" data-save-ship>Save shipping</button></div>
      </div>
      <p style="font-size:.8rem;color:var(--muted);margin-top:12px;max-width:720px;"><i class="fa-solid fa-circle-info"></i> The storefront computes shipping in script.js — these values are the source defaults used by admin calculations.</p>`;
  }
  if (tab === 'source') {
    return `
      <div class="card" style="max-width:760px;">
        <div class="card-head"><div><h3>Single source of truth — Firestore</h3><p>Every edit here is live on the storefront instantly</p></div></div>
        <p style="font-size:.9rem;color:var(--muted);margin-bottom:18px;line-height:1.6;">
          The dashboard, the shop grid and every product page are driven by <b>Firestore</b>.
          Edits you make here are pushed to the cloud and the storefront re-renders in real time.
          There is no offline seed file — <code>data/data.json</code>, <code>catalog.js</code> and
          <code>build.js</code> were removed. Firestore is the only data source.
          Transactions, coupons and newsletter subscribers are Firestore-only.
        </p>
        <div class="card" style="border:1px dashed var(--line);">
          <h4 style="margin-bottom:8px;">Publish catalog</h4>
          <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px;">Writes the product catalog (products, categories, navigation, content, settings) to Firestore. Orders, coupons and visits are never touched.</p>
          <button class="btn btn-primary" data-sync-now><i class="fa-solid fa-cloud-arrow-up"></i> Publish catalog to Firestore</button>
        </div>
      </div>`;
  }
  if (tab === 'backup') {
    return `
      <div class="card" style="max-width:760px;">
        <div class="card-head"><div><h3>Full database backup</h3><p>Export every Firestore collection to a JSON file</p></div></div>
        <p style="font-size:.9rem;color:var(--muted);margin-bottom:18px;line-height:1.6;">
          Downloads a complete snapshot of your database — products, categories, orders,
          coupons, navigation, media, users, visits, newsletter, content and settings.
          Save this file somewhere safe. You can use it to restore your store after data loss or to
          migrate to a new project.
        </p>
        <button class="btn btn-primary" data-export-backup><i class="fa-solid fa-download"></i> Download full backup</button>
      </div>
      <div class="card" style="max-width:760px;margin-top:18px;">
        <div class="card-head"><div><h3>Restore from backup</h3><p>Import a previously downloaded backup JSON file</p></div></div>
        <p style="font-size:.9rem;color:var(--muted);margin-bottom:18px;line-height:1.6;">
          Upload a backup JSON file to restore your database. This will <b>overwrite</b> existing
          documents in each collection with the data from the backup. Existing documents not present
          in the backup are <b>not deleted</b> — only matching documents are updated or created.
        </p>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <label for="restoreFileInput" class="btn btn-primary" style="cursor:pointer;margin:0;"><i class="fa-solid fa-upload"></i> Choose backup file</label>
          <input type="file" id="restoreFileInput" accept=".json" style="display:none;">
          <span id="restoreFileName" style="font-size:.85rem;color:var(--muted);"></span>
        </div>
        <div id="restorePreview" style="margin-top:14px;display:none;"></div>
        <div style="margin-top:14px;">
          <button class="btn btn-danger" id="restoreBtn" disabled><i class="fa-solid fa-rotate-left"></i> Restore from backup</button>
        </div>
      </div>`;
  }
  return `
    <div class="card" style="max-width:720px;">
      <div class="card-head"><div><h3>Admin account</h3><p>Signed in via Firebase</p></div></div>
      <p style="font-size:.9rem;color:var(--muted);line-height:1.6;">
        Access is controlled by your Firebase account with the <b>users/{uid}.role = "admin"</b> flag.
        Use the storefront account page or this sidebar's Logout to sign out. Password resets go through Firebase email reset.
      </p>
</div>
    <div class="card" style="max-width:720px;margin-top:18px;">
        <div class="card-head"><div><h3>Danger zone</h3></div></div>
      <p style="font-size:.86rem;color:var(--muted);margin-bottom:14px;">Deletes all transactional data (orders, coupons, visits, media and newsletter subscribers) from Firestore. Products, categories, navigation, content and settings are <b>never</b> removed.</p>
      <button class="btn btn-danger" data-reset-all><i class="fa-solid fa-triangle-exclamation"></i> Clear transactional data</button>
    </div>`;
}

function bindSettings(tab, s) {
  if (tab === 'general') {
    $('#settingsView [data-save-general]')?.addEventListener('click', () => {
      s.currency = $('#st-currency').value; s.emailFrom = $('#st-email').value;
      s.ordersPerPage = +$('#st-opp').value || 10; s.lowStockAlert = +$('#st-low').value || 10;
      persistAll(); toast('General settings saved.');
    });
  } else if (tab === 'emails') {
    $('#settingsView [data-save-emails]')?.addEventListener('click', () => {
      s.adminNotifyEmails = $('#st-adminmail').value.trim();
      s.storeAddress = $('#st-address').value.trim();
      s.contactEmail = $('#st-supportmail').value.trim();
      s.emailFooterNote = $('#st-footernote').value.trim();
      persistAll(); toast('Email settings saved.');
    });
  } else if (tab === 'contact') {
    $('#settingsView [data-save-contact]')?.addEventListener('click', () => {
      s.whatsapp = $('#st-whatsapp').value.trim();
      s.contactEmail = $('#st-contactmail').value.trim();
      persistAll(); toast('Contact settings saved.');
    });
  } else if (tab === 'shipping') {
    $('#settingsView [data-save-ship]')?.addEventListener('click', () => {
      s.freeShipThreshold = +$('#st-shipthr').value || 0; s.flatRate = +$('#st-shiprate').value || 0; s.taxRate = +$('#st-tax').value || 0;
      persistAll(); toast('Shipping & tax saved.');
    });
  } else if (tab === 'source') {
    $('#settingsView [data-sync-now]')?.addEventListener('click', publishCatalog);
  } else if (tab === 'backup') {
    $('#settingsView [data-export-backup]')?.addEventListener('click', exportBackup);

    const fileInput = $('#restoreFileInput');
    const restoreBtn = $('#restoreBtn');
    const preview = $('#restorePreview');
    let pendingRestore = null;

    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      $('#restoreFileName').textContent = f.name;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          pendingRestore = JSON.parse(reader.result);
          if (!pendingRestore || typeof pendingRestore !== 'object') throw new Error('bad shape');
          const cols = Object.keys(pendingRestore);
          preview.style.display = 'block';
          preview.innerHTML = '<div style="font-size:.85rem;color:var(--muted);line-height:1.8;">Backup file found <b>' + esc(cols.length) + '</b> collection(s): ' +
            cols.map(c => `<span class="badge">${esc(c)}</span>`).join(' ') + '</div>';
          restoreBtn.disabled = false;
        } catch (e) {
          pendingRestore = null;
          preview.style.display = 'block';
          preview.innerHTML = '<div style="color:var(--danger);font-size:.85rem;"><i class="fa-solid fa-triangle-exclamation"></i> That file is not a valid backup JSON.</div>';
          restoreBtn.disabled = true;
        }
      };
      reader.readAsText(f);
    });

    restoreBtn.addEventListener('click', () => {
      if (!pendingRestore) return;
      askConfirm('Restore database?', 'This will overwrite matching documents in Firestore with the data from the backup file. Continue?', () => {
        restoreBackup(pendingRestore);
        pendingRestore = null;
        restoreBtn.disabled = true;
        fileInput.value = '';
        $('#restoreFileName').textContent = '';
      });
    });
  } else {
    $('#settingsView [data-reset-all]')?.addEventListener('click', () => {
      askConfirm('Clear transactional data?', 'Orders, tracking, coupons, visits, media and newsletter subscribers are deleted from Firestore. Products, categories, navigation, content and settings are kept untouched.', () => {
        wipeCols(['orders', 'tracking', 'coupons', 'visits', 'media', 'newsletter']);
        toast('Transactional data cleared — catalog untouched.');
      });
    });
  }
}

/* Delete every document we currently know about in the given Firestore
   collections (tracked in fsKeys by the realtime watchers). Products and the
   catalog are intentionally excluded. */
function wipeCols(cols) {
  if (!PDB.ready) return;
  Promise.all(cols.map(col => {
    const ids = Object.keys(fsKeys[col] || {});
    if (!ids.length) return Promise.resolve();
    return Promise.all(ids.map(id => PDB.delDoc(col, String(id)).catch(() => {})));
  })).then(() => {
    cols.forEach(col => { fsKeys[col] = {}; });
  });
}

/* ---------------- backup & restore ---------------- */
const BACKUP_COLS = ['products', 'categories', 'orders', 'tracking', 'coupons', 'nav', 'media', 'users', 'visits', 'newsletter', 'content', 'settings'];

function exportBackup() {
  if (!PDB.ready || !PDB.db) { toast('Firestore is not connected yet — try again in a moment.', 'error'); return; }
  const btn = $('[data-export-backup]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Building backup…'; }
  /* Read every collection individually so one denied collection can't sink
     the whole export — failed collections are reported, the rest are saved. */
  Promise.all(BACKUP_COLS.map(col =>
    PDB.getCol(col)
      .then(list => ({ col, list, error: null }))
      .catch(err => ({ col, list: [], error: err && err.message ? err.message : err }))
  )).then(results => {
      const dump = {};
      const failed = [];
      results.forEach(r => {
        if (r.error) { failed.push(r.col); return; }
        dump[r.col] = r.list.map(doc => Object.assign({ __id: doc.id }, doc));
      });
      const payload = { version: 1, exportedAt: new Date().toISOString(), collections: dump };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'puritylabs-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      const total = BACKUP_COLS.reduce((n, c) => n + (dump[c] ? dump[c].length : 0), 0);
      const msg = 'Backup downloaded — ' + total + ' documents across ' + Object.keys(dump).length + ' collections.'
        + (failed.length ? ' Skipped: ' + failed.join(', ') + '.' : '');
      toast(msg, failed.length ? 'warn' : undefined);
    })
    .finally(() => {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-download"></i> Download full backup'; }
    });
}

function restoreBackup(backup) {
  if (!PDB.ready || !PDB.db) { toast('Firestore is not connected yet — try again in a moment.', 'error'); return; }
  const cols = (backup && backup.collections) ? backup.collections : backup;
  if (!cols || typeof cols !== 'object') { toast('Invalid backup file.', 'error'); return true; }
  const tasks = [];
  const colNames = Object.keys(cols);
  colNames.forEach(col => {
    const docs = Array.isArray(cols[col]) ? cols[col] : [];
    docs.forEach(doc => {
      const id = doc && doc.__id;
      if (!id || !PDB.db.collection(col).doc(id)) return;
      const data = Object.assign({}, doc);
      delete data.__id;
      tasks.push(PDB.setDoc(col, id, data, { merge: true }).catch(() => {}));
    });
  });
  toast('Restoring ' + tasks.length + ' documents…');
  Promise.all(tasks).then(() => {
    refreshAdminPanel();
    toast('Database restored from backup — ' + tasks.length + ' documents written.');
  }).catch(err => toast('Restore failed: ' + esc(err && err.message ? err.message : err), 'error'));
  return true;
}

/* ---------------- global search + notifications ---------------- */
function initGlobal() {
  $('#globalSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (!q) return;
    const ql = q.toLowerCase();
    const prods = DB.products.filter(p => (p.name + ' ' + p.sku).toLowerCase().includes(ql)).slice(0, 4);
    const ords = DB.orders.filter(o => o.id.toLowerCase().includes(ql)).slice(0, 3);
    drawQuickSearch(q, prods, ords);
  });
}

function drawQuickSearch(q, prods, ords) {
  const old = $('#qsResults'); if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'qsResults';
  wrap.style.cssText = 'position:absolute;top:calc(100% + 8px);left:0;right:0;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.12);z-index:300;overflow:hidden;';
  let html = '';
  if (prods.length) {
    html += '<div style="padding:8px 14px 4px;font-size:.7rem;color:var(--muted);font-weight:700;letter-spacing:1px;">PRODUCTS</div>';       html += prods.map(p => `<div class="qs-item" data-goto-prod="${p.id}" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;"><img src="${esc(p.image)}" style="width:28px;height:28px;object-fit:cover;border-radius:6px;" onerror="this.style.visibility='hidden'"><span>${esc(p.name)}</span><span style="margin-left:auto;color:var(--muted);font-size:.78rem;">${money(p.price)}</span></div>`).join('');
  }
  if (ords.length) {
    html += '<div style="padding:8px 14px 4px;font-size:.7rem;color:var(--muted);font-weight:700;letter-spacing:1px;">ORDERS</div>';
    html += ords.map(o => `<div class="qs-item" data-goto-order="${o.id}" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;"><i class="fa-solid fa-receipt" style="color:var(--muted);"></i><span>${esc(o.id)}</span><span style="margin-left:auto;color:var(--muted);font-size:.78rem;">${esc(o.customer)}</span></div>`).join('');
  }
  if (!html) html = '<div style="padding:14px;color:var(--muted);font-size:.85rem;">No matches for “' + esc(q) + '”.</div>';
  wrap.innerHTML = html;
  const rel = $('.global-search'); rel.style.position = 'relative'; rel.appendChild(wrap);
  $$('.qs-item', wrap).forEach(el => el.addEventListener('click', () => {
    wrap.remove(); $('#globalSearch').value = '';
    if (el.dataset.gotoProd) { showPanel('products'); renderProducts(); }
    if (el.dataset.gotoOrder) { showPanel('orders'); renderOrders(); }
  }));
}

function initNotifs() {
  const n = DB.orders.filter(o => o.status === 'pending').length;
  const dot = $('#notifDot');
  if (dot) dot.style.display = n ? 'block' : 'none';
  $('#notifBtn').addEventListener('click', () => {
    const items = [
      ...DB.orders.filter(o => o.status === 'pending').map(o => ({ icon: 'fa-receipt', text: 'New order ' + o.id + ' from ' + o.customer, act: 'orders' }))
    ];
    openModal('Notifications (' + items.length + ')',
      items.map(i => `<div style="display:flex;gap:10px;align-items:center;padding:10px;border-bottom:1px solid var(--line);"><i class="fa-solid ${i.icon}" style="color:var(--primary);"></i><span style="flex:1;font-size:.88rem;">${esc(i.text)}</span></div>`).join('') || '<div class="empty"><p>All caught up!</p></div>',
      '<button class="btn btn-ghost" data-close-modal>Close</button>');
  });
}

/* ---------------- helpers ---------------- */
function byId(store, id) { return DB[store].find(x => x.id === id) || null; }
function catName(id) { const c = DB.cats.find(x => x.id === id); return c ? c.name : id; }
function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/--+/g, '-').slice(0, 60) || 'product'; }
function initials(name) { return String(name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
function plural(n, s, p) { return n === 1 ? s : p; }

/* ---------------- boot ---------------- */
function initApp() {
  initDB();
  renderNav();

  const first = new URLSearchParams(location.search).get('page') || 'dashboard';
  showPanel(LOCATIONS[first] ? first : 'dashboard');
  initGlobal();
  initNotifs();

  $('#logoutBtn').addEventListener('click', logout);
  $('#syncBtn').addEventListener('click', publishCatalog);
  $('#hamburger').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
  $('#confirmNo').addEventListener('click', () => { $('#confirmOverlay').classList.remove('open'); confirmCb = null; });
  $('#confirmOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) { $('#confirmOverlay').classList.remove('open'); confirmCb = null; } });
  $('#confirmYes').addEventListener('click', () => {
    $('#confirmOverlay').classList.remove('open');
    if (confirmCb) { const cb = confirmCb; confirmCb = null; cb(); }
  });
  $('#quickAddBtn').addEventListener('click', () => { showPanel('products'); openProductForm(); });
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) showPanel(g.dataset.goto);
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-modal]')) closeModal();
  });
}

/* ---------------- routing table ---------------- */
const PANELS = {
  dashboard: renderDashboard,
  products: renderProducts,
  categories: renderCategories,
  orders: renderOrders,
  users: renderUsers,
  coupons: renderCoupons,
  newsletter: renderNewsletter,
  content: renderContent,
  navigation: renderNavigation,
  media: renderMedia,
  analytics: renderAnalytics,
  settings: renderSettings
};

document.addEventListener('DOMContentLoaded', initAuth);
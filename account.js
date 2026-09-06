'use strict';

/* ===== PURITY LABS ACCOUNT DASHBOARD — Firebase backed =====
   Auth = Firebase, orders/cart/wishlist/profile = Firestore (via pdb.js).
   Age-gate preference stays on the device (local/sessionStorage). */

const $ = (s, c) => (c || document).querySelector(s);
const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));

function money(n) { return '$' + (+n || 0).toFixed(2); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return '—'; }
}

function toast(msg, type) {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.innerHTML = '<i class="fa-solid ' + (type === 'error' ? 'fa-circle-xmark' : 'fa-circle-check') + '"></i><span>' + esc(msg) + '</span>';
  box.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

/* ---------- state ---------- */
const state = {
  user: null,
  profile: null,
  cart: [],
  wishlist: [],
  orders: [],
  products: [],
  settings: {},
  content: {}
};
let unCart = null, unWish = null, unOrders = null, unProducts = null;
let renderedOnce = false;

/* ---------- age gate (homepage only) ---------- */
function ageGate() {
  const gate = $('#ageGate');
  if (!gate) return;
  if (localStorage.getItem('ageVerified')) { gate.classList.add('hidden'); return; }
  const yes = $('#ageYes');
  const no = $('#ageNo');
  if (!yes || !no) return;
  no.addEventListener('click', (e) => { e.preventDefault(); window.location.href = 'index.html'; });
  yes.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.setItem('ageVerified', '1');
    gate.classList.add('hidden');
  });
}

/* ---------- auth ---------- */
function switchAuthTab(tab) {
  $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('#loginForm').style.display = tab === 'login' ? 'flex' : 'none';
  $('#registerForm').style.display = tab === 'register' ? 'flex' : 'none';
}

/* ---------- welcome email (Resend via /api on Render) ---------- */
function sendWelcomeEmail(name, email) {
  const s = state.settings || {};
  const c = state.content || {};
  const settings = {
    siteName: c.siteName || 'Purity Labs',
    fromEmail: s.emailFrom || 'no-reply@puritylabs.com',
    storeAddress: s.storeAddress || '',
    contactEmail: s.contactEmail || 'info@puritylabs.org',
    footerNote: s.emailFooterNote || ''
  };
  const base = (window.EMAIL_API_BASE || '').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  return fetch(base + '/api/email/welcome', {
    method: 'POST', headers,
    body: JSON.stringify({ to: email, name, settings })
  }).then(() => {}).catch(() => {});
}
function showAuth() {
  $('#authView').style.display = 'block';
  $('#dashView').style.display = 'none';
}
function showDash() {
  $('#authView').style.display = 'none';
  $('#dashView').style.display = 'block';
}
function logout() {
  PDB.signOut().then(() => {
    stopWatchers();
    state.user = null; state.profile = null; state.cart = []; state.wishlist = []; state.orders = [];
    showAuth();
    toast('Signed out. See you soon!');
  });
}

/* ---------- dash navigation ---------- */
function showPanel(name) {
  $$('.dash-panel').forEach(p => p.classList.remove('active'));
  const panel = $('#panel-' + name);
  if (panel) panel.classList.add('active');
  $$('.dash-tab').forEach(t => t.classList.toggle('active', t.dataset.panel === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- order helpers ---------- */
function myOrders() {
  const user = state.user;
  return state.orders.filter(o => user && o.customerId === user.uid);
}
function orderTotal(o) {
  return o.total != null ? o.total : getCartTotalOf(o.items) + (o.shipping || 0);
}
function getCartTotal() { return getCartTotalOf(state.cart); }
function getCartTotalOf(items) {
  let s = 0;
  (items || []).forEach(it => { let t = (it.price || 0) * (it.qty || 1); if ((it.qty || 1) >= 4) t *= 0.8; s += t; });
  return s;
}
function getCartCount() { return state.cart.reduce((s, i) => s + (i.qty || 1), 0); }
function updateCartCount() {
  $$('.cart-count').forEach(el => { el.textContent = getCartCount(); });
  const dc = $('#dashCartCount'); if (dc) dc.textContent = getCartCount();
}
function badgeFor(status) {
  const s = status || 'processing';
  const cls = { processing: 'warn', completed: 'ok', pending: 'progress', shipped: 'progress', refunded: 'danger', cancelled: 'neutral' }[s] || 'neutral';
  return '<span class="badge ' + cls + '">' + s + '</span>';
}

/* ---------- watchers ---------- */
function stopWatchers() {
  if (unCart) { unCart(); unCart = null; }
  if (unWish) { unWish(); unWish = null; }
  if (unOrders) { unOrders(); unOrders = null; }
  if (unProducts) { unProducts(); unProducts = null; }
}

function startWatchers() {
  const uid = state.user.uid;
  unCart = PDB.watchCol('users/' + uid + '/cart', (list) => { state.cart = list || []; refresh(); });
  unWish = PDB.watchCol('users/' + uid + '/wishlist', (list) => { state.wishlist = list || []; refresh(); });
  unOrders = PDB.watchQuery(
    PDB.q('orders').where('customerId', '==', uid).orderBy('date', 'desc'),
    (list) => { state.orders = list || []; refresh(); }
  );
  unProducts = PDB.watchCol('products', (list) => { state.products = list || []; });
}

/* ---------- render: dashboard ---------- */
function refresh() {
  if (!state.user || $('#dashView').style.display === 'none') return;
  renderDash();
}

function renderDash() {
  showDash();
  const user = state.user;
  const orders = myOrders();
  const wish = state.wishlist;
  const cart = state.cart;

  $('#dashUserName').textContent = (state.profile && state.profile.name) || user.name || 'Researcher';
  $('#dashUserEmail').textContent = user.email || '';
  $('#dashAvatar').textContent = ((state.profile && state.profile.name) || user.name || 'U')[0].toUpperCase();
  $('#profName').value = (state.profile && state.profile.name) || user.name || '';
  $('#profEmail').value = user.email || '';

  $('#ordersCount').textContent = orders.length;
  $('#wishCount').textContent = wish.length;

  $('#ovOrders').textContent = orders.length;
  $('#ovSpend').textContent = money(orders.reduce((s, o) => s + orderTotal(o), 0));
  $('#ovWish').textContent = wish.length;
  $('#ovCart').textContent = getCartCount();

  renderRecent(orders);
  renderOrders(orders);
  renderTracking(orders);
  renderWishlist(wish);
  renderCart(cart);
}

/* ---------- orders ---------- */
function renderRecent(orders) {
  const el = $('#recentOrders');
  const recent = orders.slice(0, 4);
  if (!recent.length) {
    el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-receipt"></i><p>No orders yet. Your purchases will appear here.</p><p style="margin-top:10px;"><a class="btn-sm primary" href="index.html#products">Shop peptides</a></p></div>';
    return;
  }
  let html = '<table class="row-table"><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>';
  recent.forEach(o => {
    html += '<tr><td><b>' + esc(o.id) + '</b><br><span style="font-size:.76rem;color:var(--muted)">' + (o.items || []).length + ' item(s)</span></td>' +
      '<td>' + fmtDate(o.date) + '</td><td>' + badgeFor(o.status) + '</td><td><b>' + money(orderTotal(o)) + '</b></td></tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderOrders(orders) {
  const el = $('#ordersList');
  if (!orders.length) {
    el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-box-open"></i><p>No orders yet.</p><p style="margin-top:12px;"><a class="btn-sm primary" href="index.html#products">Start shopping</a></p></div>';
    return;
  }
  let html = '<table class="row-table"><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>';
  orders.forEach(o => {
    const items = (o.items || []).map(it => '<div style="font-size:.85rem;padding:3px 0;">' + esc(it.name) + (it.variation ? ' <span style="color:var(--muted);">(' + esc(it.variation) + ')</span>' : '') + ' &times;' + it.qty + ' <span style="color:var(--green);font-weight:600;">' + money((it.price || 0) * (it.qty || 1)) + '</span></div>').join('');
    html += '<tr class="order-summary" data-expand="' + esc(o.id) + '">' +
      '<td><b>' + esc(o.id) + '</b></td><td>' + fmtDate(o.date) + '</td>' +
      '<td>' + badgeFor(o.status) + '</td><td><b>' + money(orderTotal(o)) + '</b></td>' +
      '<td><i class="fa-solid fa-chevron-down chev"></i></td></tr>' +
      '<tr class="order-detail" data-detail="' + esc(o.id) + '"><td colspan="5">' +
      '<div style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;">' +
      '<div style="flex:1;min-width:240px;">' + items + '</div>' +
      '<div style="min-width:160px;"><p style="font-size:.82rem;color:var(--muted);margin-bottom:6px;">Payment summary</p>' +
      '<div style="font-size:.86rem;"><div style="display:flex;justify-content:space-between;"><span>Subtotal</span><b>' + money(getCartTotalOf(o.items)) + '</b></div>' +
      '<div style="display:flex;justify-content:space-between;"><span>Shipping</span><b>' + (o.shipping ? money(o.shipping) : 'Free') + '</b></div>' +
      '<div style="display:flex;justify-content:space-between;border-top:1px solid var(--line);margin-top:6px;padding-top:6px;"><span>Total</span><b>' + money(orderTotal(o)) + '</b></div></div>' +
      '<button class="btn-sm primary" style="margin-top:10px;width:100%;" onclick="reorder(' + JSON.stringify(o.items || []).replace(/"/g, '&quot;') + ')">Reorder items</button>' +
      '</div></div></td></tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;

  $$('.order-summary').forEach(r => {
    r.addEventListener('click', () => {
      const id = r.dataset.expand;
      const detail = $('[data-detail="' + id + '"]');
      const chev = r.querySelector('.chev');
      if (detail) { detail.classList.toggle('open'); chev.style.transform = detail.classList.contains('open') ? 'rotate(180deg)' : ''; }
    });
  });
}

/* ---------- order tracking ---------- */
function renderTracking(orders) {
  const el = $('#trackingList');
  if (!orders.length) {
    el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-truck-fast"></i><p>No orders to track yet. Place your first order to see live status here.</p></div>';
    return;
  }
  const steps = ['processing', 'shipped', 'completed'];
  const html = orders.map(o => {
    const hist = (o.tracking && o.tracking.length ? o.tracking : [{ status: o.status || 'processing', message: '', at: o.date }]);
    const cur = hist[hist.length - 1];
    const idx = steps.indexOf(cur.status || 'processing');
    let body = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:180px;"><b style="font-size:.95rem;">' + esc(o.id) + '</b>' +
      '<div style="font-size:.8rem;color:var(--muted);">Placed ' + fmtDate(o.date) + '</div></div>' +
      '<div>' + badgeFor(cur.status) + '</div>' +
      '<div style="text-align:right;"><b>' + money(orderTotal(o)) + '</b></div></div>';
    body += '<div style="display:flex;align-items:flex-start;margin:16px 0 14px;">' +
      steps.map((s, i) => {
        const active = idx >= i, done = idx > i;
        return '<div style="flex:1;text-align:center;position:relative;">' +
          (i < steps.length - 1 ? '<div style="position:absolute;top:10px;left:calc(50% + 12px);right:calc(-50% + 12px);height:2px;background:' + (done ? 'var(--green)' : 'var(--line)') + ';"></div>' : '') +
          '<div style="width:22px;height:22px;border-radius:50%;margin:0 auto 6px;display:flex;align-items:center;justify-content:center;font-size:.55rem;border:2px solid ' + (idx > i ? 'var(--green)' : 'var(--line)') + ';background:' + (idx > i ? 'var(--green)' : '#fff') + ';color:#fff;">' +
          (idx > i ? '<i class="fa-solid fa-check"></i>' : (idx === i ? '<span style="display:block;width:8px;height:8px;border-radius:50%;background:var(--green);"></span>' : '')) + '</div>' +
          '<div style="font-size:.72rem;font-weight:600;color:' + (active ? 'var(--green)' : 'var(--muted)') + ';">' + s.charAt(0).toUpperCase() + s.slice(1) + '</div></div>';
      }).join('') + '</div>';
    const updates = hist.slice().reverse();
    body += '<div style="border:1px solid var(--line);border-radius:10px;background:#fff;padding:12px 14px;">' +
      '<div style="font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">Updates</div>' +
      (updates.length ? updates.map(st => '<div style="border-left:2px solid var(--green);padding:0 0 12px 12px;position:relative;">' +
        '<div style="position:absolute;left:-5px;top:4px;width:8px;height:8px;border-radius:50%;background:var(--green);"></div>' +
        '<div style="display:flex;align-items:center;gap:10px;">' + badgeFor(st.status) +
        '<span style="font-size:.74rem;color:var(--muted);">' + fmtDate(st.at) + '</span></div>' +
        (st.message ? '<div style="font-size:.84rem;color:var(--ink);margin-top:3px;">' + esc(st.message) + '</div>' : '') + '</div>').join('')
        : '<div style="font-size:.84rem;color:var(--muted);">No status updates yet.</div>') + '</div>';
    return '<div class="track-card">' + body + '</div>';
  }).join('');
  el.innerHTML = html;
}

function cartKeyOf(it) {
  const base = (it.slug || (it.name || 'item').toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  return base + (it.variation ? '|' + it.variation : '');
}

function reorder(items) {
  const uid = state.user.uid;
  (items || []).forEach(it => {
    const prod = state.products.find(p => (p.name || '').toLowerCase() === (it.name || '').toLowerCase());
    const key = cartKeyOf({ slug: prod ? prod.slug : null, name: it.name, variation: it.variation || '' });
    const rec = {
      slug: prod ? prod.slug : (it.name || 'item').toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      name: it.name,
      price: it.price || 0,
      image: prod ? prod.image : '',
      variation: it.variation || '',
      qty: PDB.inc(it.qty || 1),
      addedAt: PDB.ts()
    };
    PDB.setDoc('users/' + uid + '/cart', key, rec, { merge: true }).catch(() => {});
  });
  updateCartCount();
  showPanel('cart');
  toast('Items added to your cart');
}
window.reorder = reorder;

/* ---------- wishlist ---------- */
function renderWishlist(wish) {
  const el = $('#wishlistList');
  if (!wish.length) {
    el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-heart"></i><p>Your wishlist is empty. Tap the heart on any product to save it here.</p><p style="margin-top:12px;"><a class="btn-sm primary" href="index.html#products">Discover products</a></p></div>';
    return;
  }
  el.innerHTML = '<div class="item-list">' + wish.map(w => {
    const img = w.image ? '<img class="item-img" src="' + esc(w.image) + '" onerror="this.style.opacity=0">' : '<div class="item-img" style="background:var(--green-soft);display:flex;align-items:center;justify-content:center;color:var(--green);"><i class="fa-solid fa-capsules"></i></div>';
    return '<div class="item-card">' + img +
      '<div class="item-info"><div class="item-name">' + esc(w.name) + '</div><div class="item-meta">Saved to wishlist</div></div>' +
      '<div class="row-actions">' +
      '<button class="btn-sm primary" onclick="wishToCart(' + JSON.stringify(w).replace(/"/g, '&quot;') + ')"><i class="fa-solid fa-bag-shopping"></i> Add to cart</button>' +
      '<button class="btn-sm danger" onclick="removeWish(' + JSON.stringify(w.id).replace(/"/g, '&quot;') + ')"><i class="fa-solid fa-trash"></i></button>' +
      '</div></div>';
  }).join('') + '</div>';
}

function wishToCart(w) {
  const uid = state.user.uid;
  const key = String(w.id);
  const existing = state.cart.find(x => x.id === key && x.variation === '');
  const rec = {
    slug: key,
    name: w.name,
    price: Number(w.price) || 0,
    image: w.image || '',
    variation: '',
    qty: PDB.inc(1),
    addedAt: PDB.ts()
  };
  PDB.setDoc('users/' + uid + '/cart', key, rec, { merge: true }).catch(() => {});
  PDB.delDoc('users/' + uid + '/wishlist', key).catch(() => {});
  showPanel('cart');
  toast('Added to cart');
}
window.wishToCart = wishToCart;

function removeWish(id) {
  const uid = state.user.uid;
  PDB.delDoc('users/' + uid + '/wishlist', String(id)).catch(() => {});
}
window.removeWish = removeWish;

/* ---------- cart ---------- */
function renderCart(cart) {
  const el = $('#cartList');
  if (!cart.length) {
    el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-bag-shopping"></i><p>Your cart is empty.</p><p style="margin-top:12px;"><a class="btn-sm primary" href="index.html#products">Browse products</a> <a class="btn-sm" href="cart.html">Open cart page</a></p></div>';
    return;
  }
  const subtotal = getCartTotal();
  const shipping = subtotal >= 250 ? 0 : 9.99;
  const total = subtotal + shipping;
  el.innerHTML =
    '<div class="item-list">' + cart.map((it, i) => {
      const hasDiscount = it.qty >= 4;
      const line = it.price * it.qty * (hasDiscount ? 0.8 : 1);
      const img = it.image ? '<img class="item-img" src="' + esc(it.image) + '" onerror="this.style.opacity=0">' : '<div class="item-img" style="background:var(--green-soft);display:flex;align-items:center;justify-content:center;color:var(--green);"><i class="fa-solid fa-capsules"></i></div>';
      return '<div class="item-card">' + img +
        '<div class="item-info"><div class="item-name">' + esc(it.name) + (it.variation ? ' <span style="color:var(--muted);font-weight:400;">(' + esc(it.variation) + ')</span>' : '') + '</div>' +
        '<div class="item-meta">' + money(it.price) + ' each' + (hasDiscount ? ' <span style="color:var(--green);">(20% off)</span>' : '') + '</div></div>' +
        '<div style="display:flex;align-items:center;gap:10px;"><button class="btn-sm" onclick="cartQty(' + i + ',-1)">−</button><b style="min-width:24px;text-align:center;">' + it.qty + '</b><button class="btn-sm" onclick="cartQty(' + i + ',1)">+</button></div>' +
        '<div class="item-price">' + money(line) + '</div>' +
        '<button class="btn-sm danger" onclick="cartRemove(' + i + ')"><i class="fa-solid fa-trash"></i></button></div>';
    }).join('') + '</div>' +
    '<div style="margin-top:18px;padding:16px 18px;background:var(--green-soft);border-radius:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">' +
    '<div style="font-size:.9rem;"><div style="display:flex;gap:26px;"><span>Subtotal <b>' + money(subtotal) + '</b></span><span>Shipping <b>' + (shipping ? money(shipping) : 'Free') + '</b></span><span style="color:var(--green);font-weight:700;">Total ' + money(total) + '</span></div></div>' +
    '<a class="btn-sm primary" href="checkout.html" style="padding:11px 20px;">Proceed to Checkout</a></div>';
}

function cartQty(i, delta) {
  const uid = state.user.uid;
  const it = state.cart[i];
  if (!it) return;
  if (delta < 0 && (it.qty || 1) <= 1) {
    PDB.delDoc('users/' + uid + '/cart', it.id).catch(() => {});
    return;
  }
  PDB.setDoc('users/' + uid + '/cart', it.id, { qty: PDB.inc(delta) }, { merge: true }).catch(() => {});
}
window.cartQty = cartQty;

function cartRemove(i) {
  const uid = state.user.uid;
  const it = state.cart[i];
  if (!it) return;
  PDB.delDoc('users/' + uid + '/cart', it.id).catch(() => {});
}
window.cartRemove = cartRemove;

/* ---------- profile ---------- */
function initProfile() {
  $('#profileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#profName').value.trim();
    const email = $('#profEmail').value.trim();
    if (!name || !email) { toast('Name and email are required', 'error'); return; }
    PDB.setDoc('users', state.user.uid, { name: name, email: email }, { merge: true })
      .then(() => {
        state.profile = Object.assign({}, state.profile || {}, { name: name, email: email });
        renderDash();
        toast('Profile saved');
      })
      .catch(() => toast('Could not save profile. Check your connection.', 'error'));
  });
}

/* ---------- boot ---------- */
function boot() {
  if (!PDB.ready) {
    showAuth();
    toast('Firebase is unavailable right now.', 'error');
    return;
  }
  ageGate();
  updateCartCount();

  PDB.watchDoc('settings', 'config', (s) => { if (s) state.settings = Object.assign({}, state.settings, s); });
  PDB.watchDoc('content', 'home', (c) => { if (c) state.content = Object.assign({ siteName: 'Purity Labs' }, c); });

  $('#tabLogin').addEventListener('click', () => switchAuthTab('login'));
  $('#tabRegister').addEventListener('click', () => switchAuthTab('register'));

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const pass = $('#loginPass').value;
    if (!email || !pass) { toast('Enter your email and password', 'error'); return; }
    PDB.signIn(email, pass).catch((err) => toast(PDB.authMsg(err), 'error'));
  });
  $('#registerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#regName').value.trim() || 'Researcher';
    const email = $('#regEmail').value.trim();
    const pass = $('#regPass').value;
    if (!email || !pass) { toast('Enter your email and password', 'error'); return; }
    PDB.signUp(email, pass)
      .then((user) => PDB.setDoc('users', user.uid, {
        name: name, email: email, role: 'customer',
        joined: new Date().toISOString(), created: PDB.ts()
      }, { merge: false }))
      .then(() => {
        toast('Account created. Welcome, ' + name + '!');
        sendWelcomeEmail(name, email);
      })
      .catch((err) => toast(PDB.authMsg(err), 'error'));
  });

  $('#logoutBtn').addEventListener('click', logout);

  $$('.dash-tab').forEach(t => t.addEventListener('click', () => showPanel(t.dataset.panel)));
  $$('[data-goto-panel]').forEach(b => b.addEventListener('click', () => showPanel(b.dataset.gotoPanel)));
  initProfile();

  PDB.onAuth((user) => {
    stopWatchers();
    state.user = user;
    state.profile = null;
    state.cart = []; state.wishlist = []; state.orders = [];
    updateCartCount();
    if (user) {
      PDB.getDoc('users', user.uid).then((doc) => {
        state.profile = doc || null;
        renderDash();
      });
      startWatchers();
      if (!renderedOnce) renderDash();
    } else {
      showAuth();
    }
    renderedOnce = true;
  });

  renderedOnce = true;

  setTimeout(() => {
    if (!state.user) showAuth();
  }, 1500);
}

document.addEventListener('DOMContentLoaded', boot);
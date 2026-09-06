/* ===== PURITY LABS STOREFRONT — Firestore backed =====
   Cart, wishlist, accounts and orders live in Firestore (via pdb.js).
   Guests are prompted to sign in before adding items to cart / wishlist.
*/

// ===== RENDER KEEP-ALIVE (invisible to client) =====
// Pings the Render service on page load so it stays awake/warm. This avoids
// the first request after a sleep triggering a slow cold-start (which would
// delay sending emails). It runs silently in the background — nothing shows
// in the UI.
(function () {
  const RENDER_URL = 'https://puritylabs.onrender.com';
  if (!navigator.onLine) return;
  const ping = function () {
    try {
      fetch(RENDER_URL + '/api/health', { method: 'GET', mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    } catch (e) { /* ignore */ }
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    ping();
  } else {
    document.addEventListener('DOMContentLoaded', ping);
  }
  setInterval(ping, 5 * 60 * 1000);
})();

// ===== AGE GATE (homepage only) =====
document.addEventListener('DOMContentLoaded', () => {
  const ageGate = document.getElementById('ageGate');
  const ageYes = document.getElementById('ageYes');
  const ageNo = document.getElementById('ageNo');

  if (!ageGate || !ageYes || !ageNo) return;
  if (localStorage.getItem('ageVerified')) { ageGate.classList.add('hidden'); return; }

  ageYes.addEventListener('click', () => {
    localStorage.setItem('ageVerified', '1');
    ageGate.classList.add('hidden');
  });

  ageNo.addEventListener('click', () => {
    window.location.href = 'https://google.com';
  });
});

// ===== HEADER SCROLL =====
window.addEventListener('scroll', () => {
  const header = document.getElementById('header');
  if (header) header.classList.toggle('scrolled', window.scrollY > 50);
});

// ===== MOBILE NAV =====
(function () {
  const btn = document.getElementById('mobileMenuBtn');
  const nav = document.getElementById('mobileNav');
  const close = document.getElementById('mobileNavClose');
  if (!btn || !nav) return;

  btn.addEventListener('click', () => nav.classList.add('open'));
  close?.addEventListener('click', () => nav.classList.remove('open'));
  document.querySelectorAll('.mobile-nav-link, .mobile-sub-menu a').forEach(l => l.addEventListener('click', () => nav.classList.remove('open')));
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('open') && !nav.contains(e.target) && e.target !== btn && !btn.contains(e.target)) nav.classList.remove('open');
  });
})();

// ===== SEARCH OVERLAY =====
(function () {
  const searchBtn = document.getElementById('searchBtn');
  const overlay = document.getElementById('searchOverlay');
  const close = document.getElementById('searchClose');
  if (!searchBtn || !overlay) return;
  searchBtn.addEventListener('click', () => {
    overlay.classList.add('open');
    setTimeout(() => overlay.querySelector('.search-input')?.focus(), 300);
  });
  close?.addEventListener('click', () => overlay.classList.remove('open'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) overlay.classList.remove('open');
  });
})();

// ===== SEARCH FORM (client-side filter) =====
const searchForm = document.querySelector('.search-form');
if (searchForm) {
  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const query = this.querySelector('.search-input').value.trim().toLowerCase();
    if (!query) return;
    const productCards = document.querySelectorAll('.product-card');
    if (productCards.length > 0) {
      productCards.forEach(card => {
        const name = card.querySelector('.product-name h3')?.textContent?.toLowerCase() || '';
        card.style.setProperty('display', name.includes(query) ? '' : 'none');
      });
      document.getElementById('searchOverlay')?.classList.remove('open');
    } else {
      window.location.href = 'index.html#products';
    }
  });
}

// ===== NEWSLETTER FORM (Firestore 'newsletter' collection) =====
const newsletterForm = document.getElementById('newsletterForm');
if (newsletterForm) {
  newsletterForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const input = this.querySelector('input[type="email"]');
    const email = (input.value || '').trim();
    if (!email) return;
    const btn = this.querySelector('button');
    const restore = () => { btn.textContent = 'Subscribe'; btn.style.background = ''; };
    const subscribed = () => {
      btn.textContent = 'Subscribed!';
      btn.style.background = '#2E7D32';
      input.value = '';
      setTimeout(restore, 3000);
    };
    if (window.PDB && PDB.ready && PDB.addDoc) {
      PDB.addDoc('newsletter', { email, joined: new Date().toISOString(), source: 'footer' })
        .then(() => { subscribed(); toast('Thanks for subscribing!'); })
        .catch(() => { toast('Could not sign you up — please try again.', 'error'); restore(); });
    } else {
      subscribed();
    }
  });
}

// ===== HELPERS =====
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function moneyNum(n) { return parseFloat(String(n == null ? '' : n).match(/[\d]+(?:\.[\d]+)?/)?.[0]) || 0; }
function parsePrice(text) {
  if (!text) return 0;
  const match = text.match(/[\d]+(?:\.[\d]+)?/);
  return match ? parseFloat(match[0]) : 0;
}
function enc(s) { return btoa(unescape(encodeURIComponent(String(s)))); }
function dec(s) { return decodeURIComponent(escape(atob(String(s)))); }
function keyArg(id) { return String(id).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// ===== FIREBASE STATE =====
const DB = { user: null, cart: [], wishlist: [], products: [], settings: {}, content: {} };

// ===== EMAIL CLIENT (Resend via /api) =====
// Hosted on the same Render service, so /api/… works in the browser with no
// extra config. If the storefront is ever hosted somewhere else, set URL before:
//   window.EMAIL_API_BASE = 'https://puritylabs.onrender.com';
window.PurityMail = {
  base: (window.EMAIL_API_BASE || '').replace(/\/+$/, ''),
  headers() {
    return { 'Content-Type': 'application/json' };
  },
  emailSettings() {
    const s = DB.settings || {};
    const c = DB.content || {};
    return {
      siteName: c.siteName || 'Purity Labs',
      fromEmail: s.emailFrom || 'no-reply@puritylabs.com',
      adminEmails: String(s.adminNotifyEmails || '').split(',').map(x => x.trim()).filter(Boolean),
      storeAddress: s.storeAddress || '',
      contactEmail: s.contactEmail || 'info@puritylabs.org',
      footerNote: s.emailFooterNote || 'Precision research compounds for in-vitro and laboratory use only. Not for human consumption.'
    };
  },
  sendWelcome(name, email) {
    return fetch(this.base + '/api/email/welcome', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ to: email, name: name || '', settings: this.emailSettings() })
    }).then(r => r.json().catch(() => ({ ok: false })))
      .catch(err => ({ ok: false, error: err.message }));
  },
  sendOrder(order) {
    return fetch(this.base + '/api/email/order', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ order: order, settings: this.emailSettings() })
    }).then(r => r.json().catch(() => ({ ok: false })))
      .catch(err => ({ ok: false, error: err.message }));
  }
};
let cartUnsub = null;
let wishUnsub = null;

// ===== CART SYSTEM (Firestore for signed-in users, localStorage for guests) =====
const GUEST_CART_KEY = 'pl_guest_cart';

function guestCart() {
  try { return JSON.parse(localStorage.getItem(GUEST_CART_KEY)) || []; } catch (e) { return []; }
}
function saveGuestCart(list) {
  localStorage.setItem(GUEST_CART_KEY, JSON.stringify(list || []));
  rerenderCartUI();
}
function cartList() {
  return DB.user ? DB.cart : guestCart();
}
function getCart() { return cartList(); }
function getWishlist() { return DB.wishlist; }

function keyOf(o) {
  const base = (o.slug || o.id || 'item').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return base + (o.variation ? '|' + o.variation : '');
}
function cartCol() { return 'users/' + DB.user.uid + '/cart'; }
function wishCol() { return 'users/' + DB.user.uid + '/wishlist'; }

function getCartTotal() {
  let total = 0;
  cartList().forEach(item => {
    let t = (item.price || 0) * (item.qty || 1);
    if (item.qty >= 4) t *= 0.8;
    total += t;
  });
  return total;
}
function getCartCount() {
  return cartList().reduce((sum, item) => sum + (item.qty || 1), 0);
}
function updateCartCount() {
  document.querySelectorAll('.cart-count').forEach(el => { el.textContent = getCartCount(); });
}
function rerenderCartUI() {
  updateCartCount();
  renderSideCart();
  renderCartPage();
  renderCheckoutSummary();
}

function requireAuth(msg) {
  if (DB.user) return true;
  showAuthMsg(msg || 'Please sign in to continue.');
  openAccount();
  return false;
}

function addToCart(product) {
  const qty = product.qty || 1;
  if (DB.user) {
    const key = keyOf(product);
    PDB.setDoc(cartCol(), key, {
      slug: product.slug || product.id,
      name: product.name,
      price: moneyNum(product.price),
      image: product.image || '',
      qty: PDB.inc(qty),
      variation: product.variation || '',
      addedAt: PDB.ts()
    }, { merge: true }).catch(() => {});
  } else {
    const key = keyOf(product);
    const list = guestCart();
    const existing = list.find(i => i.id === key);
    if (existing) existing.qty = (existing.qty || 1) + qty;
    else list.push({ id: key, slug: product.slug || product.id, name: product.name, price: moneyNum(product.price), image: product.image || '', qty: qty, variation: product.variation || '', addedAt: new Date().toISOString() });
    saveGuestCart(list);
  }
  showAddedNotification(product.name);
  openSideCart();
}
function removeFromCart(key) {
  if (DB.user) {
    PDB.delDoc(cartCol(), key).catch(() => {});
  } else {
    saveGuestCart(guestCart().filter(i => i.id !== key));
  }
}
function updateCartItemQty(key, delta) {
  const list = cartList();
  const item = list.find(i => i.id === key);
  if (!item) return;
  if (delta < 0 && item.qty <= 1) { removeFromCart(key); return; }
  if (DB.user) {
    PDB.setDoc(cartCol(), key, { qty: PDB.inc(delta) }, { merge: true }).catch(() => {});
  } else {
    item.qty = (item.qty || 1) + delta;
    saveGuestCart(list);
  }
}
function clearCart() {
  if (DB.user) {
    if (!DB.cart.length) return Promise.resolve();
    return Promise.all(DB.cart.map(it => PDB.delDoc(cartCol(), it.id).catch(() => {})));
  }
  saveGuestCart([]);
  return Promise.resolve();
}

// ===== VARIATION BUTTONS =====
document.addEventListener('click', (e) => {
  const varBtn = e.target.closest('.variation-option');
  if (!varBtn) return;
  e.preventDefault();
  const container = varBtn.closest('.variation-options, .product-variations');
  if (!container) return;
  container.querySelectorAll('.variation-option').forEach(b => b.classList.remove('active'));
  varBtn.classList.add('active');

  const card = varBtn.closest('.product-card, .product-summary, .product-info');
  const dataPrice = varBtn.dataset.price;
  if (dataPrice && card) {
    const priceEl = card.querySelector('.product-summary-price ins .woocommerce-Price-amount, .product-summary-price .woocommerce-Price-amount');
    if (priceEl) priceEl.textContent = '$' + parseFloat(dataPrice).toFixed(2);
  }
});

// ===== QUANTITY INPUT =====
function changeQty(delta) {
  const input = document.getElementById('qtyInput');
  if (!input) return;
  const val = parseInt(input.value || '1', 10);
  input.value = Math.max(1, Math.min(10, val + delta));
}
window.changeQty = changeQty;

// ===== SIDE CART =====
function renderSideCart() {
  const container = document.getElementById('sideCartItems');
  const footer = document.getElementById('sideCartFooter');
  if (!container) return;
  const cart = cartList();

  if (cart.length === 0) {
    container.innerHTML = '<div class="side-cart-empty"><i class="fa-solid fa-bag-shopping"></i><p>Your cart is empty</p></div>';
    if (footer) footer.style.display = 'none';
    return;
  }

  if (footer) footer.style.display = 'block';

  container.innerHTML = cart.map(item => {
    const itemTotal = item.qty >= 4 ? item.price * item.qty * 0.8 : item.price * item.qty;
    const hasDiscount = item.qty >= 4;
    const key = keyArg(item.id);
    return `
    <div class="side-cart-item">
      <img src="${esc(item.image)}" alt="${esc(item.name)}" class="side-cart-item-img">
      <div class="side-cart-item-info">
        <div class="side-cart-item-name">${esc(item.name)}</div>
        ${item.variation ? `<div class="side-cart-item-variation">${esc(item.variation)}</div>` : ''}
        <div class="side-cart-item-price">$${(item.price || 0).toFixed(2)}${hasDiscount ? ' <span style="color:#2E7D32;font-size:.75rem;">(20% off)</span>' : ''}</div>
        <div class="side-cart-item-qty">
          <button onclick="updateCartItemQty('${key}',-1)">−</button>
          <span>${item.qty}</span>
          <button onclick="updateCartItemQty('${key}',1)">+</button>
        </div>
      </div>
      <button class="side-cart-item-remove" onclick="removeFromCart('${key}')">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    `;
  }).join('');

  const subtotal = getCartTotal();
  const shipping = subtotal >= 250 ? 0 : 9.99;
  const total = subtotal + shipping;

  const shippingFill = document.getElementById('sideCartShippingFill');
  const shippingText = document.getElementById('sideCartShippingText');
  if (shippingFill) shippingFill.style.width = Math.min(100, (subtotal / 250) * 100) + '%';
  if (shippingText) {
    if (subtotal >= 250) shippingText.innerHTML = 'You\'ve unlocked <b>free shipping!</b>';
    else shippingText.innerHTML = `Add <b>$${(250 - subtotal).toFixed(2)}</b> more for free shipping`;
  }

  const totalsEl = document.getElementById('sideCartTotals');
  if (totalsEl) {
    totalsEl.innerHTML = `
      <div class="side-cart-totals-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
      <div class="side-cart-totals-row"><span>Shipping</span><span>${shipping === 0 ? 'Free' : '$' + shipping.toFixed(2)}</span></div>
      <div class="side-cart-totals-row total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
    `;
  }
}

function openSideCart() {
  document.getElementById('sideCartOverlay')?.classList.add('open');
  document.getElementById('sideCart')?.classList.add('open');
  renderSideCart();
}
function closeSideCart() {
  document.getElementById('sideCartOverlay')?.classList.remove('open');
  document.getElementById('sideCart')?.classList.remove('open');
}

// ===== NOTIFICATION =====
function showAddedNotification(name) {
  let notif = document.getElementById('addedNotification');
  if (!notif) {
    notif = document.createElement('div');
    notif.id = 'addedNotification';
    notif.className = 'added-notification';
    document.body.appendChild(notif);
  }
  notif.innerHTML = `<i class="fa-solid fa-check"></i> ${esc(name)} added to cart`;
  notif.classList.add('show');
  setTimeout(() => notif.classList.remove('show'), 2500);
}

function toast(msg) {
  let box = document.getElementById('appToasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'appToasts';
    box.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:999999;';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.style.cssText = 'background:#2E7D32;color:#fff;padding:10px 18px;border-radius:8px;font-size:.85rem;margin-top:8px;box-shadow:0 4px 14px rgba(0,0,0,.2);';
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2400);
  setTimeout(() => t.remove(), 2800);
}

// ===== WISHLIST =====
function updateWishlistFlags() {
  const keys = {};
  DB.wishlist.forEach(w => { keys[w.id] = true; });
  document.querySelectorAll('.hover-action-btn[aria-label="Add to wishlist"]').forEach(btn => {
    const card = btn.closest('.product-card');
    if (!card) return;
    const name = card.querySelector('.product-name h3')?.textContent?.trim() || '';
    const link = card.querySelector('.product-link, .product-name')?.getAttribute('href') || '';
    const slug = (link.split('/').pop() || '').replace(/\.html$/, '') || name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    btn.classList.toggle('active', !!keys[slug]);
  });
}

function toggleWishlist(btn, product) {
  if (!requireAuth('Sign in to save items to your wishlist.')) return;
  const key = keyOf(product);
  const exists = DB.wishlist.some(w => w.id === key);
  const col = wishCol();
  if (exists) {
    PDB.delDoc(col, key).catch(() => {});
    if (btn) btn.classList.remove('active');
  } else {
    PDB.setDoc(col, key, {
      slug: product.slug || product.id,
      name: product.name,
      price: moneyNum(product.price) || 0,
      image: product.image || '',
      addedAt: PDB.ts()
    }, { merge: false }).catch(() => {});
    if (btn) btn.classList.add('active');
  }
}

// ===== PRODUCT CARD / ACTION DELEGATION =====
function cardProduct(card) {
  const slugHolder = card.closest('[data-slug]');
  const name = card.querySelector('.product-name h3, .product-summary-title')?.textContent?.trim();
  const image = card.querySelector('.product-img-wrap img, .product-gallery-main img')?.src;
  const link = card.querySelector('.product-link, .product-name')?.getAttribute('href') || '';
  let slug = (slugHolder && slugHolder.dataset.slug) ? slugHolder.dataset.slug : '';
  if (!slug) {
    const qm = /[?&]slug=([^&]+)/.exec(link);
    if (qm) slug = decodeURIComponent(qm[1]);
  }
  if (!slug) slug = (link.split('/').pop() || '').replace(/\.html$/, '');
  if (!slug) slug = name ? name.toLowerCase().replace(/[^a-z0-9]/g, '-') : 'item';
  return { slug, id: slug, name, image };
}

document.addEventListener('click', (e) => {
  const addBtn = e.target.closest('.addtocart-btn, .btn-add-to-cart');
  if (addBtn) {
    e.preventDefault();
    const card = addBtn.closest('.product-card, .product-summary');
    if (!card) return;

    const product = cardProduct(card);
    const activeVar = card.querySelector('.variation-option.active');
    let finalPrice = 0;

    if (activeVar && activeVar.dataset.price) {
      finalPrice = parseFloat(activeVar.dataset.price);
    } else {
      const priceText = card.querySelector('.product-info-right ins .woocommerce-Price-amount, .product-info-right .woocommerce-Price-amount, .product-summary-price ins .woocommerce-Price-amount, .product-summary-price .woocommerce-Price-amount, .product-price .woocommerce-Price-amount')?.textContent;
      finalPrice = parsePrice(priceText);
    }

    const variation = activeVar ? activeVar.textContent.trim() : '';

    if (product.name && finalPrice > 0) {
      addToCart({
        slug: product.slug,
        id: product.slug,
        name: product.name,
        price: finalPrice,
        image: product.image || '',
        qty: parseInt(document.getElementById('qtyInput')?.value || '1'),
        variation: variation
      });
    }
    return;
  }

  const wishBtn = e.target.closest('.hover-action-btn[aria-label="Add to wishlist"]');
  if (wishBtn) {
    e.preventDefault();
    const card = wishBtn.closest('.product-card');
    if (!card) return;
    const product = cardProduct(card);
    toggleWishlist(wishBtn, product);
    return;
  }

  if (e.target.closest('.cart-btn, #cartBtn')) {
    openSideCart();
    return;
  }

  if (e.target.closest('.side-cart-close') || e.target.id === 'sideCartOverlay') {
    closeSideCart();
    return;
  }
});

// ===== ACCOUNT (redirect to account.html dashboard) =====
// The storefront no longer shows an inline sign-in modal. Clicking the
// account button (or an action that requires auth) sends the user to the
// standalone customer dashboard (account.html) where sign-in / sign-up and
// the full order/wishlist/cart/profile management lives.

function showAuthMsg(msg) {
  toast(msg);
}

function accountUrl() {
  const inPages = /\/pages\//.test(window.location.pathname);
  return (inPages ? '../' : './') + 'account.html';
}

function goAccount() {
  window.location.href = accountUrl();
}

function openAccount() {
  goAccount();
}

function updateAuthUI() {
  // Account state is handled on the account.html dashboard. Nothing to update here.
}

function checkLoggedIn() { return !!DB.user; }

document.addEventListener('click', (e) => {
  if (e.target.closest('#accountBtn')) { e.preventDefault(); goAccount(); return; }
});

// ===== FIREBASE LISTENERS =====
function startEmailConfig() {
  PDB.watchDoc('settings', 'config', (s) => { if (s) DB.settings = Object.assign({}, DB.settings, s); });
  PDB.watchDoc('content', 'home', (c) => { if (c) DB.content = Object.assign({ siteName: 'Purity Labs' }, c); });
}

function startFirebase() {
  PDB.onAuth((user) => {
    DB.user = user;
    updateAuthUI();
    updateCartCount();
    renderSideCart();
    if (cartUnsub) { cartUnsub(); cartUnsub = null; }
    if (wishUnsub) { wishUnsub(); wishUnsub = null; }
    DB.cart = [];
    DB.wishlist = [];
    if (user) {
      migrateGuestCart();
      cartUnsub = PDB.watchCol(cartCol(), (list) => {
        DB.cart = list || [];
        updateCartCount();
        renderSideCart();
        renderCartPage();
        renderCheckoutSummary();
      });
      wishUnsub = PDB.watchCol(wishCol(), (list) => {
        DB.wishlist = list || [];
        updateWishlistFlags();
      });
    } else {
      updateCartCount();
      renderSideCart();
      renderCartPage();
      renderCheckoutSummary();
    }
  });
}

/* Move a guest cart from localStorage into the signed-in user's Firestore
   cart on first sign-in, then clear the local copy. */
function migrateGuestCart() {
  const guest = guestCart();
  if (!guest || !guest.length) { saveGuestCart([]); return; }
  const doc = {};
  guest.forEach(it => {
    if (!it) return;
    const key = it.id || keyOf(it);
    doc[key] = {
      slug: it.slug || it.id,
      name: it.name || '',
      price: it.price || 0,
      image: it.image || '',
      qty: it.qty || 1,
      variation: it.variation || '',
      addedAt: it.addedAt || new Date().toISOString()
    };
  });
  Promise.all(Object.keys(doc).map(key =>
    PDB.setDoc(cartCol(), key, doc[key], { merge: true }).catch(() => {})
  )).then(() => saveGuestCart([]));
}

// ===== CART PAGE =====
function initCartPage() {
  const body = document.getElementById('cartTableBody');
  if (body) renderCartPage();
}

function renderCartPage() {
  const emptyEl = document.getElementById('cartEmpty');
  const contentEl = document.getElementById('cartContent');
  const body = document.getElementById('cartTableBody');
  if (!body) return;
  const cart = cartList();

  if (cart.length === 0) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'block';

  body.innerHTML = cart.map(item => {
    const lineTotal = item.qty >= 4 ? item.price * item.qty * 0.8 : item.price * item.qty;
    const hasDiscount = item.qty >= 4;
    const key = keyArg(item.id);
    return `
      <tr>
        <td>
          <div class="cart-item-product">
            <img src="${esc(item.image)}" alt="${esc(item.name)}" class="cart-item-img">
            <div>
              <div class="cart-item-name">${esc(item.name)}</div>
              ${item.variation ? `<div class="cart-item-variation">${esc(item.variation)}</div>` : ''}
              ${hasDiscount ? '<div style="color:#2E7D32;font-size:.75rem;">20% bulk discount applied</div>' : ''}
              <button class="cart-item-remove cart-item-remove-inline" onclick="removeFromCart('${key}'); renderCartPage();">Remove</button>
            </div>
          </div>
        </td>
        <td class="cart-item-price">$${(item.price || 0).toFixed(2)}</td>
        <td>
          <div class="cart-item-qty">
            <button onclick="updateCartItemQty('${key}',-1); renderCartPage();">−</button>
            <span>${item.qty}</span>
            <button onclick="updateCartItemQty('${key}',1); renderCartPage();">+</button>
          </div>
        </td>
        <td class="cart-item-total">$${lineTotal.toFixed(2)}</td>
        <td style="text-align:center;">
          <button class="cart-item-remove" onclick="removeFromCart('${key}'); renderCartPage();" title="Remove ${esc(item.name)}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  const subtotal = getCartTotal();
  const shipping = subtotal >= 250 ? 0 : 9.99;
  const summarySubtotal = document.getElementById('summarySubtotal');
  const summaryShipping = document.getElementById('summaryShipping');
  const summaryTotal = document.getElementById('summaryTotal');
  if (summarySubtotal) summarySubtotal.textContent = '$' + subtotal.toFixed(2);
  if (summaryShipping) summaryShipping.textContent = shipping === 0 ? 'Free' : '$' + shipping.toFixed(2);
  if (summaryTotal) summaryTotal.textContent = '$' + (subtotal + shipping).toFixed(2);
}

// ===== CHECKOUT PAGE =====
function getShippingCost() {
  const sel = document.querySelector('input[name="shipping_method"]:checked');
  if (sel && sel.value === 'flat') {
    return +((DB.settings && DB.settings.flatRate) || 9.99);
  }
  return 0;
}

function validateCheckoutForm() {
  let valid = true;
  document.querySelectorAll('.form-error').forEach(el => el.classList.remove('show'));
  document.querySelectorAll('.form-input').forEach(el => el.classList.remove('error'));

  function fail(id, inputId) {
    const errEl = document.getElementById(id);
    if (errEl) errEl.classList.add('show');
    const inp = document.getElementById(inputId);
    if (inp) inp.classList.add('error');
    valid = false;
  }

  if (!cartList().length) return { valid: false, cartEmpty: true };

  const email = document.getElementById('checkoutEmail').value.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('emailError', 'checkoutEmail');

  if (!document.getElementById('firstName').value.trim()) fail('firstNameError', 'firstName');
  if (!document.getElementById('lastName').value.trim()) fail('lastNameError', 'lastName');
  if (!document.getElementById('address').value.trim()) fail('addressError', 'address');
  if (!document.getElementById('city').value.trim()) fail('cityError', 'city');
  if (!document.getElementById('state').value.trim()) fail('stateError', 'state');

  const zip = document.getElementById('zip').value.trim();
  if (!zip || !/^\d{5}(-\d{4})?$/.test(zip)) fail('zipError', 'zip');

  const phone = document.getElementById('phone').value.trim();
  if (!phone) fail('phoneError', 'phone');

  const cardNum = document.getElementById('cardNumber').value.replace(/\s/g, '');
  if (!cardNum || cardNum.length < 13 || !/^\d+$/.test(cardNum)) fail('cardNumberError', 'cardNumber');

  const expiry = document.getElementById('cardExpiry').value.trim();
  if (!expiry || !/^\d{2}\s*\/\s*\d{2}$/.test(expiry)) fail('cardExpiryError', 'cardExpiry');

  const cvv = document.getElementById('cardCvv').value.trim();
  if (!cvv || !/^\d{3,4}$/.test(cvv)) fail('cardCvvError', 'cardCvv');

  if (!document.getElementById('termsCheck').checked) {
    document.getElementById('termsError').classList.add('show');
    valid = false;
  }

  return { valid, cartEmpty: false };
}

function showOrderSuccess(order) {
  const num = document.getElementById('orderNumber');
  if (num) num.textContent = order.id;
  const modal = document.getElementById('successModal');
  if (modal) modal.classList.add('show');
}

function initCheckoutPage() {
  const checkoutForm = document.getElementById('checkoutForm');
  if (!checkoutForm) return;
  renderCheckoutSummary();
  document.querySelectorAll('input[name="shipping_method"]').forEach(r => {
    r.addEventListener('change', renderCheckoutSummary);
  });

  checkoutForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = validateCheckoutForm();
    if (v.cartEmpty) { showAuthMsg('Your cart is empty.'); return; }
    if (!v.valid) {
      const firstErr = document.querySelector('.form-input.error');
      if (firstErr) { firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstErr.focus(); }
      return;
    }

    const btn = checkoutForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Placing order…'; }

    saveOrder()
      .then(order => clearCart().then(() => order))
      .then((order) => {
        updateCartCount();
        renderCheckoutSummary();
        showOrderSuccess(order);
      })
      .catch((err) => {
        if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
        showAuthMsg(err && err.message || 'Could not place your order. Please try again.');
      });
  });
}

function saveOrder() {
  const form = document.getElementById('checkoutForm');
  const cart = cartList();
  if (!cart.length) return Promise.reject(new Error('Your cart is empty.'));
  const subtotal = getCartTotal();
  const shipping = getShippingCost();
  const taxRate = +((DB.settings && DB.settings.taxRate) || 0);
  const tax = Math.round((subtotal + shipping) * taxRate * 100) / 100;
  const total = subtotal + shipping + tax;
  const name = (form.querySelector('#firstName')?.value || '') + ' ' + (form.querySelector('#lastName')?.value || '');
  const email = form.querySelector('#checkoutEmail')?.value || '';
  const order = {
    id: 'ORD-' + Date.now().toString(36).toUpperCase(),
    customerId: DB.user ? DB.user.uid : 'guest',
    customer: (DB.user && DB.user.name) || name.trim() || 'Guest Customer',
    email: (email || (DB.user && DB.user.email) || '').trim(),
    date: new Date().toISOString(),
    items: cart.map(it => ({ name: it.name, variation: it.variation || '', qty: it.qty, price: it.price || 0 })),
    subtotal,
    shipping,
    tax,
    total,
    address: (form.querySelector('#address')?.value || '').trim(),
    city: (form.querySelector('#city')?.value || '').trim(),
    state: (form.querySelector('#state')?.value || '').trim(),
    zip: (form.querySelector('#zip')?.value || '').trim(),
    phone: (form.querySelector('#phone')?.value || '').trim(),
    status: 'processing',
    payment: 'Card ···· 4242',
    method: 'Credit Card'
  };
  if (!DB.user) order.isGuest = true;
  return PDB.setDoc('orders', order.id, order, { merge: false }).then(() => {
    if (window.PurityMail) PurityMail.sendOrder(order);
    return order;
  });
}

function renderCheckoutSummary() {
  const container = document.getElementById('checkoutSummaryItems');
  if (!container) return;
  const cart = cartList();

  container.innerHTML = cart.map(item => {
    const hasDiscount = item.qty >= 4;
    const lineTotal = hasDiscount ? item.price * item.qty * 0.8 : item.price * item.qty;
    return `
    <div class="checkout-product">
      <img src="${esc(item.image)}" alt="${esc(item.name)}" class="checkout-product-img">
      <div class="checkout-product-name">${esc(item.name)}${item.variation ? ' (' + esc(item.variation) + ')' : ''}${hasDiscount ? ' <span style="color:#2E7D32;font-size:.75rem;">(20% off)</span>' : ''}</div>
      <span class="checkout-product-qty">×${item.qty}</span>
      <span class="checkout-product-price">$${lineTotal.toFixed(2)}</span>
    </div>
    `;
  }).join('');

  const subtotal = getCartTotal();
  const shipping = getShippingCost();
  const taxRate = +((DB.settings && DB.settings.taxRate) || 0);
  const tax = Math.round((subtotal + shipping) * taxRate * 100) / 100;
  const total = subtotal + shipping + tax;

  const fill = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  fill('checkoutSubtotal', '$' + subtotal.toFixed(2));
  fill('checkoutShipping', shipping === 0 ? 'FREE' : '$' + shipping.toFixed(2));
  fill('checkoutTax', '$' + tax.toFixed(2));
  fill('checkoutTotal', '$' + total.toFixed(2));
}

// ===== LIVE STOREFRONT (products from Firestore) =====
function productPriceHTML(p) {
  const num = (n) => (+n || 0).toFixed(2);
  if (p.priceTo > 0 && p.priceFrom > 0) return '<span class="woocommerce-Price-amount">$' + num(p.priceFrom) + ' — ' + num(p.priceTo) + '</span>';
  if (p.compare > 0) return '<del><span class="woocommerce-Price-amount">$' + num(p.compare) + '</span></del><span class="woocommerce-Price-amount">$' + num(p.price) + '</span>';
  return '<span class="woocommerce-Price-amount">$' + num(p.price) + '</span>';
}

function cardHTML(prod) {
  const inPages = /\/pages\//.test(location.pathname);
  const price = () => {
    if (prod.priceTo > 0 && prod.priceFrom > 0) return '$' + (+prod.priceFrom).toFixed(2) + ' — ' + (+prod.priceTo).toFixed(2);
    return '$' + (+(prod.price || prod.priceFrom)).toFixed(2);
  };
  const link = (inPages ? '' : 'pages/') + 'product.html?slug=' + encodeURIComponent(prod.slug);
  const rawImg = prod.image || '';
  const img = rawImg.indexOf('http') === 0 ? rawImg : (inPages ? '../images/' : 'images/') + rawImg.split('/').pop();
  const section = prod.cat === 'sprays' ? 'NASAL SPRAYS' : (prod.cat === 'pills' ? 'PILLS' : 'ALL PEPTIDES');
  return `        <div class="product-card">
          <div class="product-img-wrap">
            <span class="product-badge">Sale!</span>
            <a href="${link}" class="product-link"></a>
            <img src="${img}" alt="${esc(prod.name)}" loading="lazy">
            <div class="product-hover-actions">
              <a href="#" class="hover-action-btn" aria-label="Add to wishlist"><i class="fa-regular fa-heart"></i></a>
              <a href="#" class="hover-action-btn" aria-label="Quick view"><i class="fa-solid fa-magnifying-glass"></i></a>
            </div>
            <div class="product-addtocart">
              <a href="${link}" class="addtocart-btn"><i class="fa-solid fa-bag-shopping"></i> <span>Select options</span></a>
            </div>
          </div>
          <div class="product-info">
            <div class="product-info-left">
              <span class="product-cat">${section}</span>
              <a href="${link}" class="product-name"><h3>${esc(prod.name)}</h3></a>
            </div>
            <div class="product-info-right">
              <span class="price"><span class="woocommerce-Price-amount">${price()}</span></span>
            </div>
          </div>
        </div>`;
}

function findGridByMarker(markerText) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
  let node;
  while (node = walker.nextNode()) {
    if ((node.nodeValue || '').indexOf(markerText) !== -1 && node.parentElement) return node.parentElement;
  }
  return null;
}

function byPos(a, b) { return (+a.pos || 0) - (+b.pos || 0); }

function initLiveStorefront() {
  if (!PDB.ready) return;

  initLiveProduct();

  const grids = [
    ['DATA:grid-start',        p => p.cat !== 'sprays' && p.cat !== 'pills'],
    ['DATA:peptide-grid-start', p => p.cat !== 'sprays' && p.cat !== 'pills'],
    ['DATA:spray-grid-start',   p => p.cat === 'sprays'],
    ['DATA:pills-grid-start',   p => p.cat === 'pills']
  ].map(([marker, fn]) => ({ el: findGridByMarker(marker), fn })).filter(g => g.el);
  if (!grids.length) return;

  PDB.getColCached('products', (list) => {
    const prods = (list || []).filter(p => p.status !== 'hidden' && p.slug);
    const empty = '<p style="text-align:center;color:#6b7280;padding:40px 0;">The catalog is being prepared — check back soon.</p>';
    grids.forEach(g => {
      g.el.innerHTML = prods.filter(g.fn).sort(byPos).map(cardHTML).join('\n') || empty;
    });
    updateWishlistFlags();
  });
}

function initLiveProduct() {
  const single = document.querySelector('.product-single');
  if (!single) return;
  const qm = /[?&]slug=([^&]+)/.exec(location.search || '');
  const slug = (qm ? decodeURIComponent(qm[1]) : '') || (location.pathname.split('/').pop() || '').replace(/\.html$/, '') || '';
  if (!slug) return;
  single.setAttribute('data-slug', slug);

  PDB.watchDoc('products', slug, (p) => {
    if (!p) return;
    const name = p.name || slug;
    if (!single.classList.contains('product-ready')) single.classList.add('product-ready');

    document.title = name + ' - Purity Labs';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', name + ' - Purity Labs research compound. Available in multiple sizes.');

    const titleEl = single.querySelector('.product-summary-title');
    if (titleEl) titleEl.textContent = name;

    const crumb = single.querySelector('.product-breadcrumb .container');
    if (crumb) {
      const isSpray = p.cat === 'sprays';
      crumb.innerHTML = '<a href="../index.html">Home</a><span class="sep">/</span>' +
        '<a href="' + (isSpray ? 'nasal-sprays.html' : 'all-peptides.html') + '">' + (isSpray ? 'Nasal Sprays' : 'All Peptides') + '</a>' +
        '<span class="sep">/</span>' + esc(name);
    }

    const priceEl = single.querySelector('.product-summary-price');
    if (priceEl) priceEl.innerHTML = productPriceHTML(p);

    const mainImg = single.querySelector('.product-gallery-main img');
    if (mainImg && p.image) {
      const raw = String(p.image);
      const src = raw.indexOf('http') === 0 ? raw : '../images/' + raw.split('/').pop();
      if ((mainImg.getAttribute('src') || '') !== src) {
        mainImg.classList.add('product-img-loading');
        mainImg.onload = () => mainImg.classList.remove('product-img-loading');
        mainImg.setAttribute('src', src);
        mainImg.alt = name;
      }
    }

    const skuB = single.querySelector('.product-summary-sku b');
    if (skuB && p.sku) skuB.textContent = p.sku;

    const btn = single.querySelector('.product-single .btn-add-to-cart');
    if (btn && !(p.stock > 0)) {
      btn.disabled = true;
      btn.style.opacity = '.45';
      btn.style.cursor = 'not-allowed';
      btn.innerHTML = '<i class="fa-solid fa-ban"></i> Out of stock';
    }

    const desc = single.querySelector('.product-description');
    if (desc) {
      desc.innerHTML = '<h3>Description</h3>' +
        (p.desc ? '<p>' + String(p.desc).replace(/\r?\n+/g, '</p><p>') + '</p>' : '<p>' + esc(name) + '</p>') +
        '<p><strong>Research Use Only:</strong> This product is intended solely for laboratory research. Not for human consumption or therapeutic use.</p>';
    }

    const relSection = single.querySelector('#relatedSection');
    const relGrid = single.querySelector('#relatedProducts');
    if (relGrid) {
      const rel = Array.isArray(p.related) ? p.related.slice(0, 4) : [];
      relGrid.innerHTML = '';
      if (!rel.length) {
        if (relSection) relSection.style.display = 'none';
      } else {
        PDB.getColCached('products').then(list => {
          const map = (list || []).filter(x => x.status !== 'hidden' && x.slug);
          const cards = rel.map(s => map.find(x => x.slug === s)).filter(Boolean).map(cardHTML);
          if (cards.length) {
            relGrid.innerHTML = cards.join('\n');
            updateWishlistFlags();
          } else if (relSection) {
            relSection.style.display = 'none';
          }
        }).catch(() => { if (relSection) relSection.style.display = 'none'; });
      }
    }

    const currentCat = p.cat === 'sprays' ? 'nasal-sprays.html' : (p.cat === 'pills' ? 'pills.html' : 'all-peptides.html');
    document.querySelectorAll('.nav .dropdown a, .mobile-sub-menu a').forEach(a => {
      if ((a.getAttribute('href') || '').indexOf(currentCat) !== -1) a.classList.add('current');
    });
  });
}

// ===== LIVE COA PAGE (products from Firestore, admin-controlled) =====
function coaImg(rel) {
  const s = String(rel || '');
  if (s.indexOf('http') === 0) return s;
  return '../' + s.replace(/^(\.\.\/)+/, '');
}

function coaUrls(p, depth) {
  const pre = '../'.repeat(depth);
  return (p.coas || [])
    .map(u => { const s = String(u || '').trim(); return s ? (s.indexOf('http') === 0 ? s : pre + s.replace(/^(\.\.\/)+/, '')) : ''; })
    .filter(Boolean);
}

function initLiveCOAs() {
  const list = document.getElementById('coaList');
  if (!list || !PDB.ready) return;
  const search = document.getElementById('coaSearch');
  let term = '';
  let products = [];
  const draw = () => {
    const shown = products
      .filter(p => p.status !== 'hidden' && p.coaEnabled && p.coas && p.coas.length)
      .sort(byPos)
      .filter(p => !term || ((p.name || '') + ' ' + (p.slug || '')).toLowerCase().indexOf(term) !== -1);
    if (!shown.length) {
      list.innerHTML = '<p class="coa-empty">' + (term ? 'No products match "' + esc(term) + '".' : 'No certificates are listed yet.') + '</p>';
      return;
    }
    list.innerHTML = shown.map(p => `
      <div class="coa-row" data-name="${esc(p.slug)}">
        <div class="coa-thumb"><img src="${esc(coaImg(p.image))}" alt="${esc(p.name)} - Product" loading="lazy"></div>
        <div class="coa-product-info">
          <span class="coa-label">Product Name</span>
          <div class="coa-product-name">${esc(p.name)}</div>
        </div>
        <div class="coa-buttons">
          <a href="#" class="coa-btn coa-open" data-coa="${esc(coaUrls(p, 1).join('|'))}" data-title="${esc(p.name)}">COA</a>
        </div>
      </div>`).join('');
  };
  if (search) search.addEventListener('input', (e) => { term = e.target.value.toLowerCase().trim(); draw(); });
  PDB.getColCached('products', (list2) => { products = list2 || []; draw(); });
}

// ===== COA LIGHTBOX =====
let coaLightbox = null;
let coaImgs = [];
let coaIdx = 0;

function coaEnsureLB() {
  coaLightbox = document.getElementById('coaLightbox');
  if (!coaLightbox) {
    coaLightbox = document.createElement('div');
    coaLightbox.id = 'coaLightbox';
    coaLightbox.className = 'coa-lightbox';
    coaLightbox.setAttribute('aria-hidden', 'true');
    coaLightbox.innerHTML =
      '<div class="coa-lb-overlay" data-coa-close></div>' +
      '<button type="button" class="coa-lb-close" data-coa-close aria-label="Close">&times;</button>' +
      '<button type="button" class="coa-lb-nav coa-lb-prev" aria-label="Previous">&#10094;</button>' +
      '<button type="button" class="coa-lb-nav coa-lb-next" aria-label="Next">&#10095;</button>' +
      '<div class="coa-lb-stage"></div>' +
      '<div class="coa-lb-counter"></div>';
    document.body.appendChild(coaLightbox);
  }
  if (coaLightbox._coaWired) return true;
  coaLightbox._coaWired = true;
  coaLightbox.addEventListener('click', function (e) {
    if (e.target.closest('[data-coa-close]')) coaClose();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') coaClose();
  });
  coaLightbox.querySelector('.coa-lb-prev').addEventListener('click', function () { coaStep(-1); });
  coaLightbox.querySelector('.coa-lb-next').addEventListener('click', function () { coaStep(1); });
  return true;
}

function coaRender() {
  const stage = coaLightbox.querySelector('.coa-lb-stage');
  const img = document.createElement('img');
  img.className = 'coa-lb-media';
  img.src = coaImgs[coaIdx];
  stage.innerHTML = '';
  stage.appendChild(img);
  const counter = coaLightbox.querySelector('.coa-lb-counter');
  if (counter) {
    counter.textContent = coaImgs.length > 1 ? (coaIdx + 1) + ' / ' + coaImgs.length : '';
  }
  coaLightbox.querySelector('.coa-lb-prev').hidden = coaImgs.length < 2;
  coaLightbox.querySelector('.coa-lb-next').hidden = coaImgs.length < 2;
}

function coaStep(dir) {
  if (coaImgs.length < 2) return;
  coaIdx = (coaIdx + dir + coaImgs.length) % coaImgs.length;
  coaRender();
}

function coaOpen(imgs) {
  if (!imgs || !imgs.length) return;
  coaEnsureLB();
  coaImgs = imgs;
  coaIdx = 0;
  coaRender();
  coaLightbox.classList.add('is-open');
  coaLightbox.setAttribute('aria-hidden', 'false');
}

function coaClose() {
  if (!coaLightbox) return;
  coaLightbox.classList.remove('is-open');
  coaLightbox.setAttribute('aria-hidden', 'true');
  const stage = coaLightbox.querySelector('.coa-lb-stage');
  if (stage) stage.innerHTML = '';
}

// Delegated, so dynamically-rendered COA buttons (admin-driven COA page) work too.
document.addEventListener('click', function (e) {
  const btn = e.target.closest('.coa-btn[data-coa]');
  if (!btn) return;
  e.preventDefault();
  const imgs = (btn.getAttribute('data-coa') || '').split('|').filter(Boolean);
  coaOpen(imgs);
});

// ===== BACK TO TOP =====
const backToTop = document.createElement('button');
backToTop.className = 'back-to-top';
backToTop.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
backToTop.setAttribute('aria-label', 'Back to top');
document.body.appendChild(backToTop);
backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
window.addEventListener('scroll', () => {
  backToTop.classList.toggle('visible', window.scrollY > 400);
});

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  updateCartCount();
  renderSideCart();
  initCartPage();
  initCheckoutPage();
  startFirebase();
  initLiveStorefront();
  initLiveCOAs();
  startEmailConfig();
});
/* ===== PURITY LABS STOREFRONT — Firestore backed =====
   Cart, wishlist, accounts and orders live in Firestore (via pdb.js).
   Guests are prompted to sign in before adding items to cart / wishlist.
*/

// ===== AGE GATE =====
document.addEventListener('DOMContentLoaded', () => {
  const ageGate = document.getElementById('ageGate');
  const ageYes = document.getElementById('ageYes');
  const ageNo = document.getElementById('ageNo');
  const rememberMe = document.querySelector('.age-gate-remember input');

  if (!ageGate || !ageYes || !ageNo) return;

  if (rememberMe?.checked) {
    if (localStorage.getItem('ageVerified')) ageGate.classList.add('hidden');
  } else {
    if (sessionStorage.getItem('ageVerified')) ageGate.classList.add('hidden');
  }

  ageYes.addEventListener('click', () => {
    if (rememberMe?.checked) localStorage.setItem('ageVerified', '1');
    else sessionStorage.setItem('ageVerified', '1');
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

// ===== NEWSLETTER FORM =====
const newsletterForm = document.getElementById('newsletterForm');
if (newsletterForm) {
  newsletterForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const input = this.querySelector('input[type="email"]');
    const btn = this.querySelector('button');
    btn.textContent = 'Subscribed!';
    btn.style.background = '#2E7D32';
    input.value = '';
    setTimeout(() => { btn.textContent = 'Subscribe'; btn.style.background = ''; }, 3000);
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

// ===== FIREBASE STATE =====
const DB = { user: null, cart: [], wishlist: [], products: [], settings: {}, content: {} };

// ===== EMAIL CLIENT (Resend via /api) =====
// Hosted on the same Render service, so /api/… works in the browser with no
// extra config. If the storefront is ever hosted somewhere else, set URL before:
//   window.EMAIL_API_BASE = 'https://your-app.onrender.com';
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

// ===== CART SYSTEM (Firestore) =====
function getCart() { return DB.cart; }
function getWishlist() { return DB.wishlist; }

function keyOf(o) {
  const base = (o.slug || o.id || 'item').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return base + (o.variation ? '|' + o.variation : '');
}
function cartCol() { return 'users/' + DB.user.uid + '/cart'; }
function wishCol() { return 'users/' + DB.user.uid + '/wishlist'; }

function getCartTotal() {
  let total = 0;
  DB.cart.forEach(item => {
    let t = (item.price || 0) * (item.qty || 1);
    if (item.qty >= 4) t *= 0.8;
    total += t;
  });
  return total;
}
function getCartCount() {
  return DB.cart.reduce((sum, item) => sum + (item.qty || 1), 0);
}
function updateCartCount() {
  document.querySelectorAll('.cart-count').forEach(el => { el.textContent = getCartCount(); });
}

function requireAuth(msg) {
  if (DB.user) return true;
  showAuthMsg(msg || 'Please sign in to continue.');
  openAccount();
  return false;
}

function addToCart(product) {
  if (!requireAuth('Sign in to add items to your cart.')) return;
  const key = keyOf(product);
  PDB.setDoc(cartCol(), key, {
    slug: product.slug || product.id,
    name: product.name,
    price: moneyNum(product.price),
    image: product.image || '',
    qty: PDB.inc(product.qty || 1),
    variation: product.variation || '',
    addedAt: PDB.ts()
  }, { merge: true }).catch(() => {});
  showAddedNotification(product.name);
  openSideCart();
}
function removeFromCart(key) {
  if (!DB.user) return;
  PDB.delDoc(cartCol(), key).catch(() => {});
}
function updateCartItemQty(key, delta) {
  if (!DB.user) return;
  const item = DB.cart.find(i => i.id === key);
  if (!item) return;
  if (delta < 0 && item.qty <= 1) { removeFromCart(key); return; }
  PDB.setDoc(cartCol(), key, { qty: PDB.inc(delta) }, { merge: true }).catch(() => {});
}
function clearCart() {
  if (!DB.user || !DB.cart.length) return Promise.resolve();
  return Promise.all(DB.cart.map(it => PDB.delDoc(cartCol(), it.id).catch(() => {})));
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
  const cart = DB.cart;

  if (cart.length === 0) {
    container.innerHTML = '<div class="side-cart-empty"><i class="fa-solid fa-bag-shopping"></i><p>Your cart is empty</p></div>';
    if (footer) footer.style.display = 'none';
    return;
  }

  if (footer) footer.style.display = 'block';

  container.innerHTML = cart.map(item => {
    const itemTotal = item.qty >= 4 ? item.price * item.qty * 0.8 : item.price * item.qty;
    const hasDiscount = item.qty >= 4;
    const key = enc(item.id);
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
  const name = card.querySelector('.product-name h3, .product-summary-title')?.textContent?.trim();
  const image = card.querySelector('.product-img-wrap img, .product-gallery-main img')?.src;
  const link = card.querySelector('.product-link, .product-name')?.getAttribute('href') || '';
  const slug = (link.split('/').pop() || '').replace(/\.html$/, '') || (name ? name.toLowerCase().replace(/[^a-z0-9]/g, '-') : 'item');
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
      const priceText = card.querySelector('.product-info-right ins .woocommerce-Price-amount, .product-summary-price ins .woocommerce-Price-amount, .product-summary-price .woocommerce-Price-amount, .product-price .woocommerce-Price-amount')?.textContent;
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

  const checkoutLink = e.target.closest('.cart-checkout-btn, .side-cart-checkout-btn');
  if (checkoutLink) {
    if (!DB.user) {
      e.preventDefault();
      showAuthMsg('Sign in to continue to checkout.');
      openAccount();
    }
  }
});

// ===== ACCOUNT MODAL (Firebase Auth) =====
let authListening = false;

function showAuthMsg(msg) {
  const modal = document.getElementById('accountModal');
  if (!modal) return;
  let p = document.getElementById('accountAuthMsg');
  if (!p) {
    p = document.createElement('p');
    p.id = 'accountAuthMsg';
    p.style.cssText = 'color:#e33548;font-size:.8rem;margin:10px 0 0;text-align:center;display:none;';
    const tabs = modal.querySelector('.account-tabs');
    tabs?.after(p);
  }
  p.textContent = msg;
  p.style.display = 'block';
  setTimeout(() => { p.style.display = 'none'; }, 4200);
}

function openAccount() {
  document.getElementById('accountOverlay')?.classList.add('open');
  document.getElementById('accountModal')?.classList.add('open');
  updateAuthUI();
}
function closeAccount() {
  document.getElementById('accountOverlay')?.classList.remove('open');
  document.getElementById('accountModal')?.classList.remove('open');
}
function updateAuthUI() {
  const user = DB.user;
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loggedIn = document.getElementById('accountLoggedIn');
  if (user) {
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'none';
    if (loggedIn) {
      loggedIn.style.display = 'block';
      const n = document.getElementById('accountName'); if (n) n.textContent = user.name || 'Researcher';
      const et = document.getElementById('accountEmail'); if (et) et.textContent = user.email || '';
    }
  } else {
    if (loginForm) { loginForm.style.display = 'block'; }
    if (registerForm) registerForm.style.display = 'none';
    if (loggedIn) loggedIn.style.display = 'none';
  }
}
function checkLoggedIn() { updateAuthUI(); }

document.addEventListener('click', (e) => {
  if (e.target.closest('#accountBtn')) { openAccount(); return; }
  if (e.target.closest('.account-close') || e.target.id === 'accountOverlay') { closeAccount(); return; }
  if (e.target.closest('.account-tab')) {
    document.querySelectorAll('.account-tab').forEach(t => t.classList.remove('active'));
    e.target.closest('.account-tab').classList.add('active');
    const tab = e.target.closest('.account-tab').dataset.tab;
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    if (loginForm) loginForm.style.display = tab === 'login' ? 'block' : 'none';
    if (registerForm) registerForm.style.display = tab === 'register' ? 'block' : 'none';
    if (document.getElementById('accountLoggedIn')) document.getElementById('accountLoggedIn').style.display = 'none';
    return;
  }
  if (e.target.id === 'accountLogout') {
    PDB.signOut().then(() => { updateAuthUI(); toast('Signed out. See you soon!'); });
    return;
  }
});

document.getElementById('loginForm')?.addEventListener('submit', function (e) {
  e.preventDefault();
  const email = this.querySelector('input[type="email"]').value.trim();
  const pass = this.querySelector('input[type="password"]').value;
  if (!email || !pass) { showAuthMsg('Enter your email and password.'); return; }
  const btn = this.querySelector('button[type="submit"]');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Signing in…';
  PDB.signIn(email, pass).then(() => {
    closeAccount();
    toast('Welcome back! You are signed in.');
  }).catch((err) => {
    showAuthMsg(PDB.authMsg(err));
  }).then(() => {
    btn.disabled = false; btn.textContent = orig;
  });
});

document.getElementById('registerForm')?.addEventListener('submit', function (e) {
  e.preventDefault();
  const name = this.querySelector('input[type="text"]').value.trim();
  const email = this.querySelector('input[type="email"]').value.trim();
  const pass = this.querySelector('input[type="password"]').value;
  if (!name || !email || !pass) { showAuthMsg('Please fill in all fields.'); return; }
  const btn = this.querySelector('button[type="submit"]');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Creating account…';
  PDB.signUp(email, pass)
    .then((user) => PDB.setDoc('users', user.uid, {
      name: name,
      email: email,
      role: 'customer',
      joined: new Date().toISOString(),
      created: PDB.ts()
    }, { merge: false }))
    .then(() => {
      closeAccount();
      toast('Account created. Welcome, ' + name + '!');
      if (window.PurityMail) PurityMail.sendWelcome(name, email);
    })
    .catch((err) => {
      showAuthMsg(PDB.authMsg(err));
    })
    .then(() => {
      btn.disabled = false; btn.textContent = orig;
    });
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
    }
  });
}

// ===== CART PAGE =====
function initCartPage() {
  const cartTable = document.getElementById('cartItemsTable');
  if (cartTable) renderCartPage();
}

function renderCartPage() {
  const cartTable = document.getElementById('cartItemsTable');
  const cartSidebar = document.getElementById('cartSidebar');
  if (!cartTable) return;
  const cart = DB.cart;

  if (cart.length === 0) {
    cartTable.innerHTML = `
      <div class="cart-empty-msg">
        <i class="fa-solid fa-bag-shopping"></i>
        <h3>Your cart is empty</h3>
        <p>Looks like you haven't added any products yet.</p>
        <a href="index.html#products" class="cart-checkout-btn" style="display:inline-block;width:auto;margin-top:16px;">Browse Products</a>
      </div>
    `;
    if (cartSidebar) cartSidebar.style.display = 'none';
    return;
  }

  if (cartSidebar) cartSidebar.style.display = 'block';

  cartTable.innerHTML = `
    <div class="cart-item-row" style="font-weight:600;color:#999;font-size:.8rem;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #ECECEC;padding-bottom:12px;">
      <div>Product</div><div>Price</div><div>Quantity</div><div>Total</div><div></div>
    </div>
    ${cart.map(item => {
      const lineTotal = item.qty >= 4 ? item.price * item.qty * 0.8 : item.price * item.qty;
      const hasDiscount = item.qty >= 4;
      const key = enc(item.id);
      return `
      <div class="cart-item-row">
        <div class="cart-item-product">
          <img src="${esc(item.image)}" alt="${esc(item.name)}" class="cart-item-img">
          <div>
            <div class="cart-item-name">${esc(item.name)}</div>
            ${item.variation ? `<div class="cart-item-variation">${esc(item.variation)}</div>` : ''}
            ${hasDiscount ? '<div style="color:#2E7D32;font-size:.75rem;">20% bulk discount applied</div>' : ''}
          </div>
        </div>
        <div class="cart-item-price">$${(item.price || 0).toFixed(2)}</div>
        <div class="cart-item-qty">
          <button onclick="updateCartItemQty('${key}',-1); renderCartPage();">−</button>
          <span>${item.qty}</span>
          <button onclick="updateCartItemQty('${key}',1); renderCartPage();">+</button>
        </div>
        <div class="cart-item-total">$${lineTotal.toFixed(2)}</div>
        <button class="cart-item-remove" onclick="removeFromCart('${key}'); renderCartPage();">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      `;
    }).join('')}
  `;

  if (cartSidebar) {
    const subtotal = getCartTotal();
    const shipping = subtotal >= 250 ? 0 : 9.99;
    const total = subtotal + shipping;
    cartSidebar.innerHTML = `
      <h3>Order Summary</h3>
      <div class="cart-sidebar-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
      <div class="cart-sidebar-row"><span>Shipping</span><span>${shipping === 0 ? 'Free' : '$' + shipping.toFixed(2)}</span></div>
      ${shipping > 0 ? `<div style="font-size:.78rem;color:#999;margin-top:4px;">Free shipping on orders over $250</div>` : ''}
      <div class="cart-sidebar-row total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
      <div class="cart-promo">
        <input type="text" placeholder="Coupon code">
        <button>Apply</button>
      </div>
      <a href="checkout.html" class="cart-checkout-btn">Proceed to Checkout</a>
      <a href="index.html#products" class="cart-continue-link">← Continue Shopping</a>
    `;
  }
}

// ===== CHECKOUT PAGE =====
function initCheckoutPage() {
  const checkoutForm = document.getElementById('checkoutForm');
  if (!checkoutForm) return;
  renderCheckoutSummary();

  checkoutForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!DB.user) { showAuthMsg('Sign in to complete your order.'); openAccount(); return; }
    const required = checkoutForm.querySelectorAll('[required]');
    let valid = true;
    required.forEach(f => {
      if (!f.value.trim()) { f.style.borderColor = '#e33548'; valid = false; }
      else { f.style.borderColor = '#ECECEC'; }
    });
    const terms = checkoutForm.querySelector('#termsCheck');
    if (terms && !terms.checked) {
      terms.parentElement.style.color = '#e33548';
      valid = false;
    }
    if (!valid) return;

    const btn = checkoutForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Placing order…'; }

    saveOrder().then(() => {
      clearCart();
      const formEl = document.getElementById('checkoutForm');
      if (formEl) formEl.style.display = 'none';
      const gridEl = document.getElementById('checkoutGrid');
      if (gridEl) gridEl.style.display = 'none';
      const okEl = document.getElementById('checkoutSuccess');
      if (okEl) okEl.style.display = 'block';
      updateCartCount();
    }).catch((err) => {
      if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
      showAuthMsg(err && err.message || 'Could not place your order. Please try again.');
    });
  });
}

function saveOrder() {
  const form = document.getElementById('checkoutForm');
  const cart = DB.cart;
  if (!cart.length || !DB.user) return Promise.reject(new Error('Your cart is empty.'));
  const subtotal = getCartTotal();
  const shipping = subtotal >= 250 ? 0 : 9.99;
  const total = subtotal + shipping;
  const name = (form.querySelector('#firstName')?.value || '') + ' ' + (form.querySelector('#lastName')?.value || '');
  const email = form.querySelector('#checkoutEmail')?.value || '';
  const order = {
    id: 'ORD-' + Date.now().toString(36).toUpperCase(),
    customerId: DB.user.uid,
    customer: DB.user.name || (name.trim() || 'Store Customer'),
    email: DB.user.email || email,
    date: new Date().toISOString(),
    items: cart.map(it => ({ name: it.name, variation: it.variation || '', qty: it.qty, price: it.price || 0 })),
    subtotal,
    shipping,
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
  return PDB.setDoc('orders', order.id, order, { merge: false }).then(() => {
    if (window.PurityMail) PurityMail.sendOrder(order);
    return order;
  });
}

function renderCheckoutSummary() {
  const container = document.getElementById('checkoutSummaryItems');
  const totals = document.getElementById('checkoutSummaryTotals');
  if (!container) return;
  const cart = DB.cart;

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
  const shipping = subtotal >= 250 ? 0 : 9.99;
  const tax = 0;
  const total = subtotal + shipping + tax;

  if (totals) {
    totals.innerHTML = `
      <div class="checkout-totals-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
      <div class="checkout-totals-row"><span>Shipping</span><span>${shipping === 0 ? 'Free' : '$' + shipping.toFixed(2)}</span></div>
      <div class="checkout-totals-row"><span>Tax</span><span>$${tax.toFixed(2)}</span></div>
      <div class="checkout-totals-row total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
    `;
  }
}

// ===== LIVE STOREFRONT (products from Firestore) =====
function productPriceHTML(p) {
  const num = (n) => (+n || 0).toFixed(2);
  if (p.priceTo > 0 && p.priceFrom > 0) return '<span class="woocommerce-Price-amount">$' + num(p.priceFrom) + ' — ' + num(p.priceTo) + '</span>';
  if (p.compare > 0) return '<del><span class="woocommerce-Price-amount">$' + num(p.compare) + '</span></del><span class="woocommerce-Price-amount">$' + num(p.price) + '</span>';
  return '<span class="woocommerce-Price-amount">$' + num(p.price) + '</span>';
}

function cardHTML(prod, isSpray) {
  const price = () => {
    if (prod.priceTo > 0 && prod.priceFrom > 0) return '$' + (+prod.priceFrom).toFixed(2) + ' — ' + (+prod.priceTo).toFixed(2);
    return '$' + (+(prod.price || prod.priceFrom)).toFixed(2);
  };
  const link = isSpray ? 'products/' + prod.slug + '.html' : 'pages/products/' + prod.slug + '.html';
  const rawImg = prod.image || '';
  const img = rawImg.indexOf('http') === 0 ? rawImg : (isSpray ? '../images/' + rawImg.split('/').pop() : 'images/' + rawImg.split('/').pop());
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
              <span class="product-cat">${isSpray ? 'NASAL SPRAYS' : 'ALL PEPTIDES'}</span>
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

  const homeGrid = findGridByMarker('DATA:grid-start');
  const sprayGrid = findGridByMarker('DATA:spray-grid-start');
  if (!homeGrid && !sprayGrid) return;

  PDB.watchCol('products', (list) => {
    const prods = (list || []).filter(p => p.status !== 'hidden' && p.slug);
    const empty = '<p style="text-align:center;color:#6b7280;padding:40px 0;">The catalog is being prepared — check back soon.</p>';
    if (homeGrid) {
      homeGrid.innerHTML = prods.filter(p => p.cat !== 'sprays').sort(byPos).map(p => cardHTML(p, false)).join('\n') || empty;
    }
    if (sprayGrid) {
      sprayGrid.innerHTML = prods.filter(p => p.cat === 'sprays').sort(byPos).map(p => cardHTML(p, true)).join('\n') || empty;
    }
    updateWishlistFlags();
  });
}

function initLiveProduct() {
  const sum = document.querySelector('.product-summary-price');
  if (!sum) return;
  const slug = (location.pathname.split('/').pop() || '').replace(/\.html$/, '') || '';
  if (!slug) return;
  PDB.watchDoc('products', slug, (p) => {
    if (!p) return;
    const priceEl = document.querySelector('.product-summary-price');
    if (priceEl) priceEl.innerHTML = productPriceHTML(p);
    const mainImg = document.querySelector('.product-gallery-main img');
    if (mainImg && p.image && p.image.indexOf('http') === 0) mainImg.src = p.image;
    const skuB = document.querySelector('.product-summary-sku b');
    if (skuB && p.sku) skuB.textContent = p.sku;
    const btn = document.querySelector('.product-single .btn-add-to-cart');
    if (btn && !(p.stock > 0)) {
      btn.disabled = true;
      btn.style.opacity = '.45';
      btn.style.cursor = 'not-allowed';
      btn.innerHTML = '<i class="fa-solid fa-ban"></i> Out of stock';
    }
    const anchor = document.querySelector('.product-bulk-savings');
    if (anchor) {
      let row = document.querySelector('.product-single .product-coa-row');
      const imgs = coaUrls(p, 2);
      if (p.coaEnabled && imgs.length) {
        if (!row) {
          row = document.createElement('div');
          row.className = 'product-coa-row';
          anchor.after(row);
        }
        row.innerHTML = '<a href="#" class="coa-btn coa-open" data-coa="' + esc(imgs.join('|')) + '" data-title="' + esc(p.name) + '"><i class="fa-solid fa-file-lines"></i> View Certificate of Analysis</a>';
      } else if (row) {
        row.parentElement.removeChild(row);
      }
    }
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
  PDB.watchCol('products', (list2) => { products = list2 || []; draw(); });
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

// Delegated, so dynamically-rendered COA buttons (admin-driven COA page + product pages) work too.
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
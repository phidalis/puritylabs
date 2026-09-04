// ===== AGE GATE =====
document.addEventListener('DOMContentLoaded', () => {
  const ageGate = document.getElementById('ageGate');
  const ageYes = document.getElementById('ageYes');
  const ageNo = document.getElementById('ageNo');
  const rememberMe = document.querySelector('.age-gate-remember input');

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
  if (window.scrollY > 50) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
});

// ===== MOBILE NAV =====
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mobileNav = document.getElementById('mobileNav');
const mobileNavClose = document.getElementById('mobileNavClose');

mobileMenuBtn.addEventListener('click', () => {
  mobileNav.classList.add('open');
});

mobileNavClose.addEventListener('click', () => {
  mobileNav.classList.remove('open');
});

document.querySelectorAll('.mobile-nav-link, .mobile-sub-menu a').forEach(link => {
  link.addEventListener('click', () => {
    mobileNav.classList.remove('open');
  });
});

document.addEventListener('click', (e) => {
  if (mobileNav.classList.contains('open') && !mobileNav.contains(e.target) && e.target !== mobileMenuBtn && !mobileMenuBtn.contains(e.target)) {
    mobileNav.classList.remove('open');
  }
});

// ===== SEARCH OVERLAY =====
const searchBtn = document.getElementById('searchBtn');
const searchOverlay = document.getElementById('searchOverlay');
const searchClose = document.getElementById('searchClose');

searchBtn.addEventListener('click', () => {
  searchOverlay.classList.add('open');
  setTimeout(() => searchOverlay.querySelector('.search-input').focus(), 300);
});

searchClose.addEventListener('click', () => {
  searchOverlay.classList.remove('open');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && searchOverlay.classList.contains('open')) {
    searchOverlay.classList.remove('open');
  }
});

// ===== SEARCH FORM (client-side filter) =====
const searchForm = document.querySelector('.search-form');
if (searchForm) {
  searchForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const query = this.querySelector('.search-input').value.trim().toLowerCase();
    if (!query) return;
    const productCards = document.querySelectorAll('.product-card');
    if (productCards.length > 0) {
      productCards.forEach(card => {
        const name = card.querySelector('.product-name h3')?.textContent?.toLowerCase() || '';
        card.closest('.product-card')?.closest('div')?.style.setProperty('display', name.includes(query) ? '' : 'none');
      });
      document.getElementById('searchOverlay').classList.remove('open');
    } else {
      window.location.href = 'index.html#products';
    }
  });
}

// ===== NEWSLETTER FORM =====
const newsletterForm = document.getElementById('newsletterForm');
if (newsletterForm) {
  newsletterForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const input = this.querySelector('input[type="email"]');
    const btn = this.querySelector('button');
    btn.textContent = 'Subscribed!';
    btn.style.background = '#2E7D32';
    input.value = '';
    setTimeout(() => { btn.textContent = 'Subscribe'; btn.style.background = ''; }, 3000);
  });
}

// ===== CART SYSTEM (localStorage) =====
const CART_KEY = 'purityCart';
const WISHLIST_KEY = 'purityWishlist';

function parsePrice(text) {
  if (!text) return 0;
  const match = text.match(/[\d]+(?:\.[\d]+)?/);
  return match ? parseFloat(match[0]) : 0;
}

function getCart() {
  return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
  renderSideCart();
}
function addToCart(product) {
  const cart = getCart();
  const existing = cart.find(item => item.id === product.id && item.variation === (product.variation || ''));
  if (existing) {
    existing.qty += product.qty || 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      qty: product.qty || 1,
      variation: product.variation || ''
    });
  }
  saveCart(cart);
  showAddedNotification(product.name);
  openSideCart();
}
function removeFromCart(id, variation) {
  let cart = getCart();
  cart = cart.filter(item => !(item.id === id && item.variation === (variation || '')));
  saveCart(cart);
}
function updateCartItemQty(id, variation, delta) {
  const cart = getCart();
  const item = cart.find(i => i.id === id && i.variation === (variation || ''));
  if (item) {
    item.qty = Math.max(1, item.qty + delta);
    saveCart(cart);
  }
}
function getCartTotal() {
  const cart = getCart();
  let total = 0;
  cart.forEach(item => {
    let itemTotal = item.price * item.qty;
    if (item.qty >= 4) itemTotal *= 0.8;
    total += itemTotal;
  });
  return total;
}
function getCartCount() {
  return getCart().reduce((sum, item) => sum + item.qty, 0);
}
function updateCartCount() {
  document.querySelectorAll('.cart-count').forEach(el => {
    el.textContent = getCartCount();
  });
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

// ===== SIDE CART =====
function renderSideCart() {
  const container = document.getElementById('sideCartItems');
  const footer = document.getElementById('sideCartFooter');
  if (!container) return;
  const cart = getCart();

  if (cart.length === 0) {
    container.innerHTML = '<div class="side-cart-empty"><i class="fa-solid fa-bag-shopping"></i><p>Your cart is empty</p></div>';
    if (footer) footer.style.display = 'none';
    return;
  }

  if (footer) footer.style.display = 'block';

  container.innerHTML = cart.map(item => {
    const itemTotal = item.qty >= 4 ? item.price * item.qty * 0.8 : item.price * item.qty;
    const hasDiscount = item.qty >= 4;
    return `
    <div class="side-cart-item">
      <img src="${item.image}" alt="${item.name}" class="side-cart-item-img">
      <div class="side-cart-item-info">
        <div class="side-cart-item-name">${item.name}</div>
        ${item.variation ? `<div class="side-cart-item-variation">${item.variation}</div>` : ''}
        <div class="side-cart-item-price">$${item.price.toFixed(2)}${hasDiscount ? ' <span style="color:#2E7D32;font-size:.75rem;">(20% off)</span>' : ''}</div>
        <div class="side-cart-item-qty">
          <button onclick="updateCartItemQty('${item.id}','${item.variation || ''}',-1)">−</button>
          <span>${item.qty}</span>
          <button onclick="updateCartItemQty('${item.id}','${item.variation || ''}',1)">+</button>
        </div>
      </div>
      <button class="side-cart-item-remove" onclick="removeFromCart('${item.id}','${item.variation || ''}')">
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
  if (shippingFill) {
    const pct = Math.min(100, (subtotal / 250) * 100);
    shippingFill.style.width = pct + '%';
  }
  if (shippingText) {
    if (subtotal >= 250) {
      shippingText.innerHTML = 'You\'ve unlocked <b>free shipping!</b>';
    } else {
      const remaining = (250 - subtotal).toFixed(2);
      shippingText.innerHTML = `Add <b>$${remaining}</b> more for free shipping`;
    }
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
  notif.innerHTML = `<i class="fa-solid fa-check"></i> ${name} added to cart`;
  notif.classList.add('show');
  setTimeout(() => notif.classList.remove('show'), 2500);
}

// ===== WISHLIST =====
function getWishlist() {
  return JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]');
}
function toggleWishlist(btn, product) {
  const list = getWishlist();
  const idx = list.findIndex(i => i.id === product.id);
  if (idx > -1) {
    list.splice(idx, 1);
    btn.classList.remove('active');
  } else {
    list.push(product);
    btn.classList.add('active');
  }
  localStorage.setItem(WISHLIST_KEY, JSON.stringify(list));
}

// ===== PRODUCT CARD EVENT DELEGATION =====
document.addEventListener('click', (e) => {
  const addBtn = e.target.closest('.addtocart-btn, .btn-add-to-cart');
  if (addBtn) {
    e.preventDefault();
    const card = addBtn.closest('.product-card, .product-summary');
    if (!card) return;

    const name = card.querySelector('.product-name h3, .product-summary-title')?.textContent?.trim();
    const image = card.querySelector('.product-img-wrap img, .product-gallery-main img')?.src;

    const activeVar = card.querySelector('.variation-option.active');
    let finalPrice = 0;

    if (activeVar && activeVar.dataset.price) {
      finalPrice = parseFloat(activeVar.dataset.price);
    } else {
      const priceText = card.querySelector('.product-info-right ins .woocommerce-Price-amount, .product-summary-price ins .woocommerce-Price-amount, .product-summary-price .woocommerce-Price-amount, .product-price .woocommerce-Price-amount')?.textContent;
      finalPrice = parsePrice(priceText);
    }

    const variation = activeVar ? activeVar.textContent.trim() : '';

    if (name && finalPrice > 0) {
      addToCart({
        id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name: name,
        price: finalPrice,
        image: image || '',
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
    const name = card.querySelector('.product-name h3')?.textContent?.trim();
    const image = card.querySelector('.product-img-wrap img')?.src;
    toggleWishlist(wishBtn, { id: name?.toLowerCase().replace(/[^a-z0-9]/g, '-'), name, image });
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

// ===== COA LIGHTBOX =====
document.querySelectorAll('.coa-btn').forEach(btn => {
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    const href = this.getAttribute('href');
    if (href === '#') return;
    if (href.endsWith('.pdf')) {
      window.open(href, '_blank');
    } else {
      let lightbox = document.getElementById('coaLightbox');
      if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'coaLightbox';
        lightbox.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:pointer;';
        lightbox.innerHTML = '<img src="" alt="COA" style="max-width:90%;max-height:90%;border-radius:8px;"><button style="position:absolute;top:20px;right:20px;background:none;border:none;color:#fff;font-size:2rem;cursor:pointer;">×</button>';
        lightbox.addEventListener('click', () => lightbox.style.display = 'none');
        document.body.appendChild(lightbox);
      }
      lightbox.querySelector('img').src = href;
      lightbox.style.display = 'flex';
    }
  });
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
});

// Account Modal
function openAccount() {
  document.getElementById('accountOverlay')?.classList.add('open');
  document.getElementById('accountModal')?.classList.add('open');
  checkLoggedIn();
}
function closeAccount() {
  document.getElementById('accountOverlay')?.classList.remove('open');
  document.getElementById('accountModal')?.classList.remove('open');
}
function checkLoggedIn() {
  const user = JSON.parse(localStorage.getItem('purityUser') || 'null');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loggedIn = document.getElementById('accountLoggedIn');
  if (user) {
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'none';
    if (loggedIn) {
      loggedIn.style.display = 'block';
      document.getElementById('accountName').textContent = user.name;
      document.getElementById('accountEmail').textContent = user.email;
    }
  } else {
    if (loginForm) loginForm.style.display = 'block';
    if (registerForm) registerForm.style.display = 'none';
    if (loggedIn) loggedIn.style.display = 'none';
  }
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#accountBtn')) { openAccount(); return; }
  if (e.target.closest('.account-close') || e.target.id === 'accountOverlay') { closeAccount(); return; }
  if (e.target.closest('.account-tab')) {
    document.querySelectorAll('.account-tab').forEach(t => t.classList.remove('active'));
    e.target.closest('.account-tab').classList.add('active');
    const tab = e.target.closest('.account-tab').dataset.tab;
    document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
    document.getElementById('accountLoggedIn').style.display = 'none';
    return;
  }
  if (e.target.id === 'accountLogout') {
    localStorage.removeItem('purityUser');
    checkLoggedIn();
    return;
  }
});

document.getElementById('loginForm')?.addEventListener('submit', function(e) {
  e.preventDefault();
  const email = this.querySelector('input[type="email"]').value;
  const name = email.split('@')[0];
  localStorage.setItem('purityUser', JSON.stringify({ name, email }));
  checkLoggedIn();
});

document.getElementById('registerForm')?.addEventListener('submit', function(e) {
  e.preventDefault();
  const name = this.querySelector('input[type="text"]').value;
  const email = this.querySelector('input[type="email"]').value;
  localStorage.setItem('purityUser', JSON.stringify({ name, email }));
  checkLoggedIn();
});

// ===== CART PAGE =====
function initCartPage() {
  const cartTable = document.getElementById('cartItemsTable');
  if (!cartTable) return;
  renderCartPage();
}

function renderCartPage() {
  const cartTable = document.getElementById('cartItemsTable');
  const cartSidebar = document.getElementById('cartSidebar');
  if (!cartTable) return;
  const cart = getCart();

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
      return `
      <div class="cart-item-row">
        <div class="cart-item-product">
          <img src="${item.image}" alt="${item.name}" class="cart-item-img">
          <div>
            <div class="cart-item-name">${item.name}</div>
            ${item.variation ? `<div class="cart-item-variation">${item.variation}</div>` : ''}
            ${hasDiscount ? '<div style="color:#2E7D32;font-size:.75rem;">20% bulk discount applied</div>' : ''}
          </div>
        </div>
        <div class="cart-item-price">$${item.price.toFixed(2)}</div>
        <div class="cart-item-qty">
          <button onclick="updateCartItemQty('${item.id}','${item.variation || ''}',-1); renderCartPage();">−</button>
          <span>${item.qty}</span>
          <button onclick="updateCartItemQty('${item.id}','${item.variation || ''}',1); renderCartPage();">+</button>
        </div>
        <div class="cart-item-total">$${lineTotal.toFixed(2)}</div>
        <button class="cart-item-remove" onclick="removeFromCart('${item.id}','${item.variation || ''}'); renderCartPage();">
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

    document.getElementById('checkoutForm').style.display = 'none';
    document.getElementById('checkoutGrid').style.display = 'none';
    document.getElementById('checkoutSuccess').style.display = 'block';
    localStorage.removeItem(CART_KEY);
    updateCartCount();
  });
}

function renderCheckoutSummary() {
  const container = document.getElementById('checkoutSummaryItems');
  const totals = document.getElementById('checkoutSummaryTotals');
  if (!container) return;
  const cart = getCart();

  container.innerHTML = cart.map(item => {
    const hasDiscount = item.qty >= 4;
    const lineTotal = hasDiscount ? item.price * item.qty * 0.8 : item.price * item.qty;
    return `
    <div class="checkout-product">
      <img src="${item.image}" alt="${item.name}" class="checkout-product-img">
      <div class="checkout-product-name">${item.name}${item.variation ? ' (' + item.variation + ')' : ''}${hasDiscount ? ' <span style="color:#2E7D32;font-size:.75rem;">(20% off)</span>' : ''}</div>
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

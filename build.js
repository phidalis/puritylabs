/* ===== PURITY LABS SITE GENERATOR =====
   Node.js build script that wires the static site files to data.json.

   Usage:
     node build.js extract   -> read every real page and write data/data.json
     node build.js pages     -> regenerate pages/products/<slug>.html from data.json
     node build.js index     -> regenerate marked sections of index.html
     node build.js sprays    -> regenerate the grid of pages/nasal-sprays.html
     node build.js all       -> extract + pages + index + sprays
*/

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'data.json');
const PROD_DIR = path.join(ROOT, 'pages', 'products');
const PAGES_DIR = path.join(ROOT, 'pages');

/* ---------------- helpers ---------------- */
const read = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const clean = (s) => String(s || '').replace(/\uFFFD/g, '').replace(/\s+/g, ' ').trim();
const cleanText = (s) => clean(s.replace(/<!--[\s\S]*?-->/g, ' '));
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/--+/g, '-');
const moneyNum = (t) => { const m = String(t).match(/\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : 0; };
function unesc(s) {
  let prev, cur = String(s == null ? '' : s);
  let i = 0;
  do {
    prev = cur;
    cur = cur
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
      .replace(/&ndash;/g, '\u2013').replace(/&#x2013;/g, '\u2013')
      .replace(/&mdash;/g, '\u2014').replace(/&#x2014;/g, '\u2014')
      .replace(/&nbsp;/g, ' ');
    i++;
  } while (cur !== prev && i < 30);
  return cur;
}

/* Strip template scaffolding out of an extracted description so builds stay
   idempotent: the "<h3>Description</h3>" heading and the static "Research Use
   Only" paragraph come from the pageShell template, not from data. */
function cleanDesc(s) {
  let t = String(s || '')
    .replace(/<h3>Description<\/h3>/g, '')
    .replace(/(<p><strong>Research Use Only:[\s\S]*?<\/p>)\s*/gi, '')
    .trim();
  return t;
}

function loadExistingData() {
  if (!fs.existsSync(DATA_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return null; }
}

/* ================= EXTRACT (files -> data.json) ================= */
function extract() {
  const data = loadExistingData() || { products: [], categories: [], orders: [], customers: [], coupons: [], promo: [], reviews: [], nav: [], content: {}, settings: {}, visits: [] };

  /* --- parse index.html cards --- */
  const indexHtml = read(path.join(ROOT, 'index.html'));
  const gridStart = indexHtml.indexOf('class="products-grid"');
  const trustStart = indexHtml.indexOf('<!-- TRUST BADGES -->');
  const aboutStart = indexHtml.indexOf('<!-- ABOUT -->');
  const gridBlock = indexHtml.slice(gridStart, trustStart > 0 ? trustStart : gridStart + 60000);

  function parseCards(block, linkPrefix) {
    const cards = [];
    const chunks = block.split('class="product-card"').slice(1);
    for (const ch of chunks) {
      const href = /href="([^"]+?\/)?([a-z0-9-]+)\.html"/.exec(ch);
      if (!href) continue;
      const slug = href[2];
      const img = /src="([^"]+?\.(?:webp|png|svg|jpg))"/.exec(ch);
      const name = /<h3>(.*?)<\/h3>/.exec(ch);
      const price = /<span class="price">([\s\S]*?)<\/span>\s*<\/span>/.exec(ch);
      cards.push({
        slug,
        image: img ? img[1].replace(/^\.\.\//, '') : '',
        name: name ? unesc(clean(name[1])) : slug,
        priceText: price ? clean(price[1]) : ''
      });
    }
    return cards;
  }
  const indexCards = parseCards(gridBlock, 'pages/products/');

  const spraysHtml = read(path.join(PAGES_DIR, 'nasal-sprays.html'));
  const sprayGridStart = spraysHtml.indexOf('class="products-grid"');
  const sprayGridBlock = spraysHtml.slice(sprayGridStart, sprayGridStart + 80000);
  const sprayCards = parseCards(sprayGridBlock, '');

  /* --- parse each product page --- */
  const files = fs.readdirSync(PROD_DIR).filter(f => f.endsWith('.html'));
  const pageData = {};
  for (const f of files) {
    const slug = f.replace(/\.html$/, '');
    const html = read(path.join(PROD_DIR, f));
    const priceM = /product-summary-price\s*([\s\S]*?)<\/div>/.exec(html);
    const price = priceM ? moneyNum(priceM[1]) : 0;
    const skuM = /SKU:\s*<b>([^<]+)<\/b>/.exec(html);
    const descM = /<div class="product-description">([\s\S]*?)<\/div>\s*<!-- SHARE -->/.exec(html);
    const relM = /<!-- RELATED PRODUCTS -->([\s\S]*?)<!-- CTA -->/.exec(html);
    const related = [];
    if (relM) {
      const re = /href="([a-z0-9-]+)\.html"/g; let m;
      const seen = new Set();
      while ((m = re.exec(relM[1]))) { if (!seen.has(m[1])) { seen.add(m[1]); related.push(m[1]); } }
    }
    const titleM = /<title>(.*?) - Purity Labs<\/title>/.exec(html);
    pageData[slug] = {
      price,
      sku: skuM ? skuM[1] : '',
      desc: descM ? cleanDesc(descM[1]) : '',
      related,
      name: titleM ? unesc(clean(titleM[1])) : slug
    };
  }
  /* --- build product records --- */
  const spraySet = new Set(sprayCards.map(c => c.slug));
  const products = [];
  const seen = new Set();

  function pushProduct(card) {
    if (seen.has(card.slug)) return;
    seen.add(card.slug);
    const pg = pageData[card.slug] || {};
    let cat = 'powders';
    if (spraySet.has(card.slug)) cat = 'sprays';
    if (card.slug === 'bacteriostatic-water') cat = 'accessories';
    const priceParts = (card.priceText.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => n > 0);
    const priceFrom = priceParts[0] || pg.price || 0;
    const priceTo = priceParts.length > 1 ? priceParts[priceParts.length - 1] : 0;
    products.push({
      id: 'p' + String(products.length + 1).padStart(2, '0'),
      name: card.name || pg.name || card.slug,
      slug: card.slug,
      cat,
      priceFrom, priceTo,
      price: pg.price || priceFrom,
      compare: 0,
      image: card.image || (pg && '' ),
      sku: pg.sku || ('PL-' + card.slug.toUpperCase().replace(/[^A-Z0-9]/g, '')),
      desc: pg.desc || '',
      related: pg.related || [],
      stock: 25, featured: false, status: 'active'
    });
  }

  (indexCards.length ? indexCards : Object.keys(pageData).map(s => ({ slug: s, name: pageData[s].name })))
    .forEach(pushProduct);
  sprayCards.forEach(pushProduct);

  /* any product pages still missing from the grids */
  Object.keys(pageData).forEach(slug => {
    if (!seen.has(slug)) pushProduct({ slug, name: pageData[slug].name });
  });

  /* --- content from index.html --- */
  const topM = /class="top-bar"[\s\S]*?<span>(.*?)<\/span>/.exec(indexHtml);
  const heroSub = /hero-subtitle-text">(.*?)<\/p>/.exec(indexHtml);
  const heroTitle = /hero-title">([\s\S]*?)<\/h1>/.exec(indexHtml);
  const heroBtn = /btn-hero">(.*?)<\/a>/.exec(indexHtml);
  const trustItems = [];
  const trustChunks = indexHtml.slice(indexHtml.indexOf('class="trust-grid"'), indexHtml.indexOf('</section>', indexHtml.indexOf('class="trust-grid"')))
    .split('class="trust-card"').slice(1);
  for (const ch of trustChunks) {
    const t = /<h3>(.*?)<\/h3>/.exec(ch); const p = /<p>(.*?)<\/p>/.exec(ch);
    trustItems.push({ title: t ? cleanText(t[1]) : '', text: p ? cleanText(p[1]) : '' });
  }
  const footerEmail = /footer-email">(.*?)<\/a>/.exec(indexHtml);
  const footerDesc = /footer-desc">(.*?)<\/p>/.exec(indexHtml);

  const content = {
    topbar: topM ? cleanText(topM[1]) : 'FREE SHIPPING STARTS AT $250',
    heroSubtitle: heroSub ? cleanText(heroSub[1]) : 'For In Vitro Research Use Only',
    heroTitle: heroTitle ? cleanText(heroTitle[1]) : 'Precision Research<br>Compounds',
    heroBtn: heroBtn ? clean(heroBtn[1]) : 'SHOP PEPTIDES',
    heroUrl: '#products',
    gridTitle: 'Popular Peptides',
    trust: trustItems.length ? trustItems : [
      { title: 'VERIFIED >99% PURITY', text: 'Every compound undergoes comprehensive testing via HPLC and Mass Spectrometry.' },
      { title: 'SECURE SHIPPING', text: 'Your laboratory materials arrive in protected packaging.' },
      { title: 'DEDICATED SUPPORT', text: 'Knowledgeable team members available for research inquiries.' }
    ],
    footerEmail: footerEmail ? clean(footerEmail[1]) : 'info@puritylabs.org',
    footerDesc: footerDesc ? clean(footerDesc[1]) : ''
  };

  /* --- nav from index.html --- */
  const nav = [];
  const navM = /class="nav" id="nav"([\s\S]*?)<\/nav>/.exec(indexHtml);
  if (navM) {
    const links = navM[1].match(/<a[^>]*class="nav-link"[^>]*>(.*?)<\/a>/g) || [];
    links.forEach((a, i) => {
      const lbl = />(.*?)$/.exec(a.replace(/<[^>]+>/g, '»').replace(/».*/, ''));
      const label = clean(a.replace(/<[^>]*>/g, '')).trim() || 'Link';
      const hrefM = /href="([^"]*)"/.exec(a);
      nav.push({ id: 'n' + (i + 1), label, url: hrefM ? hrefM[1] : '#', pos: i });
    });
    const dd = navM[1].match(/<li><a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a><\/li>/g) || [];
    dd.forEach((a, i) => {
      const label = clean(a.replace(/<[^>]*>/g, ''));
      const hrefM = /href="([^"]*)"/.exec(a);
      nav.push({ id: 'nd' + (i + 1), label, url: hrefM ? hrefM[1] : '#', pos: 100 + i });
    });
  }

  data.products = products;
  data.content = Object.assign({}, data.content, content);
  data.nav = nav.length ? nav : data.nav;

  write(DATA_FILE, JSON.stringify(data, null, 2));
  console.log('extract: wrote ' + DATA_FILE + ' (' + products.length + ' products)');
}

/* ================= GENERATE PRODUCT PAGES ================= */
function pageShell(p, data) {
  const rel = (p.related || []).slice(0, 4).map(slug => prodBy(data, slug)).filter(Boolean);
  const isSpray = p.cat === 'sprays';
  const sprayClass = isSpray ? ' class="current"' : '';
  const galleryBadge = p.compare > 0 ? '<span class="product-gallery-badge">Sale!</span>' : '<span class="product-gallery-badge">Sale!</span>';
  const priceHTML = p.compare > 0
    ? '<del><span class="woocommerce-Price-amount">$' + p.compare.toFixed(2) + '</span></del><span class="woocommerce-Price-amount">$' + p.price.toFixed(2) + '</span>'
    : '<span class="woocommerce-Price-amount">$' + p.price.toFixed(2) + '</span>';

  const relatedHTML = rel.map(r => {
    const img = esc(r.image);
    return `<div class="product-card">
          <div class="product-img-wrap">
            <span class="product-badge">Sale!</span>
            <a href="${esc(r.slug)}.html" class="product-link"></a>
            <img src="../../${img}" alt="${esc(r.name)}" loading="lazy">
            <div class="product-hover-actions">
              <a href="#" class="hover-action-btn" aria-label="Add to wishlist"><i class="fa-regular fa-heart"></i></a>
              <a href="#" class="hover-action-btn" aria-label="Quick view"><i class="fa-solid fa-magnifying-glass"></i></a>
            </div>
            <div class="product-addtocart">
              <a href="${esc(r.slug)}.html" class="addtocart-btn"><i class="fa-solid fa-bag-shopping"></i> <span>Select options</span></a>
            </div>
          </div>
          <div class="product-info">
            <div class="product-info-left">
              <span class="product-cat">${isSpray ? 'NASAL SPRAYS' : 'ALL PEPTIDES'}</span>
              <a href="${esc(r.slug)}.html" class="product-name"><h3>${esc(r.name)}</h3></a>
            </div>
            <div class="product-info-right">
              <span class="price"><span class="woocommerce-Price-amount">$${r.price.toFixed(2)}</span></span>
            </div>
          </div>
        </div>`;
  }).join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/svg+xml" href="../../favicon.svg">
  <meta name="description" content="${esc(p.name)} - Purity Labs research compound. Available in multiple sizes." />
  <title>${esc(p.name)} - Purity Labs</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <link rel="stylesheet" href="../../styles.css">
</head>
<body>

  <!-- AGE VERIFICATION -->
  <div id="ageGate" class="age-gate">
    <div class="age-gate-backdrop"></div>
    <div class="age-gate-modal">
      <span class="age-gate-logo-text">Purity<span>Labs</span></span>
      <p class="age-gate-challenge">Are you over 21 years of age?</p>
      <div class="age-gate-buttons">
        <button id="ageNo" class="age-btn age-btn-no">No</button>
        <button id="ageYes" class="age-btn age-btn-yes">Yes</button>
      </div>
      <label class="age-gate-remember">
        <input type="checkbox" checked> Remember me
      </label>
    </div>
  </div>

  <!-- TOP BAR -->
  <div class="top-bar">
    <div class="container">
      <span>${esc(data.content.topbar)}</span>
    </div>
  </div>

  <!-- HEADER -->
  <header class="header" id="header">
    <div class="container header-inner">
      <a href="../../index.html" class="logo">
        <span class="header-logo-text">Purity<span>Labs</span></span>
      </a>
      <nav class="nav" id="nav">
        <div class="nav-item has-dropdown">
          <a href="../../index.html#products" class="nav-link">All Peptides <i class="fa-solid fa-chevron-down nav-arrow"></i></a>
          <ul class="dropdown">
            <li><a href="../../index.html#products">Shop All Peptides</a></li>
            <li><a href="../nasal-sprays.html"${sprayClass}>Nasal Sprays</a></li>
            <li><a href="../../index.html#products">Pills</a></li>
          </ul>
        </div>
        <a href="../coas.html" class="nav-link">COAs</a>
        <a href="../about.html" class="nav-link">About Us</a>
        <a href="mailto:info@puritylabs.org" class="nav-link">info@puritylabs.org</a>
      </nav>
      <div class="header-actions">
        <button class="icon-btn" id="searchBtn" aria-label="Search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M15.75 14.7188L11.5625 10.5312C12.4688 9.4375 12.9688 8.03125 12.9688 6.5C12.9688 2.9375 10.0312 0 6.46875 0C2.875 0 0 2.9375 0 6.5C0 10.0938 2.90625 13 6.46875 13C7.96875 13 9.375 12.5 10.5 11.5938L14.6875 15.7812C14.8438 15.9375 15.0312 16 15.25 16C15.4375 16 15.625 15.9375 15.75 15.7812C16.0625 15.5 16.0625 15.0312 15.75 14.7188ZM1.5 6.5C1.5 3.75 3.71875 1.5 6.5 1.5C9.25 1.5 11.5 3.75 11.5 6.5C11.5 9.28125 11.5 6.5 11.5 3.71875 11.5 1.5 9.28125 1.5 6.5Z" fill="currentColor"/></svg>
        </button>
        <button class="icon-btn cart-btn" id="cartBtn" aria-label="Cart">
          <svg width="16" height="19" viewBox="0 0 16 19" fill="none"><path d="M14.375 18H1.625V5.25H14.375V18Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 7.5V4.5C5 2.85 6.35 1.5 8 1.5C9.65 1.5 11 2.85 11 4.5V7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="cart-count">0</span>
        </button>
        <button class="icon-btn account-btn" id="accountBtn" aria-label="Account">
          <i class="fa-solid fa-user"></i>
        </button>
        <button class="icon-btn mobile-menu-btn" id="mobileMenuBtn" aria-label="Menu">
          <svg width="20" height="14" viewBox="0 0 22 16" fill="currentColor"><path d="M0 0h22v2H0zM0 7h10v2H0zM0 14h16v2H0z"/></svg>
        </button>
      </div>
    </div>
  </header>

  <!-- MOBILE NAV -->
  <div class="mobile-nav" id="mobileNav">
    <div class="mobile-nav-header">
      <span class="mobile-nav-title">Menu</span>
      <button class="icon-btn" id="mobileNavClose" aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 22 22" fill="currentColor"><path d="M12.592 11.015l8.988-8.939c.43-.426.43-1.117 0-1.542a1.108 1.108 0 0 0-1.558 0l-8.98 8.931L1.977.401A1.1 1.1 0 0 0 .42.4a1.107 1.107 0 0 0 0 1.562l9.057 9.058-9.09 9.039a1.084 1.084 0 0 0 0 1.543c.43.426 1.129.426 1.558 0l9.082-9.032 9.028 9.028a1.1 1.1 0 0 0 1.557 0c.43-.432.43-1.131 0-1.562l-9.02-9.022z" fill-rule="evenodd"/></svg>
      </button>
    </div>
    <div class="mobile-nav-links">
      <div class="mobile-nav-group">
        <a href="../../index.html#products" class="mobile-nav-link">All Peptides</a>
        <ul class="mobile-sub-menu">
          <li><a href="../../index.html#products">Shop All Peptides</a></li>
          <li><a href="../nasal-sprays.html">Nasal Sprays</a></li>
          <li><a href="../../index.html#products">Pills</a></li>
        </ul>
      </div>
      <a href="../coas.html" class="mobile-nav-link">COAs</a>
      <a href="../about.html" class="mobile-nav-link">About Us</a>
      <a href="mailto:info@puritylabs.org" class="mobile-nav-link">info@puritylabs.org</a>
    </div>
  </div>

  <!-- SEARCH OVERLAY -->
  <div class="search-overlay" id="searchOverlay">
    <button class="search-close" id="searchClose" aria-label="Close search">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><path d="M12.592 11.015l8.988-8.939c.43-.426.43-1.117 0-1.542a1.108 1.108 0 0 0-1.558 0l-8.98 8.931L1.977.401A1.1 1.1 0 0 0 .42.4a1.107 1.107 0 0 0 0 1.562l9.057 9.058-9.09 9.039a1.084 1.084 0 0 0 0 1.543c.43.426 1.129.426 1.558 0l9.082-9.032 9.028 9.028a1.1 1.1 0 0 0 1.557 0c.43-.432.43-1.131 0-1.562l-9.02-9.022z" fill-rule="evenodd"/></svg>
    </button>
    <div class="search-content">
      <form class="search-form" role="search" method="get">
        <input name="s" type="search" placeholder="Product Search" autocomplete="off" class="search-input">
        <input type="hidden" name="post_type" value="product">
        <button type="submit" class="search-submit-btn" aria-label="Search">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.962 14.12l4.86 4.86a.6.6 0 0 1-.42 1.02.603.603 0 0 1-.422-.177l-4.86-4.86a8.493 8.493 0 0 1-5.592 2.092C3.827 17.055 0 13.228 0 8.528 0 3.827 3.823 0 8.528 0c4.7 0 8.527 3.823 8.527 8.528 0 2.137-.789 4.093-2.093 5.592zM8.523 1.197c-4.04 0-7.33 3.286-7.33 7.33 0 4.045 3.29 7.336 7.33 7.336 4.045 0 7.33-3.295 7.33-7.335s-3.285-7.33-7.33-7.33z"/></svg>
        </button>
      </form>
    </div>
  </div>

  <!-- BREADCRUMBS -->
  <div class="product-breadcrumb">
    <div class="container">
      <a href="../../index.html">Home</a>
      <span class="sep">/</span>
      <a href="../../index.html#products">All Peptides</a>
      <span class="sep">/</span>
      ${esc(p.name)}
    </div>
  </div>

  <!-- PRODUCT SINGLE -->
  <section class="product-single">
    <div class="container">
      <div class="product-single-grid">

        <!-- IMAGE GALLERY -->
        <div class="product-gallery">
          <div class="product-gallery-main">
            ${galleryBadge}
            <img src="../../${esc(p.image)}" alt="${esc(p.name)}" id="mainProductImage">
          </div>
        </div>

        <!-- PRODUCT SUMMARY -->
        <div class="product-summary">
          <h1 class="product-summary-title">${esc(p.name)}</h1>
          <div class="product-summary-price">
            ${priceHTML}
          </div>
          <div class="product-summary-sku">SKU: <b>${esc(p.sku)}</b></div>

          <!-- QUANTITY + ADD TO CART -->
          <div class="product-quantity-row">
            <div class="quantity-selector">
              <button class="qty-btn" onclick="changeQty(-1)">−</button>
              <input type="number" class="qty-input" id="qtyInput" value="1" min="1" max="10">
              <button class="qty-btn" onclick="changeQty(1)">+</button>
            </div>
            <button class="btn-add-to-cart">
              <i class="fa-solid fa-bag-shopping"></i> Add to cart
            </button>
          </div>

          <!-- BULK SAVINGS -->
          <div class="product-bulk-savings">
            <h4>Buy 4 Save 20% Off</h4>
            <p>Purchase 4 or more units of this product and receive 20% off your order.</p>
          </div>

          <!-- DESCRIPTION -->
          <div class="product-description">
            <h3>Description</h3>
            ${p.desc || '<p>' + esc(p.name) + ' is a research-grade compound manufactured under strict GMP conditions. Each batch is independently tested via HPLC and Mass Spectrometry to verify purity and correct molecular composition.</p>'}
            <p><strong>Research Use Only:</strong> This product is intended solely for laboratory research. Not for human consumption or therapeutic use.</p>
          </div>
          <!-- SHARE -->
          <div class="product-share">
            <span>Share:</span>
            <a href="#" aria-label="Facebook"><i class="fa-brands fa-facebook-f"></i></a>
            <a href="#" aria-label="X"><i class="fa-brands fa-x-twitter"></i></a>
            <a href="#" aria-label="Pinterest"><i class="fa-brands fa-pinterest-p"></i></a>
            <a href="#" aria-label="WhatsApp"><i class="fa-brands fa-whatsapp"></i></a>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- RELATED PRODUCTS -->
  <div class="container">
      <h2 class="related-title">Related Products</h2>
      <div class="products-grid">
      ${relatedHTML}
      </div>
    </div>

  <!-- CTA -->
  <section class="cta">
    <div class="container cta-inner">
      <h2>Advance Your Science Now</h2>
      <p>Discover our selection of verified, high-purity peptides developed for laboratory excellence.</p>
      <a href="../../index.html#products" class="btn-cta">Shop All Peptides</a>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="footer">
    <div class="footer-main">
      <div class="container footer-grid">
        <div class="footer-brand">
          <span class="footer-logo-text">Purity<span>Labs</span></span>
          <p class="footer-desc">${esc(data.content.footerDesc || 'Ultra-pure amino acid derivatives and proteins manufactured for the research community. Thoroughly analyzed, certified >99% purity.')}</p>
          <a href="mailto:${esc(data.content.footerEmail)}" class="footer-email">${esc(data.content.footerEmail)}</a>
        </div>
        <div class="footer-links-col">
          <h4>QUICK LINKS</h4>
          <ul>
            <li><a href="../../account.html">My Account</a></li>
            <li><a href="../../cart.html">Shopping Cart</a></li>
          </ul>
        </div>
        <div class="footer-links-col">
          <h4>INFORMATION</h4>
          <ul>
            <li><a href="../privacy.html">Privacy Policy</a></li>
            <li><a href="../refund.html">Refund Policy</a></li>
            <li><a href="../shipping.html">Shipping Policy</a></li>
            <li><a href="../terms.html">Terms &amp; Conditions</a></li>
            <li><a href="../safety.html">Safety</a></li>
          </ul>
        </div>
        <div class="footer-newsletter-col">
          <h4>GET IN TOUCH</h4>
          <p>Receive all the latest information on events, sales, &amp; offers.</p>
          <form class="newsletter-form" id="newsletterForm">
            <input type="email" placeholder="Enter your email address..." required>
            <button type="submit" aria-label="Subscribe">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
          </form>
        </div>
      </div>
    </div>
    <div class="footer-bottom-bar">
      <div class="container footer-bottom-inner">
        <p>&copy;2026 Purity Labs. All rights reserved.</p>
        <div class="footer-payments">
          <img src="../../images/payment.svg" alt="Payment methods">
        </div>
      </div>
    </div>
    <div class="footer-disclaimer">
      <div class="container">
        <p class="disclaimer-title">FDA DISCLAIMER</p>
        <p>The statements on this website have not been evaluated by the U.S. Food and Drug Administration. The products and information provided by Purity Labs are not intended to diagnose, treat, cure, or prevent any disease.
Purity Labs LLC is a research chemical supplier. We are not a
 compounding pharmacy or compounding facility as defined under Section 503A of the Federal Food, Drug, and Cosmetic Act, nor are we an outsourcing facility as defined under Section 503B.
All products are sold for research, laboratory, or analytical purposes only, and are not for human consumption</p>
      </div>
    </div>
  </footer>

  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js"></script>
  <script src="../../pdb.js"></script>
  <script src="../../script.js"></script>
  <!-- ACCOUNT MODAL -->
  <div class="account-overlay" id="accountOverlay"></div>
  <div class="account-modal" id="accountModal">
    <button class="account-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
    <div class="account-tabs">
      <button class="account-tab active" data-tab="login">Sign In</button>
      <button class="account-tab" data-tab="register">Create Account</button>
    </div>
    <form class="account-form" id="loginForm">
      <div class="account-field">
        <label>Email Address</label>
        <input type="email" placeholder="you@example.com" required>
      </div>
      <div class="account-field">
        <label>Password</label>
        <input type="password" placeholder="Enter password" required>
      </div>
      <button type="submit" class="account-submit-btn">Sign In</button>
      <p class="account-note">Protected account — orders, cart &amp; profile synced securely via Firebase.</p>
    </form>
    <form class="account-form" id="registerForm" style="display:none;">
      <div class="account-field">
        <label>Full Name</label>
        <input type="text" placeholder="Your name" required>
      </div>
      <div class="account-field">
        <label>Email Address</label>
        <input type="email" placeholder="you@example.com" required>
      </div>
      <div class="account-field">
        <label>Password</label>
        <input type="password" placeholder="Create password" required>
      </div>
      <button type="submit" class="account-submit-btn">Create Account</button>
      <p class="account-note">Protected account — orders, cart &amp; profile synced securely via Firebase.</p>
    </form>
    <div class="account-logged-in" id="accountLoggedIn" style="display:none;">
      <div class="account-avatar"><i class="fa-solid fa-user"></i></div>
      <h3 id="accountName">User</h3>
      <p id="accountEmail">user@example.com</p>
      <a href="../../account.html" class="account-dash-btn"><i class="fa-solid fa-gauge-high"></i> Go to My Dashboard</a>
      <button class="account-logout-btn" id="accountLogout">Sign Out</button>
    </div>
  </div>

  <!-- SIDE CART DRAWER -->
  <div class="side-cart-overlay" id="sideCartOverlay"></div>
  <div class="side-cart" id="sideCart">
    <div class="side-cart-header">
      <h3><i class="fa-solid fa-bag-shopping" style="margin-right:8px;color:#2E7D32;"></i>Shopping Cart</h3>
      <button class="side-cart-close" aria-label="Close cart"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="side-cart-items" id="sideCartItems"></div>
    <div class="side-cart-footer" id="sideCartFooter" style="display:none;">
      <div class="side-cart-shipping-bar"><div class="side-cart-shipping-fill" id="sideCartShippingFill" style="width:0%"></div></div>
      <p class="side-cart-shipping-text" id="sideCartShippingText">Add <b>$250.00</b> more for free shipping</p>
      <div class="side-cart-totals" id="sideCartTotals"></div>
      <a href="../../checkout.html" class="side-cart-checkout-btn">Proceed to Checkout</a>
      <a href="../../index.html#products" class="side-cart-continue">Continue Shopping</a>
    </div>
  </div>
</body>
</html>
`;
}

/* ================= GENERATE GRID CARDS ================= */
function cardFor(prod, isSpray, data) {
  const price = () => {
    if (prod.priceTo > 0) return '$' + prod.priceFrom.toFixed(2) + ' — ' + prod.priceTo.toFixed(2);
    return '$' + prod.priceFrom.toFixed(2);
  };
  const link = isSpray ? 'products/' + prod.slug + '.html' : 'pages/products/' + prod.slug + '.html';
  const img = isSpray ? '../images/' + prod.image.split('/').pop() : 'images/' + prod.image.split('/').pop();
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

function replaceMarked(marker, html, replacement) {
  const start = '<!-- DATA:' + marker + '-start -->';
  const end = '<!-- DATA:' + marker + '-end -->';
  const si = html.indexOf(start);
  const ei = html.indexOf(end);
  if (si < 0 || ei < 0) { console.log('  [skip] marker not found: ' + marker); return html; }
  return html.slice(0, si + start.length) + '\n' + replacement + '\n' + html.slice(ei);
}

/* ================= COMMANDS ================= */
function generatePages(data) {
  let n = 0;
  for (const p of data.products) {
    if (!p.slug || !p.image) continue;
    const out = pageShell(p, data);
    write(path.join(PROD_DIR, p.slug + '.html'), out);
    n++;
  }
  console.log('pages: wrote ' + n + ' product pages');
}

function generateIndex(data) {
  const file = path.join(ROOT, 'index.html');
  let html = read(file);
  const powders = data.products.filter(p => p.cat !== 'sprays');
  const grids = powders.map(p => cardFor(p, false, data)).join('\n\n');
  html = replaceMarked('grid', html, grids);

  const topbar = '      <span>' + esc(data.content.topbar) + '</span>';
  html = replaceMarked('topbar', html, topbar);

  const hero = '      <p class="hero-subtitle-text">' + esc(data.content.heroSubtitle) + '</p>\n      <h1 class="hero-title">' + data.content.heroTitle + '</h1>\n      <a href="' + esc(data.content.heroUrl) + '" class="btn-hero">' + esc(data.content.heroBtn) + '</a>';
  html = replaceMarked('hero', html, hero);

  const trust = (data.content.trust || []).map((t, i) =>
    '      <div class="trust-card">\n        <div class="trust-icon">\n          <i class="' + (['fa-regular fa-circle-check', 'fa-solid fa-truck-fast', 'fa-solid fa-headset'][i] || 'fa-solid fa-check') + '"></i>\n        </div>\n        <h3>' + esc(t.title) + '</h3>\n        <p>' + esc(t.text) + '</p>\n      </div>').join('\n\n');
  html = replaceMarked('trust', html, trust);

  write(file, html);
  console.log('index: updated marked sections');
}

function generateSprays(data) {
  const file = path.join(PAGES_DIR, 'nasal-sprays.html');
  let html = read(file);
  const sprays = data.products.filter(p => p.cat === 'sprays');
  const grids = sprays.map(p => cardFor(p, true, data)).join('\n\n');
  html = replaceMarked('spray-grid', html, grids);
  write(file, html);
  console.log('sprays: updated grid (' + sprays.length + ' products)');
}

/* shared helpers for templates */
function prodBy(data, slug) { return data.products.find(p => p.slug === slug); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

/* ================= INJECT FIREBASE SCRIPT TAGS ================= */
const FB_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js'
];

function fbTagBlock(prefix) {
  return FB_URLS.map(u => '<script src="' + u + '"></script>').join('\n  ') +
    '\n  <script src="' + prefix + 'pdb.js"></script>';
}

function allHtmlFiles(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...allHtmlFiles(p));
    else if (f.endsWith('.html')) out.push(p);
  }
  return out;
}

function injectFirebase() {
  let n = 0;
  for (const file of allHtmlFiles(ROOT)) {
    let html = read(file);
    if (html.indexOf('firebase-app-compat.js') !== -1) continue;
    const m = /<script[^>]+src="((?:\.\.\/)*)(?:script|account|admin)\.js"><\/script>/.exec(html);
    if (!m) { console.log('  [skip] no app script in ' + file); continue; }
    const block = fbTagBlock(m[1]) + '\n  ' + m[0];
    html = html.replace(m[0], block);
    write(file, html);
    n++;
  }
  console.log('firebase: injected into ' + n + ' files');
}

/* ---------------- main ---------------- */
const cmd = process.argv[2] || 'all';
const data = loadExistingData() || { products: [], content: {} };

switch (cmd) {
  case 'extract': extract(); break;
  case 'pages': generatePages(loadExistingData() || data); break;
  case 'index': generateIndex(loadExistingData() || data); break;
  case 'sprays': generateSprays(loadExistingData() || data); break;
  case 'firebase': injectFirebase(); break;
  case 'all':
    extract();
    generatePages(loadExistingData());
    generateIndex(loadExistingData());
    generateSprays(loadExistingData());
    break;
  default: console.log('Unknown command. Use extract | pages | index | sprays | firebase | all'); break;
}
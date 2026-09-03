// ===== AGE GATE =====
document.addEventListener('DOMContentLoaded', () => {
  const ageGate = document.getElementById('ageGate');
  const ageYes = document.getElementById('ageYes');
  const ageNo = document.getElementById('ageNo');

  if (sessionStorage.getItem('ageVerified')) {
    ageGate.classList.add('hidden');
  }

  ageYes.addEventListener('click', () => {
    sessionStorage.setItem('ageVerified', 'true');
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

// Close on nav link click
document.querySelectorAll('.mobile-nav-link, .mobile-sub-menu a').forEach(link => {
  link.addEventListener('click', () => {
    mobileNav.classList.remove('open');
  });
});

// Close on backdrop click
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

// ===== NEWSLETTER FORM =====
const newsletterForm = document.getElementById('newsletterForm');
if (newsletterForm) {
  newsletterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = newsletterForm.querySelector('input[type="email"]');
    alert('Thanks for subscribing! Email: ' + input.value);
    input.value = '';
  });
}

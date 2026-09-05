/* ===== PURITY LABS — Render web service =====
   Serves the static storefront AND exposes the email API that powers
   welcome emails, order confirmations (with receipt attachment) and
   admin order notifications via the Resend API.

   Environment variables (set on Render -> Environment):
     RESEND_API_KEY       required   your Resend API key (app.resend.com)
     RESEND_FROM          optional   verified sender, e.g. "Purity Labs <no-reply@puritylabs.com>"
     PUBLIC_URL           optional   https://puritylabs.onrender.com (used for links in emails)
     PORT                 provided automatically by Render
*/

'use strict';

const path = require('path');
const express = require('express');
const mail = require('./email');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));

/* CORS — allow the storefront (wherever it's hosted) to call the email API */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* small request log */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

/* ------------------------------------------------------------------ */
/* routes                                                              */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'purity-labs-mailer', time: new Date().toISOString() });
});

/* welcome email after signup */
app.post('/api/email/welcome', async (req, res) => {
  const { to, name, settings } = req.body || {};
  if (!to || typeof to !== 'string') {
    return res.status(400).json({ ok: false, error: 'A recipient email ("to") is required.' });
  }
  const result = await mail.sendWelcome({ to: to.trim(), name: name || 'there', settings: settings || {} });
  if (result.ok) return res.json(result);
  return res.status(502).json(result);
});

/* order confirmation (+ receipt attachment) + admin notifications */
app.post('/api/email/order', async (req, res) => {
  const { order, settings } = req.body || {};
  if (!order || !Array.isArray(order.items)) {
    return res.status(400).json({ ok: false, error: 'A valid order object with items is required.' });
  }
  const to = (order.email || '').trim();
  if (!to) {
    return res.status(400).json({ ok: false, error: 'Order is missing the customer email.' });
  }

  const results = { confirmation: null, admin: null };
  results.confirmation = await mail.sendOrderConfirmation({ to, order, settings: settings || {} });
  results.admin = await mail.sendAdminNotifications({ order, settings: settings || {} });

  const failed = Object.values(results).filter(r => r && r.ok === false);
  if (failed.length) return res.status(502).json({ ok: false, results, errors: failed.map(r => r.error) });
  return res.json({ ok: true, results });
});

/* ------------------------------------------------------------------ */
/* static storefront                                                   */
/* ------------------------------------------------------------------ */
app.use(express.static(path.join(__dirname), { index: 'index.html', extensions: ['html'] }));

/* legacy per-product pages -> single dynamic product page */
app.get('/pages/products/:slug.html', (req, res) => {
  res.redirect(301, '/pages/product.html?slug=' + encodeURIComponent(req.params.slug));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log('Purity Labs mailer listening on port ' + PORT);
});
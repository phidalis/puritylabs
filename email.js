/* ===== PURITY LABS EMAIL ENGINE =====
   Server-side templates + Resend submission for:
     - Welcome email            (new signup)
     - Order confirmation       (customer, with downloadable .txt receipt attached)
     - Admin order notification (configured admin email(s))

   Brand colors pulled from the storefront (styles.css):
     green #2E7D32  |  green dark #256828  |  dark #181818
     text #333333 / #666666  |  borders #ECECEC  |  light #F6F6F6
*/

'use strict';

const { Resend } = require('resend');

const BRAND = {
  green: '#2E7D32',
  greenDark: '#256828',
  dark: '#181818',
  text: '#333333',
  muted: '#666666',
  faint: '#999999',
  line: '#ECECEC',
  light: '#F6F6F6',
  white: '#ffffff'
};

/* ------------------------------------------------------------------ */

function publicUrl() {
  return (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
}

function money(n) {
  return '$' + Number(n || 0).toFixed(2);
}

function fmtDate(d) {
  const date = d ? new Date(d) : new Date();
  if (isNaN(date.getTime())) return String(d || '');
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

function lineTotal(item) {
  const qty = Number(item.qty) || 1;
  const price = Number(item.price) || 0;
  return qty >= 4 ? price * qty * 0.8 : price * qty;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ */
/* Layout shell — table based, fully inline styles, dark footer.       */
/* ------------------------------------------------------------------ */

function layout(opts) {
  const url = opts.url || publicUrl() || '#';
  const siteName = opts.siteName || 'Purity Labs';
  const storeAddress = opts.storeAddress || 'Purity Labs • 123 Research Way, Los Angeles, CA 90210';
  const contactEmail = opts.contactEmail || 'info@puritylabs.org';
  const footerNote = opts.footerNote || 'For in-vitro research and laboratory use only. Not for human consumption.';

  const hero = `
    <tr>
      <td style="padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.dark};">
          <tr>
            <td style="padding:42px 40px 40px;text-align:center;">
              <div style="color:${BRAND.white};font-size:26px;font-weight:800;letter-spacing:-.5px;font-family:Arial,Helvetica,sans-serif;">
                ${esc(opts.heroTitle || '')}
              </div>
              <div style="width:48px;height:4px;background-color:${BRAND.green};border-radius:2px;margin:16px auto 0;"></div>
              <div style="color:#bbbbbb;font-size:15px;line-height:22px;margin-top:16px;font-family:Arial,Helvetica,sans-serif;">
                ${opts.heroSub || ''}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const cta = opts.cta ? `
    <tr>
      <td style="padding:6px 40px 34px;text-align:center;">
        <a href="${esc(opts.cta.url)}"
           style="display:inline-block;background-color:${BRAND.green};color:${BRAND.white};
                  text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.4px;
                  padding:15px 34px;border-radius:999px;
                  font-family:Arial,Helvetica,sans-serif;">
          ${esc(opts.cta.label)}
        </a>
        ${opts.cta.sub ? `<div style="color:${BRAND.faint};font-size:12px;margin-top:12px;font-family:Arial,Helvetica,sans-serif;">${opts.cta.sub}</div>` : ''}
      </td>
    </tr>` : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <title>${esc(opts.subject || siteName)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.light};-webkit-text-size-adjust:100%;">
  ${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(opts.preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.light};padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background-color:${BRAND.white};border-radius:12px;overflow:hidden;border:1px solid ${BRAND.line};">

          <!-- Header / logo -->
          <tr>
            <td style="padding:26px 40px 24px;border-bottom:1px solid ${BRAND.line};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:22px;font-weight:800;color:${BRAND.dark};letter-spacing:-.5px;font-family:Arial,Helvetica,sans-serif;">
                    Purity<span style="color:${BRAND.green};">Labs</span>
                  </td>
                  <td align="right" style="font-size:12px;color:${BRAND.faint};letter-spacing:.8px;font-family:Arial,Helvetica,sans-serif;">${esc(opts.headerTag || '')}</td>
                </tr>
              </table>
            </td>
          </tr>

          ${hero}
          ${opts.beforeBody || ''}

          <!-- Body -->
          <tr>
            <td style="padding:34px 40px 10px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};font-size:15px;line-height:24px;">
              ${opts.body}
            </td>
          </tr>

          ${cta}

          <!-- Footer -->
          <tr>
            <td style="padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.dark};">
                <tr>
                  <td style="padding:34px 40px 30px;">
                    <div style="color:${BRAND.white};font-size:18px;font-weight:800;letter-spacing:-.3px;font-family:Arial,Helvetica,sans-serif;">
                      Purity<span style="color:${BRAND.green};">Labs</span>
                    </div>
                    <div style="height:1px;background-color:rgba(255,255,255,.15);margin:18px 0 16px;"></div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="26" valign="top" style="padding:0 0 12px 0;">
                          <table role="presentation" width="20" cellpadding="0" cellspacing="0" border="0">
                            <tr><td height="20" width="20" align="center" style="background-color:${BRAND.green};border-radius:50%;font-size:0;line-height:0;">
                              <span style="color:${BRAND.white};font-size:10px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">&#9728;</span>
                            </td></tr>
                          </table>
                        </td>
                        <td style="color:#bbbbbb;font-size:13px;line-height:20px;padding-bottom:12px;font-family:Arial,Helvetica,sans-serif;">${esc(storeAddress)}</td>
                      </tr>
                      <tr>
                        <td width="26" valign="top" style="padding:0 0 12px 0;">
                          <table role="presentation" width="20" cellpadding="0" cellspacing="0" border="0">
                            <tr><td height="20" width="20" align="center" style="background-color:${BRAND.green};border-radius:50%;font-size:0;line-height:0;">
                              <span style="color:${BRAND.white};font-size:10px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">&#9993;</span>
                            </td></tr>
                          </table>
                        </td>
                        <td style="color:#bbbbbb;font-size:13px;line-height:20px;padding-bottom:12px;font-family:Arial,Helvetica,sans-serif;">
                          <a href="mailto:${esc(contactEmail)}" style="color:#ffffff;text-decoration:none;">${esc(contactEmail)}</a>
                        </td>
                      </tr>
                      <tr>
                        <td width="26" valign="top">
                          <table role="presentation" width="20" cellpadding="0" cellspacing="0" border="0">
                            <tr><td height="20" width="20" align="center" style="background-color:${BRAND.green};border-radius:50%;font-size:0;line-height:0;">
                              <span style="color:${BRAND.white};font-size:10px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">&#x2605;</span>
                            </td></tr>
                          </table>
                        </td>
                        <td style="color:#bbbbbb;font-size:13px;line-height:20px;">
                          <a href="${esc(url)}" style="color:#ffffff;text-decoration:none;">${esc(url)}</a>
                        </td>
                      </tr>
                    </table>
                    <div style="height:1px;background-color:rgba(255,255,255,.15);margin:16px 0 14px;"></div>
                    <div style="color:#888888;font-size:12px;line-height:18px;font-family:Arial,Helvetica,sans-serif;">${esc(footerNote)}</div>
                    <div style="color:#666666;font-size:12px;margin-top:14px;font-family:Arial,Helvetica,sans-serif;">&copy; ${new Date().getFullYear()} ${esc(siteName)}. All rights reserved.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Toggle helper for colored accent row in item tables                 */
/* ------------------------------------------------------------------ */

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* 1. WELCOME EMAIL                                                    */
/* ------------------------------------------------------------------ */

function welcomeHTML(ctx) {
  const firstName = String(ctx.name || 'there').trim().split(/\s+/)[0];
  const url = publicUrl() || 'https://puritylabs.onrender.com';
  const subject = 'Welcome to ' + ctx.siteName + ' — your account is ready';

  const body = `
    <p style="margin:0 0 18px;">Hi ${esc(firstName)},</p>
    <p style="margin:0 0 18px;">Your <strong>${esc(ctx.siteName)}</strong> account is ready. You can now sign in anytime to track orders, save wishlists and check out in a few clicks.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};border-radius:10px;margin:6px 0 8px;">
      <tr>
        <td style="padding:16px 18px;border-bottom:1px solid ${BRAND.line};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="30" style="color:${BRAND.green};font-size:14px;font-family:Arial,Helvetica,sans-serif;">&#10003;</td>
              <td style="font-size:14px;color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;"><b>Verified &gt;99% purity</b><br><span style="color:${BRAND.muted};font-size:13px;">Every batch independently tested via HPLC &amp; mass spectrometry.</span></td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 18px;border-bottom:1px solid ${BRAND.line};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="30" style="color:${BRAND.green};font-size:14px;font-family:Arial,Helvetica,sans-serif;">&#10003;</td>
              <td style="font-size:14px;color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;"><b>Free shipping over $250</b><br><span style="color:${BRAND.muted};font-size:13px;">Discreet, protected packaging on every order.</span></td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="30" style="color:${BRAND.green};font-size:14px;font-family:Arial,Helvetica,sans-serif;">&#10003;</td>
              <td style="font-size:14px;color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;"><b>Batch COAs on every product</b><br><span style="color:${BRAND.muted};font-size:13px;">Certificates of Analysis are available for review.</span></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:18px 0 0;">Questions? Just reply to this email or reach us at <a href="mailto:${esc(ctx.contactEmail)}" style="color:${BRAND.green};text-decoration:none;font-weight:600;">${esc(ctx.contactEmail)}</a>.</p>`;

  return {
    subject,
    html: layout({
      subject,
      preheader: 'Your ' + ctx.siteName + ' account is ready — sign in, shop and track orders anytime.',
      headerTag: 'WELCOME',
      heroTitle: 'Welcome to ' + ctx.siteName,
      heroSub: 'We are glad you joined the research community.',
      body,
      cta: { label: 'Shop Research Compounds', url: url, sub: 'Browse the full catalog &amp; view batch COAs' },
      siteName: ctx.siteName, storeAddress: ctx.storeAddress,
      contactEmail: ctx.contactEmail, footerNote: ctx.footerNote
    })
  };
}

/* ------------------------------------------------------------------ */
/* 2. ORDER CONFIRMATION  (customer)                                   */
/* ------------------------------------------------------------------ */

function orderItemsHTML(order) {
  const rows = (order.items || []).map(item => {
    const qty = Number(item.qty) || 1;
    const price = Number(item.price) || 0;
    const total = lineTotal(item);
    const discountNote = qty >= 4 ? '<span style="color:' + BRAND.green + ';font-size:11px;">&nbsp;(20% off)</span>' : '';
    return `
      <tr>
        <td style="padding:13px 14px;border-bottom:1px solid ${BRAND.line};font-size:14px;color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;">
          <b>${esc(item.name || 'Product')}</b>${item.variation ? `<div style="color:${BRAND.muted};font-size:12px;margin-top:2px;">${esc(item.variation)}</div>` : ''}
        </td>
        <td align="center" style="padding:13px 10px;border-bottom:1px solid ${BRAND.line};font-size:13px;color:${BRAND.muted};font-family:Arial,Helvetica,sans-serif;">${qty}</td>
        <td align="right" style="padding:13px 14px;border-bottom:1px solid ${BRAND.line};font-size:14px;color:${BRAND.text};font-weight:700;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">
          ${money(total)}${discountNote}
        </td>
      </tr>`;
  }).join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};border-radius:10px;overflow:hidden;margin:8px 0 4px;">
      <tr>
        <td style="background-color:${BRAND.green};padding:11px 14px;font-size:12px;font-weight:700;letter-spacing:1px;color:${BRAND.white};font-family:Arial,Helvetica,sans-serif;">PRODUCT</td>
        <td align="center" style="background-color:${BRAND.green};padding:11px 10px;font-size:12px;font-weight:700;letter-spacing:1px;color:${BRAND.white};font-family:Arial,Helvetica,sans-serif;">QTY</td>
        <td align="right" style="background-color:${BRAND.green};padding:11px 14px;font-size:12px;font-weight:700;letter-spacing:1px;color:${BRAND.white};font-family:Arial,Helvetica,sans-serif;">TOTAL</td>
      </tr>
      ${rows}
    </table>`;
}

function orderTotalsHTML(order) {
  const shipping = Number(order.shipping) || 0;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 6px;">
      <tr>
        <td style="padding:6px 0;font-size:14px;color:${BRAND.muted};font-family:Arial,Helvetica,sans-serif;">Subtotal</td>
        <td align="right" style="padding:6px 0;font-size:14px;color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;">${money(order.subtotal)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:${BRAND.muted};font-family:Arial,Helvetica,sans-serif;">Shipping</td>
        <td align="right" style="padding:6px 0;font-size:14px;color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;">${shipping === 0 ? 'FREE' : money(shipping)}</td>
      </tr>
      <tr>
        <td style="padding:11px 0 4px;border-top:2px solid ${BRAND.dark};font-size:15px;font-weight:800;color:${BRAND.dark};font-family:Arial,Helvetica,sans-serif;">Total</td>
        <td align="right" style="padding:11px 0 4px;border-top:2px solid ${BRAND.dark};font-size:17px;font-weight:800;color:${BRAND.green};font-family:Arial,Helvetica,sans-serif;">${money(order.total)}</td>
      </tr>
    </table>`;
}

function addressBlockHTML(title, order) {
  const address = {
    street: order.address || order.shippingAddress || '',
    city: order.city || '',
    state: order.state || '',
    zip: order.zip || ''
  };
  const line1 = [order.street || order.address].filter(Boolean).join(', ');
  const line2 = [order.city, order.state, order.zip].filter(Boolean).join(', ');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};border-radius:10px;margin:14px 0 4px;">
      <tr>
        <td style="padding:14px 18px;background-color:${BRAND.light};border-bottom:1px solid ${BRAND.line};font-size:12px;font-weight:700;letter-spacing:1px;color:${BRAND.dark};font-family:Arial,Helvetica,sans-serif;">${title}</td>
      </tr>
      <tr>
        <td style="padding:16px 18px;font-size:14px;line-height:22px;color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;">
          <b>${esc(order.customer || '')}</b><br>
          <span style="color:${BRAND.muted};">${esc(line1)}<br>${esc(line2)}<br>${esc(order.phone || '')}</span>
        </td>
      </tr>
    </table>`;
}

function orderConfirmationHTML(order, ctx) {
  const url = publicUrl() || 'https://puritylabs.onrender.com';
  const subject = ctx.siteName + ' — Order ' + order.id + ' confirmed';
  const firstName = String(order.customer || 'there').trim().split(/\s+/)[0];

  const body = `
    <p style="margin:0 0 14px;">Hi ${esc(firstName)},</p>
    <p style="margin:0 0 8px;">Thank you for your order. We have received your payment and your items are now being prepared with care.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 6px;">
      <tr>
        <td width="50%" style="padding:12px 14px;border:1px solid ${BRAND.line};border-radius:10px;background-color:${BRAND.light};">
          <div style="font-size:11px;letter-spacing:1px;color:${BRAND.faint};font-family:Arial,Helvetica,sans-serif;">ORDER NUMBER</div>
          <div style="font-size:15px;font-weight:800;color:${BRAND.dark};margin-top:4px;font-family:Arial,Helvetica,sans-serif;">${esc(order.id)}</div>
        </td>
        <td width="12"></td>
        <td width="50%" style="padding:12px 14px;border:1px solid ${BRAND.line};border-radius:10px;background-color:${BRAND.light};">
          <div style="font-size:11px;letter-spacing:1px;color:${BRAND.faint};font-family:Arial,Helvetica,sans-serif;">PLACED ON</div>
          <div style="font-size:15px;font-weight:800;color:${BRAND.dark};margin-top:4px;font-family:Arial,Helvetica,sans-serif;">${esc(fmtDate(order.date))}</div>
        </td>
      </tr>
    </table>
    ${orderItemsHTML(order)}
    ${orderTotalsHTML(order)}
    ${addressBlockHTML('SHIPPING ADDRESS', order)}
    <p style="margin:18px 0 0;">
      A copy of your receipt is attached to this email — download it anytime.
      You can also see this order under <strong>My Account &rarr; Orders</strong>.
    </p>`;

  return {
    subject,
    html: layout({
      subject,
      preheader: 'Order ' + order.id + ' confirmed — total ' + money(order.total) + '. Your receipt is attached.',
      headerTag: 'ORDER CONFIRMED',
      heroTitle: 'Thank you, ' + esc(firstName) + '!',
      heroSub: 'Your order is confirmed and being prepared.',
      body,
      cta: { label: 'Continue Shopping', url: url, sub: 'View more research-grade compounds in the catalog' },
      siteName: ctx.siteName, storeAddress: ctx.storeAddress,
      contactEmail: ctx.contactEmail, footerNote: ctx.footerNote
    })
  };
}

/* ------------------------------------------------------------------ */
/* 3. ADMIN NOTIFICATION                                               */
/* ------------------------------------------------------------------ */

function adminNotificationHTML(order, ctx) {
  const subject = 'New order ' + order.id + ' — ' + money(order.total) + ' (' + ctx.siteName + ')';

  const body = `
    <p style="margin:0 0 8px;">A new order was placed on your store.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 6px;">
      <tr>
        <td width="50%" style="padding:12px 14px;border:1px solid ${BRAND.line};border-radius:10px;background-color:${BRAND.light};">
          <div style="font-size:11px;letter-spacing:1px;color:${BRAND.faint};font-family:Arial,Helvetica,sans-serif;">CUSTOMER</div>
          <div style="font-size:15px;font-weight:800;color:${BRAND.dark};margin-top:4px;font-family:Arial,Helvetica,sans-serif;">${esc(order.customer || '')}</div>
          <div style="font-size:13px;color:${BRAND.muted};margin-top:2px;font-family:Arial,Helvetica,sans-serif;">${esc(order.email || '')}</div>
        </td>
        <td width="12"></td>
        <td width="50%" style="padding:12px 14px;border:1px solid ${BRAND.line};border-radius:10px;background-color:${BRAND.light};">
          <div style="font-size:11px;letter-spacing:1px;color:${BRAND.faint};font-family:Arial,Helvetica,sans-serif;">AMOUNT</div>
          <div style="font-size:20px;font-weight:800;color:${BRAND.green};margin-top:2px;font-family:Arial,Helvetica,sans-serif;">${money(order.total)}</div>
          <div style="font-size:12px;color:${BRAND.faint};margin-top:2px;font-family:Arial,Helvetica,sans-serif;">${esc(fmtDate(order.date))}</div>
        </td>
      </tr>
    </table>
    ${orderItemsHTML(order)}
    ${orderTotalsHTML(order)}
    ${addressBlockHTML('SHIPPING ADDRESS', order)}
    <p style="margin:18px 0 0;">
      <a href="mailto:${esc(order.email || '')}" style="color:${BRAND.green};font-weight:700;text-decoration:none;">Reply to ${esc(order.email || 'customer')}</a>
    </p>`;

  return {
    subject,
    html: layout({
      subject,
      preheader: 'New order ' + order.id + ' — ' + money(order.total) + ' from ' + (order.customer || 'customer'),
      headerTag: 'ADMIN ALERT',
      heroTitle: 'New order received',
      heroSub: money(order.total) + ' &middot; ' + esc(order.id) + ' &middot; ' + esc(fmtDate(order.date)),
      body,
      siteName: ctx.siteName, storeAddress: ctx.storeAddress,
      contactEmail: ctx.contactEmail, footerNote: 'Store notification — ' + (ctx.siteName || 'Purity Labs') + ' admin.'
    })
  };
}

/* ------------------------------------------------------------------ */
/* Attached receipt (clean .txt file)                                  */
/* ------------------------------------------------------------------ */

function receiptText(order, ctx) {
  const line = '='.repeat(64);
  const sub = '-'.repeat(64);

  const rows = (order.items || []).map(item => {
    const qty = Number(item.qty) || 1;
    const price = Number(item.price) || 0;
    const total = lineTotal(item);
    const name = (item.name || 'Product') + (item.variation ? ' (' + item.variation + ')' : '');
    const disc = qty >= 4 ? '  (20% bulk discount)' : '';
    return pad(name, 40) + '  ' + pad(String(qty), 3) + '  ' + padRight(money(total), 9) + disc;
  }).join('\n');

  function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
  function padRight(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

  const address = [order.address, order.city, order.state, order.zip].filter(Boolean).join(', ') || '—';

  return `
${ctx.siteName || 'Purity Labs'} — ORDER RECEIPT
${line}

Order number : ${order.id}
Placed on    : ${fmtDate(order.date)}
Status       : ${(order.status || 'processing').toUpperCase()}

${sub}
ITEM${' '.repeat(37)}QTY      TOTAL
${sub}
${rows}

${sub}
Subtotal                    ${padRight(money(order.subtotal), 12)}
Shipping                    ${padRight((Number(order.shipping) === 0 ? 'FREE' : money(order.shipping)), 12)}
TOTAL                       ${padRight(money(order.total), 12)}
${sub}

BILLED TO
${order.customer || ''}
${order.email || ''}

SHIPPING ADDRESS
${address}
${order.phone ? 'Phone: ' + order.phone : ''}

Payment method: ${order.method || (order.payment || 'Card')}
${sub}

Thank you for your order!
${ctx.siteName || 'Purity Labs'}
${ctx.storeAddress || ''}
${ctx.contactEmail || ''}`.replace(/\n{4,}/g, '\n\n').replace(/^[ \t]+/g, '').trim() + '\n';
}

/* ------------------------------------------------------------------ */
/* Resend sender                                                       */
/* ------------------------------------------------------------------ */

let resend = null;
try {
  resend = new Resend(process.env.RESEND_API_KEY || '');
} catch (e) {
  resend = null;
}

function fromAddress(ctx) {
  const configured = process.env.RESEND_FROM || '';
  const storeFrom = ctx.fromEmail || '';
  let raw = (configured || storeFrom || '').trim();

  /* If the opaque string already contains a working display-name pair, use it. */
  const pair = /^\s*([^<>\r\n]{1,80})\s*<([^<>\s@]+@[^<>\s@]+)>\s*$/.exec(raw);
  if (pair) {
    const cleanName = pair[1].trim().replace(/[<>\r\n\[\]]/g, '').slice(0, 60);
    return cleanName + ' <' + pair[2] + '>';
  }

  /* Normalise a bare URL to "info@domain" (e.g. "https://puritylabs.org" -> "info@puritylabs.org"). */
  let addr = raw;
  const urlMatch = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:\/.*)?$/i.exec(raw);
  if (urlMatch && !/@/.test(raw)) {
    addr = 'info@' + urlMatch[1];
  }
  addr = addr.replace(/[<>\r\n ]/g, '').replace(/^.*<(.+)>$/, '$1');
  if (!addr) addr = 'info@puritylabs.org';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
    console.error('[mail] invalid from address:', JSON.stringify(addr));
    return addr;
  }
  const siteName = String(ctx.siteName || 'Purity Labs').trim()
    .replace(/[<>\r\n\[\]]/g, '').slice(0, 60) || 'Purity Labs';
  return siteName + ' <' + addr + '>';
}

function splitEmails(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(',');
  return arr.map(x => String(x).trim()).filter(Boolean);
}

/* send via Resend; returns { ok, id?, error? }. Never throws. */
async function deliver(mail) {
  if (!process.env.RESEND_API_KEY) {
    const err = 'RESEND_API_KEY is not set on the server — email "' + (mail.subject || '') + '" skipped.';
    console.error('[mail]', err);
    return { ok: false, error: err };
  }
  if (!resend) return { ok: false, error: 'Resend failed to initialise.' };
  try {
    const { data, error } = await resend.emails.send(mail);
    if (error || !data) {
      console.error('[mail] send failed:', error, 'from:', JSON.stringify(mail.from), 'to:', JSON.stringify(mail.to));
      return { ok: false, error: error && error.message || 'Resend returned an error.' };
    }
    console.log('[mail] sent "' + mail.subject + '" ->', Array.isArray(mail.to) ? mail.to.join(', ') : mail.to, 'id:', data.id);
    return { ok: true, id: data.id };
  } catch (e) {
    console.error('[mail] exception:', e);
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

async function sendWelcome({ to, name, settings }) {
  const ctx = settings || {};
  const mail = welcomeHTML(ctx);
  return deliver({
    from: fromAddress(ctx),
    to,
    subject: mail.subject,
    html: mail.html,
    text: stripTags(mail.html)
  });
}

async function sendOrderConfirmation({ to, order, settings }) {
  const ctx = settings || {};
  const mail = orderConfirmationHTML(order, ctx);
  const filename = 'Purity-Labs-Receipt-' + String(order.id || 'order').replace(/[^a-zA-Z0-9_-]/g, '') + '.txt';
  return deliver({
    from: fromAddress(ctx),
    to,
    subject: mail.subject,
    html: mail.html,
    text: stripTags(mail.html),
    attachments: [{
      filename,
      content: receiptText(order, ctx)
    }]
  });
}

async function sendAdminNotifications({ order, settings }) {
  const ctx = settings || {};
  const to = splitEmails(ctx.adminEmails || ctx.adminNotifyEmails);
  if (!to.length) {
    console.warn('[mail] no admin notification emails configured — skipped.');
    return { ok: true, skipped: 'no admin emails configured' };
  }
  const mail = adminNotificationHTML(order, ctx);
  return deliver({
    from: fromAddress(ctx),
    to,
    subject: mail.subject,
    html: mail.html,
    text: stripTags(mail.html)
  });
}

module.exports = {
  sendWelcome,
  sendOrderConfirmation,
  sendAdminNotifications,
  templates: {
    welcome: welcomeHTML,
    order: orderConfirmationHTML,
    admin: adminNotificationHTML,
    receipt: receiptText
  }
};
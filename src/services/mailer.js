const https = require('https');
const crypto = require('crypto');

function boolEnv(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function intEnv(name, defaultValue) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : defaultValue;
}

function cleanEnv(name) {
  return String(process.env[name] || '').trim();
}

function maskSecret(value, keep = 4) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length <= keep * 2) return '*'.repeat(raw.length);
  return raw.slice(0, keep) + '*'.repeat(Math.max(6, raw.length - keep * 2)) + raw.slice(-keep);
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    if (u.username || u.password) return '';
    return `${u.protocol}//${u.host}`.replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

function hostLooksLocalOrPrivate(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

function baseUrlHostname(baseUrl) {
  try { return new URL(baseUrl).hostname; } catch (_) { return ''; }
}

function requestBaseUrl(req) {
  if (!req || !req.headers) return '';

  const bodyBase = normalizeBaseUrl(req.body?.reset_base_url || req.body?.origin || '');
  if (bodyBase) return bodyBase;

  const origin = normalizeBaseUrl(req.headers.origin || '');
  if (origin) return origin;

  const referer = String(req.headers.referer || req.headers.referrer || '').trim();
  if (referer) {
    const refBase = normalizeBaseUrl(referer);
    if (refBase) return refBase;
  }

  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || String(req.headers.host || '').trim();
  if (!host) return '';
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.secure ? 'https' : 'http');
  return normalizeBaseUrl(`${proto}://${host}`);
}

function chooseResetBaseUrl(options = {}) {
  const reqBase = normalizeBaseUrl(options.baseUrl || '') || requestBaseUrl(options.req);
  const reqHost = baseUrlHostname(reqBase);

  // Para pruebas locales, usar el mismo origen desde donde se pidió el reset, aunque APP_PUBLIC_URL apunte al dominio real.
  // Esto evita que localhost mande enlaces a producción.
  if (reqBase && hostLooksLocalOrPrivate(reqHost)) return reqBase;

  // Producción: usar base explícita para evitar host-header poisoning.
  const explicit = normalizeBaseUrl(process.env.PASSWORD_RESET_BASE_URL || process.env.RESET_LINK_BASE_URL || '');
  if (explicit) return explicit;

  const publicBase = normalizeBaseUrl(process.env.APP_PUBLIC_URL || process.env.PUBLIC_URL || '');
  if (publicBase) return publicBase;

  // Solo permitir origen de request en producción si se habilita explícitamente.
  if (reqBase && boolEnv('PASSWORD_RESET_USE_REQUEST_ORIGIN', false)) return reqBase;

  return `http://localhost:${process.env.PORT || 4000}`;
}

function buildResetUrl(token, options = {}) {
  const base = chooseResetBaseUrl(options).replace(/\/$/, '');
  return `${base}/index.html?auth=1&tab=reset&token=${encodeURIComponent(token)}`;
}

function parseAddress(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].replace(/^['"]|['"]$/g, '').trim(), email: m[2].trim() };
  return { name: '', email: raw };
}

function mailFrom() {
  const explicitEmail = cleanEnv('MAIL_FROM_EMAIL');
  const explicitName = cleanEnv('MAIL_FROM_NAME') || 'TradeFlow SV';
  if (explicitEmail) return { name: explicitName, email: explicitEmail };
  const parsed = parseAddress(process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '');
  return { name: parsed.name || explicitName, email: parsed.email };
}

function mailjetCredentials() {
  const apiKey = cleanEnv('MAILJET_API_KEY') || cleanEnv('MJ_APIKEY_PUBLIC') || cleanEnv('MAILJET_PUBLIC_KEY');
  const secretKey = cleanEnv('MAILJET_SECRET_KEY') || cleanEnv('MJ_APIKEY_PRIVATE') || cleanEnv('MAILJET_PRIVATE_KEY');
  if (apiKey && secretKey) return { apiKey, secretKey };

  const host = cleanEnv('SMTP_HOST').toLowerCase();
  const user = cleanEnv('SMTP_USER');
  const pass = cleanEnv('SMTP_PASS');
  if (host.includes('mailjet') && user && pass) return { apiKey: user, secretKey: pass };
  return null;
}

function smtpCredentials() {
  const host = cleanEnv('SMTP_HOST');
  const user = cleanEnv('SMTP_USER') || cleanEnv('MAILJET_API_KEY') || cleanEnv('MJ_APIKEY_PUBLIC');
  const pass = cleanEnv('SMTP_PASS') || cleanEnv('MAILJET_SECRET_KEY') || cleanEnv('MJ_APIKEY_PRIVATE');
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host,
    port,
    secure: boolEnv('SMTP_SECURE', port === 465),
    user,
    pass
  };
}

function smtpConfigured() {
  return !!(smtpCredentials() || mailjetCredentials());
}

function shouldUseMailjetApi() {
  const provider = cleanEnv('MAIL_PROVIDER').toLowerCase();
  if (provider === 'smtp' || provider === 'mailjet-smtp') return false;
  if (provider === 'mailjet' || provider === 'mailjet-api') return true;
  return !!mailjetCredentials();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function htmlEscape(value) {
  return String(value || '').replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

function mailjetHttp(method, path, payload, { apiKey, secretKey } = mailjetCredentials() || {}) {
  return new Promise((resolve, reject) => {
    if (!apiKey || !secretKey) return reject(new Error('MAILJET_API_KEY y MAILJET_SECRET_KEY no configurados'));
    const body = payload === undefined || payload === null ? '' : JSON.stringify(payload);
    const req = https.request({
      method,
      hostname: process.env.MAILJET_API_HOST || 'api.mailjet.com',
      path,
      headers: {
        'Accept': 'application/json',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        'Authorization': 'Basic ' + Buffer.from(`${apiKey}:${secretKey}`).toString('base64')
      },
      timeout: intEnv('MAIL_TIMEOUT_MS', 20000)
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { raw }; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ statusCode: res.statusCode, data });
        const msg = data?.ErrorMessage || data?.ErrorInfo || data?.Messages?.[0]?.Errors?.[0]?.ErrorMessage || data?.raw || `HTTP ${res.statusCode}`;
        const err = new Error(`Mailjet rechazó la solicitud: ${msg}`);
        err.statusCode = res.statusCode;
        err.response = data;
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout conectando con Mailjet')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function extractMailjetErrors(message) {
  const errors = [];
  for (const e of message?.Errors || []) {
    errors.push(e.ErrorMessage || e.ErrorInfo || e.ErrorIdentifier || JSON.stringify(e));
  }
  for (const item of [...(message?.To || []), ...(message?.Cc || []), ...(message?.Bcc || [])]) {
    if (String(item.Status || '').toLowerCase() === 'error') {
      errors.push(item.ErrorMessage || item.ErrorInfo || `Error para ${item.Email || 'destinatario'}`);
    }
  }
  return errors.filter(Boolean);
}

function parseMailjetSendResponse(response) {
  const message = response?.Messages?.[0];
  if (!message) throw new Error('Mailjet no devolvió información del mensaje.');
  const status = String(message.Status || '').toLowerCase();
  const errors = extractMailjetErrors(message);
  if (status !== 'success' || errors.length) {
    throw new Error(errors[0] || `Mailjet devolvió estado ${message.Status || 'desconocido'}`);
  }
  const recipient = (message.To || [])[0] || {};
  return {
    status: message.Status,
    messageId: recipient.MessageID || message.MessageID || '',
    messageUUID: recipient.MessageUUID || message.MessageUUID || '',
    messageHref: recipient.MessageHref || message.MessageHref || '',
    recipientStatus: recipient.MessageID || recipient.MessageUUID ? 'accepted' : (recipient.Status || ''),
    raw: response
  };
}

function mailjetEventName(row) {
  return String(row?.EventType || row?.Event || row?.event || row?.Status || row?.MessageState || row?.State || '').toLowerCase();
}

async function getMailjetMessageHistory(messageId) {
  if (!messageId) return { ok: false, message: 'Sin MessageID' };
  const paths = [
    `/v3/REST/messagehistory/${encodeURIComponent(messageId)}`,
    `/v3/REST/messagesentstatistics/${encodeURIComponent(messageId)}`,
    `/v3/REST/message/${encodeURIComponent(messageId)}`
  ];
  const attempts = [];
  for (const p of paths) {
    try {
      const { data } = await mailjetHttp('GET', p);
      const rows = Array.isArray(data?.Data) ? data.Data : (Array.isArray(data?.Messages) ? data.Messages : []);
      const events = rows.map(mailjetEventName).filter(Boolean);
      const lower = JSON.stringify(data).toLowerCase();
      const bad = events.find(e => ['blocked', 'bounce', 'bounced', 'spam', 'unsub', 'error', 'failed'].some(x => e.includes(x))) ||
        (/(blocked|bounce|bounced|spam|failed|error)/.test(lower) ? 'blocked/bounce/error' : '');
      const good = events.find(e => ['sent', 'delivered', 'open', 'opened', 'click', 'clicked'].some(x => e.includes(x))) ||
        (/("sent"|"delivered"|"open"|"opened"|"click"|"clicked")/.test(lower) ? 'sent/delivered' : '');
      return { ok: true, path: p, data, events, status: bad ? 'problem' : (good ? 'sent' : 'unknown'), problem: bad, sentEvent: good };
    } catch (err) {
      attempts.push({ path: p, statusCode: err.statusCode || 0, error: err.message });
    }
  }
  return { ok: false, status: 'unknown', attempts };
}

async function waitForMailjetStatus(messageId, options = {}) {
  const attempts = Number(options.attempts ?? intEnv('MAILJET_VERIFY_POLL_ATTEMPTS', 6));
  const pollMs = Number(options.pollMs ?? intEnv('MAILJET_VERIFY_POLL_MS', 3000));
  let last = { ok: false, status: 'unknown' };
  for (let i = 0; i < attempts; i++) {
    if (i > 0 && pollMs > 0) await new Promise(r => setTimeout(r, pollMs));
    last = await getMailjetMessageHistory(messageId);
    if (last.status === 'sent' || last.status === 'problem') return last;
  }
  return last;
}

async function listMailjetSenders({ email } = {}) {
  const q = email ? `?Email=${encodeURIComponent(email)}&Limit=50` : '?Limit=50';
  try {
    const { data } = await mailjetHttp('GET', `/v3/REST/sender${q}`);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message, statusCode: err.statusCode || 0, response: err.response || null };
  }
}

function senderLooksActive(sender = {}, email) {
  const haystack = JSON.stringify(sender).toLowerCase();
  const target = String(email || '').toLowerCase();
  const matchesEmail = !target || haystack.includes(target);
  const activeWords = ['active', 'validated', 'verified'];
  const pendingWords = ['inactive', 'pending', 'unvalidated', 'unverified', 'error', 'blocked'];
  const active = activeWords.some(w => haystack.includes(w));
  const pending = pendingWords.some(w => haystack.includes(w));
  return matchesEmail && active && !pending;
}

async function diagnoseMailjetConfig({ recipient = '' } = {}) {
  const creds = mailjetCredentials();
  const from = mailFrom();
  const out = {
    ok: false,
    provider: 'mailjet-api',
    hasApiKey: !!creds?.apiKey,
    hasSecretKey: !!creds?.secretKey,
    apiKeyMasked: maskSecret(creds?.apiKey || ''),
    from,
    recipient,
    sandboxMode: boolEnv('MAILJET_SANDBOX_MODE', boolEnv('MAILJET_SANDBOX', false)),
    issues: [],
    senders: null
  };
  if (!creds?.apiKey || !creds?.secretKey) out.issues.push('Faltan MAILJET_API_KEY o MAILJET_SECRET_KEY.');
  if (!from.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.email)) out.issues.push('MAIL_FROM_EMAIL no es un correo válido.');
  if (from.email.toLowerCase().endsWith('@gmail.com')) out.issues.push('No use @gmail.com como remitente en Mailjet; use un dominio propio validado, por ejemplo no-reply@comerxia.space.');
  if (out.sandboxMode) out.issues.push('MAILJET_SANDBOX_MODE=true: Mailjet valida el request pero NO entrega el correo.');

  if (creds?.apiKey && creds?.secretKey) {
    const senders = await listMailjetSenders({ email: from.email });
    out.senders = senders;
    if (senders.ok) {
      const rows = Array.isArray(senders.data?.Data) ? senders.data.Data : [];
      if (!rows.length) out.issues.push(`El remitente ${from.email} no aparece como sender validado en Mailjet.`);
      else if (!rows.some(s => senderLooksActive(s, from.email))) out.issues.push(`El remitente ${from.email} aparece en Mailjet pero no se detectó como activo/validado.`);
    } else {
      out.issues.push(`No se pudo consultar sender en Mailjet: ${senders.error}`);
    }
  }
  out.ok = out.issues.length === 0;
  return out;
}

async function sendViaMailjet({ to, name, subject, text, html }) {
  const creds = mailjetCredentials();
  if (!creds) throw new Error('MAILJET_API_KEY y MAILJET_SECRET_KEY no configurados');
  const from = mailFrom();
  if (!from.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.email)) {
    throw new Error('MAIL_FROM_EMAIL o MAIL_FROM no tiene un correo válido');
  }
  const sandbox = boolEnv('MAILJET_SANDBOX_MODE', boolEnv('MAILJET_SANDBOX', false));
  const customId = 'tf-reset-' + crypto.randomBytes(8).toString('hex');
  const payload = {
    SandboxMode: sandbox,
    Messages: [{
      From: { Email: from.email, Name: from.name || 'TradeFlow SV' },
      To: [{ Email: to, Name: name || to }],
      Subject: subject,
      TextPart: text,
      HTMLPart: html,
      CustomID: customId
    }]
  };
  const { data } = await mailjetHttp('POST', '/v3.1/send', payload, creds);
  const parsed = parseMailjetSendResponse(data);
  return {
    ok: true,
    provider: 'mailjet-api',
    accepted: !sandbox,
    delivered: false,
    sandbox,
    customId,
    ...parsed,
    response: data
  };
}

async function sendViaSmtp({ to, subject, text, html }) {
  const creds = smtpCredentials();
  if (!creds) throw new Error('SMTP_HOST, SMTP_USER y SMTP_PASS no configurados');
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch (_) { throw new Error('nodemailer no está instalado; ejecute npm install'); }

  const transporter = nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.user, pass: creds.pass },
    connectionTimeout: intEnv('MAIL_TIMEOUT_MS', 20000),
    greetingTimeout: intEnv('MAIL_TIMEOUT_MS', 20000),
    socketTimeout: intEnv('MAIL_TIMEOUT_MS', 20000)
  });
  const from = process.env.MAIL_FROM || process.env.SMTP_FROM || creds.user;
  const info = await transporter.sendMail({ from, to, subject, text, html });
  return { ok: true, provider: 'smtp', accepted: Array.isArray(info.accepted) && info.accepted.length > 0, delivered: false, response: info };
}

function logMailjetStatusLater(sent, to) {
  if (!sent?.messageId || !boolEnv('MAILJET_VERIFY_AFTER_SEND', true)) return;
  const delay = intEnv('MAILJET_VERIFY_INITIAL_DELAY_MS', 5000);
  setTimeout(async () => {
    try {
      const status = await waitForMailjetStatus(sent.messageId, {
        attempts: intEnv('MAILJET_VERIFY_POLL_ATTEMPTS', 5),
        pollMs: intEnv('MAILJET_VERIFY_POLL_MS', 3000)
      });
      if (status.status === 'problem') {
        console.log(`[AUTH] Mailjet reportó problema para ${to}: ${status.problem || 'blocked/bounce/error'} | MessageID=${sent.messageId}`);
      } else if (status.status === 'sent') {
        console.log(`[AUTH] Mailjet confirmó evento ${status.sentEvent || 'sent'} para ${to} | MessageID=${sent.messageId}`);
      } else {
        console.log(`[AUTH] Mailjet aceptó el correo pero aún no hay evento visible para ${to} | MessageID=${sent.messageId}. Revise Stats/Eventos en Mailjet y spam.`);
      }
    } catch (err) {
      console.log(`[AUTH] No se pudo verificar estado Mailjet para ${to}: ${err.message}`);
    }
  }, delay).unref?.();
}

async function sendPasswordResetEmail({ to, name, token, req, baseUrl }) {
  const resetUrl = buildResetUrl(token, { req, baseUrl });
  const subject = 'Recuperar contraseña — TradeFlow SV';
  const safeName = htmlEscape(name ? ' ' + name : '');
  const ttl = process.env.PASSWORD_RESET_TTL_MINUTES || 30;
  const text = `Hola${name ? ' ' + name : ''},\n\nRecibimos una solicitud para recuperar tu contraseña de TradeFlow SV.\n\nAbre este enlace para crear una contraseña nueva:\n${resetUrl}\n\nEl enlace vence en ${ttl} minutos. Si no solicitaste este cambio, ignora este correo.\n`;
  const html = `<p>Hola${safeName},</p>
<p>Recibimos una solicitud para recuperar tu contraseña de <strong>TradeFlow SV</strong>.</p>
<p><a href="${htmlEscape(resetUrl)}">Crear una contraseña nueva</a></p>
<p>El enlace vence en ${htmlEscape(ttl)} minutos. Si no solicitaste este cambio, ignora este correo.</p>`;

  if (!smtpConfigured()) {
    console.log('[AUTH] Correo no configurado. Enlace de recuperación:', resetUrl);
    return { ok: true, accepted: false, delivered: false, provider: 'console', resetUrl };
  }

  try {
    const sent = shouldUseMailjetApi()
      ? await sendViaMailjet({ to, name, subject, text, html })
      : await sendViaSmtp({ to, subject, text, html });
    if (sent.provider === 'mailjet-api') {
      if (sent.sandbox) {
        console.log(`[AUTH] Mailjet sandbox activo: el correo fue validado pero NO será entregado a ${to}.`);
      } else {
        console.log(`[AUTH] Correo de recuperación ACEPTADO por Mailjet para ${to} | MessageID=${sent.messageId || '-'} | UUID=${sent.messageUUID || '-'}`);
        logMailjetStatusLater(sent, to);
      }
    } else {
      console.log(`[AUTH] Correo de recuperación aceptado vía SMTP para ${to}`);
    }
    return { ok: true, provider: sent.provider, resetUrl, ...sent };
  } catch (err) {
    console.log('[AUTH] Error enviando correo de recuperación:', err.message);
    if (boolEnv('MAIL_DEBUG', false) && err.response) console.log('[AUTH] Respuesta proveedor:', JSON.stringify(err.response));
    return { ok: false, accepted: false, delivered: false, provider: shouldUseMailjetApi() ? 'mailjet-api' : 'smtp', resetUrl, error: err.message };
  }
}

function getMailjetConfig() {
  const creds = mailjetCredentials() || { apiKey: '', secretKey: '' };
  const from = mailFrom();
  return {
    apiKey: creds.apiKey || '',
    secretKey: creds.secretKey || '',
    fromEmail: from.email || '',
    fromName: from.name || 'TradeFlow SV',
    endpoint: `https://${process.env.MAILJET_API_HOST || 'api.mailjet.com'}/v3.1/send`,
    sandbox: boolEnv('MAILJET_SANDBOX_MODE', boolEnv('MAILJET_SANDBOX', false))
  };
}

function mailjetConfigured() {
  const cfg = getMailjetConfig();
  return !!(cfg.apiKey && cfg.secretKey && cfg.fromEmail);
}

function validateMailjetLocalConfig(cfg = getMailjetConfig()) {
  const issues = [];
  if (!cfg.apiKey) issues.push('Falta MAILJET_API_KEY');
  if (!cfg.secretKey) issues.push('Falta MAILJET_SECRET_KEY');
  if (!cfg.fromEmail) issues.push('Falta MAIL_FROM_EMAIL');
  if (cfg.fromEmail && !isValidEmail(cfg.fromEmail)) issues.push('MAIL_FROM_EMAIL no tiene formato de correo válido');
  if (boolEnv('MAILJET_SANDBOX_MODE', boolEnv('MAILJET_SANDBOX', false))) issues.push('MAILJET_SANDBOX_MODE=true: Mailjet acepta la llamada pero no entrega correos');
  return { ok: issues.length === 0, issues };
}

async function checkMailjetSender() {
  if (boolEnv('MAILJET_SKIP_SENDER_CHECK', false)) return { ok: true, skipped: true };
  try {
    const diag = await diagnoseMailjetConfig();
    if (!diag.hasApiKey || !diag.hasSecretKey) return { ok: false, error: 'Mailjet no configurado' };
    const rows = Array.isArray(diag.senders?.data?.Data) ? diag.senders.data.Data : [];
    const sender = rows.find(s => JSON.stringify(s).toLowerCase().includes(String(diag.from.email || '').toLowerCase())) || null;
    if (!rows.length) return { ok: false, error: `MAIL_FROM_EMAIL ${diag.from.email || ''} no aparece como Sender Address validado en Mailjet`, from: diag.from, senders: diag.senders };
    if (!rows.some(s => senderLooksActive(s, diag.from.email))) return { ok: false, error: `MAIL_FROM_EMAIL ${diag.from.email || ''} existe en Mailjet pero no se detectó como activo/validado`, from: diag.from, sender: sender || rows[0] };
    return { ok: true, sender: sender || rows[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getMailjetMessageInfo(messageId) {
  const info = await getMailjetMessageHistory(messageId);
  return { ok: !!info.ok, status: info.status || 'unknown', data: info.data || info, error: info.error || info.message || '' };
}

module.exports = {
  buildResetUrl,
  chooseResetBaseUrl,
  requestBaseUrl,
  sendPasswordResetEmail,
  sendViaMailjet,
  sendViaSmtp,
  getMailjetMessageInfo,
  getMailjetMessageHistory,
  waitForMailjetStatus,
  listMailjetSenders,
  diagnoseMailjetConfig,
  checkMailjetSender,
  validateMailjetLocalConfig,
  smtpConfigured,
  mailjetConfigured,
  mailjetCredentials,
  smtpCredentials,
  getMailjetConfig,
  mailFrom,
  shouldUseMailjetApi
};

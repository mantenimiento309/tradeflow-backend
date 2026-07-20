#!/usr/bin/env node
require('dotenv').config({ override: true });
const crypto = require('crypto');
const {
  sendPasswordResetEmail,
  smtpConfigured,
  mailjetCredentials,
  smtpCredentials,
  diagnoseMailjetConfig,
  waitForMailjetStatus,
  mailFrom
} = require('../src/services/mailer');

function boolEnv(name, def = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function safeJson(value) {
  return JSON.stringify(value, (k, v) => {
    if (/secret|pass|key|token/i.test(k) && typeof v === 'string') {
      if (!v) return '';
      return v.slice(0, 4) + '…' + v.slice(-4);
    }
    return v;
  }, 2);
}

async function main() {
  const args = process.argv.slice(2);
  const checkIdx = args.indexOf('--check-message');
  if (checkIdx >= 0) {
    const id = args[checkIdx + 1];
    if (!id) throw new Error('Uso: npm run test:mail -- --check-message MESSAGE_ID');
    const info = await waitForMailjetStatus(id, { attempts: 1, pollMs: 0 });
    console.log(JSON.stringify({ ok: info.ok, status: info.status, sentEvent: info.sentEvent || '', problem: info.problem || '', path: info.path || '', attempts: info.attempts || undefined }, null, 2));
    process.exit(info.ok ? 0 : 2);
  }

  const to = args.find(a => !a.startsWith('--')) || process.env.MAIL_TEST_TO || process.env.SMTP_TEST_TO || '';
  if (!to) {
    console.log('Uso: npm run test:mail -- correo@dominio.com');
    console.log('También puede usar MAIL_TEST_TO=correo@dominio.com en .env');
    process.exit(2);
  }

  console.log('[MAIL-TEST] Configuración detectada:', safeJson({
    smtpConfigured: smtpConfigured(),
    mailProvider: process.env.MAIL_PROVIDER || 'auto',
    hasMailjetKeys: !!mailjetCredentials(),
    hasSmtp: !!smtpCredentials(),
    from: mailFrom(),
    sandboxMode: boolEnv('MAILJET_SANDBOX_MODE', false)
  }));

  if (mailjetCredentials()) {
    const diagnosis = await diagnoseMailjetConfig({ recipient: to });
    console.log('[MAIL-TEST] Diagnóstico Mailjet:', safeJson({
      ok: diagnosis.ok,
      from: diagnosis.from,
      sandboxMode: diagnosis.sandboxMode,
      issues: diagnosis.issues,
      senderRows: diagnosis.senders?.ok ? (diagnosis.senders.data?.Count || diagnosis.senders.data?.Total || (diagnosis.senders.data?.Data || []).length) : null,
      senderLookupError: diagnosis.senders?.ok ? '' : diagnosis.senders?.error
    }));
    if (diagnosis.issues.length) {
      console.log('[MAIL-TEST] Corrija esos puntos primero. El contacto/lista de Mailjet NO es lo mismo que sender validado.');
    }
  }

  const token = 'test-' + crypto.randomBytes(16).toString('hex');
  const result = await sendPasswordResetEmail({ to, name: 'Prueba', token });
  console.log('[MAIL-TEST] Resultado envío:', safeJson({
    ok: result.ok,
    accepted: result.accepted,
    delivered: result.delivered,
    provider: result.provider,
    messageId: result.messageId || '',
    messageUUID: result.messageUUID || '',
    sandbox: !!result.sandbox,
    error: result.error || ''
  }));

  if (!result.ok || !result.accepted) {
    console.log('[MAIL-TEST] No se aceptó el envío. Revise MAILJET_API_KEY, MAILJET_SECRET_KEY y MAIL_FROM_EMAIL/dominio validado.');
    process.exit(1);
  }

  if (result.provider === 'mailjet-api' && result.messageId && !result.sandbox) {
    console.log('[MAIL-TEST] Verificando eventos en Mailjet. Esto puede tardar unos segundos...');
    const status = await waitForMailjetStatus(result.messageId, {
      attempts: Number(process.env.MAILJET_VERIFY_POLL_ATTEMPTS || 8),
      pollMs: Number(process.env.MAILJET_VERIFY_POLL_MS || 3000)
    });
    console.log('[MAIL-TEST] Estado Mailjet:', safeJson({
      ok: status.ok,
      status: status.status,
      sentEvent: status.sentEvent || '',
      problem: status.problem || '',
      path: status.path || '',
      attempts: status.attempts || undefined
    }));
    if (status.status === 'problem') process.exit(1);
    if (status.status !== 'sent') {
      console.log('[MAIL-TEST] Mailjet aceptó el mensaje, pero aún no confirmó evento sent/delivered. Revise Mailjet > Stats/Eventos y spam/promociones.');
    }
  }

  console.log('[MAIL-TEST] Si no llegó a Gmail, revise: sender/domain validado, SPF/DKIM, sandbox apagado y carpeta spam/promociones.');
}

main().catch(err => {
  console.error('[MAIL-TEST] Error:', err.message);
  process.exit(1);
});

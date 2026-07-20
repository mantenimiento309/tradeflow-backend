#!/usr/bin/env node
require('dotenv').config({ override: true });
const { getMailjetConfig, validateMailjetLocalConfig, checkMailjetSender } = require('../src/services/mailer');

function mask(value, keep = 4) {
  const s = String(value || '');
  if (!s) return '';
  return s.length <= keep ? '*'.repeat(s.length) : `${s.slice(0, keep)}${'*'.repeat(Math.max(4, s.length - keep))}`;
}

async function main() {
  const cfg = getMailjetConfig();
  const local = validateMailjetLocalConfig(cfg);
  console.log('[MAILJET-DOCTOR] Configuración detectada:');
  console.log(JSON.stringify({
    provider: process.env.MAIL_PROVIDER || 'auto',
    apiKey: mask(cfg.apiKey),
    hasSecret: !!cfg.secretKey,
    from: cfg.fromEmail ? `${cfg.fromName || 'TradeFlow SV'} <${cfg.fromEmail}>` : '',
    sandboxMode: ['1','true','yes','on'].includes(String(process.env.MAILJET_SANDBOX_MODE || '').toLowerCase()),
    requireVerifiedSender: process.env.MAILJET_REQUIRE_VERIFIED_SENDER !== 'false',
    skipSenderCheck: process.env.MAILJET_SKIP_SENDER_CHECK === 'true'
  }, null, 2));
  if (!local.ok) {
    console.log('[MAILJET-DOCTOR] Problemas locales:');
    for (const issue of local.issues) console.log(' - ' + issue);
    process.exit(1);
  }
  const sender = await checkMailjetSender();
  console.log('[MAILJET-DOCTOR] Remitente:');
  console.log(JSON.stringify({
    ok: sender.ok,
    skipped: !!sender.skipped,
    checked: !!sender.checked,
    sender: sender.sender || null,
    issues: sender.issues || [],
    warning: sender.warning || '',
    status: sender.status || null
  }, null, 2));
  if (!sender.ok) {
    console.log('\nSolución: en Mailjet valida MAIL_FROM_EMAIL como sender transaccional o valida el dominio. No uses la dirección de una Contact List.');
  }
  process.exit(sender.ok ? 0 : 1);
}

main().catch(err => {
  console.error('[MAILJET-DOCTOR] Error:', err.message);
  process.exit(1);
});

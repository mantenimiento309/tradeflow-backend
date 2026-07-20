#!/usr/bin/env node
require('dotenv').config({ override: true });
const { diagnoseMailjetConfig } = require('../src/services/mailer');

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
  const diagnosis = await diagnoseMailjetConfig({ recipient: process.argv[2] || process.env.MAIL_TEST_TO || '' });
  const rows = diagnosis.senders?.data?.Data || [];
  console.log(safeJson({
    ok: diagnosis.ok,
    from: diagnosis.from,
    sandboxMode: diagnosis.sandboxMode,
    issues: diagnosis.issues,
    senderLookupOk: diagnosis.senders?.ok,
    senderCount: diagnosis.senders?.data?.Count || diagnosis.senders?.data?.Total || rows.length,
    senders: rows.map(s => ({
      ID: s.ID,
      Email: s.Email,
      Name: s.Name,
      Status: s.Status,
      IsDefaultSender: s.IsDefaultSender,
      CreatedAt: s.CreatedAt
    })),
    senderError: diagnosis.senders?.ok ? '' : diagnosis.senders?.error
  }));
  process.exit(diagnosis.ok ? 0 : 1);
}

main().catch(err => {
  console.error('[MAILJET-SENDERS] Error:', err.message);
  process.exit(1);
});

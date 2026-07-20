const assert = require('assert');
const { normalizeForDb } = require('../src/services/fda-official-normalize');

const row = normalizeForDb({
  FirmName: 'EXPORTADORA TEST S.A. DE C.V.',
  City: 'SAN SALVADOR',
  CountryCode: 'SV',
  ProductCode: '02A01',
  ProductCodeDescription: 'Food demo',
  RefusalDate: '06/12/2026',
  RefusalCharges: 'LABELING',
  DistrictDescription: 'LOS-DO',
  ShipmentID: 'ABC-1234567-8'
});

assert.strictEqual(row.firm_name, 'EXPORTADORA TEST S.A. DE C.V.');
assert.strictEqual(row.country_name, 'El Salvador');
assert.strictEqual(row.refusal_date, '2026-06-12');
assert.strictEqual(row.shipment_id_ref, 'ABC-1234567-8');
assert.ok(row._targetCountryEvidence);

console.log('OK: parser FDA oficial validado.');

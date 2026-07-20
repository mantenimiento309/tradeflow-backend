const API_KEY = process.env.SHIPSGO_API_KEY || process.argv[2];
if (!API_KEY) { console.log('Uso: node scripts/test-shipsgo.js TU_API_KEY'); process.exit(1); }

(async () => {
  console.log('=== Listando shipments ===');
  const listRes = await fetch('https://api.shipsgo.com/v2/ocean/shipments?take=5', {
    headers: { 'X-Shipsgo-User-Token': API_KEY }
  });
  const listData = await listRes.json();
  console.log(JSON.stringify(listData, null, 2));

  if (listData.shipments && listData.shipments.length > 0) {
    const id = listData.shipments[0].id;
    console.log('\n=== Detalle shipment id=' + id + ' ===');
    const detailRes = await fetch('https://api.shipsgo.com/v2/ocean/shipments/' + id, {
      headers: { 'X-Shipsgo-User-Token': API_KEY }
    });
    const detailData = await detailRes.json();
    console.log(JSON.stringify(detailData, null, 2));
  }
})();


// script.js - client-side processing of CSVs to compute DRR, stock cover, recommendations
// Uses PapaParse (loaded via CDN in index.html)

function $(id){ return document.getElementById(id); }

const salesFileInput = $('salesFile');
const stockFileInput = $('stockFile');
const processBtn = $('processBtn');
const resetBtn = $('resetBtn');
const statusDiv = $('status');
const resultsDiv = $('results');
const summaryCardsDiv = $('summaryCards');
const tableContainer = $('tableContainer');

const downloadSummaryBtn = $('downloadSummary');
const downloadWarehouseBtn = $('downloadWarehouse');
const downloadRefillBtn = $('downloadRefill');
const downloadExcessBtn = $('downloadExcess');

let cached = {
  sales: null,
  stock: null,
  summary: null,
  warehouse: null,
  refill: null,
  excess: null
};

processBtn.addEventListener('click', async () => {
  status('Validating files...');
  const sf = salesFileInput.files[0];
  const stf = stockFileInput.files[0];
  if (!sf || !stf) { status('Please select both files.', true); return; }

  try {
    status('Parsing CSVs (client-side)...');
    const sales = await parseCSVFile(sf);
    const stock = await parseCSVFile(stf);
    cached.sales = sales; cached.stock = stock;
    status('Computing DRR and stock cover...');
    const drr = calculateDRR(sales);
    const { summary, warehouse } = computeStockCover(drr, stock);
    const { refill, excess } = getRecommendations(summary, warehouse);

    cached.summary = summary;
    cached.warehouse = warehouse;
    cached.refill = refill;
    cached.excess = excess;

    renderSummaryCards(summary, warehouse, refill, excess);
    showResults();
    renderTable('summary');
    status('Done. Review results and download CSVs below.');
  } catch (err) {
    console.error(err);
    status('Error: ' + err.message, true);
  }
});

resetBtn.addEventListener('click', () => {
  salesFileInput.value = '';
  stockFileInput.value = '';
  status('');
  resultsDiv.classList.add('hidden');
  summaryCardsDiv.classList.add('hidden');
  tableContainer.innerHTML = '';
  cached = { sales:null, stock:null, summary:null, warehouse:null, refill:null, excess:null };
});

function status(txt, isError=false){
  statusDiv.textContent = txt;
  statusDiv.style.color = isError ? '#b91c1c' : '';
}

function parseCSVFile(file){
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: (err) => reject(err)
    });
  });
}

// ---------- Data logic functions (mirrors backend logic) ----------
function findCol(objArr, candidates){
  if (!objArr || objArr.length===0) return null;
  const cols = Object.keys(objArr[0]);
  const low = cols.map(c => c.toLowerCase().replace(/\s+/g,''));
  for (let cand of candidates){
    const key = cand.toLowerCase().replace(/\s+/g,'');
    const idx = low.indexOf(key);
    if (idx !== -1) return cols[idx];
  }
  return null;
}

function calculateDRR(salesArr, defaultDays=30){
  // salesArr: array of objects from CSV
  const skuCol = findCol(salesArr, ['SKU','SKU ID','skuid','product_sku','productsku']) || Object.keys(salesArr[0])[0];
  const qtyCol = findCol(salesArr, ['Sale Qty','SaleQty','Qty','Quantity','SoldQty','OrderQty']);
  const dateCol = findCol(salesArr, ['Order Date','OrderDate','Date','order_date']);
  // sum per sku
  const totals = {};
  const dateSetBySku = {};
  for (let r of salesArr){
    const sku = r[skuCol];
    if (sku===undefined || sku===null) continue;
    const qty = qtyCol ? Number(String(r[qtyCol]).replace(/[^0-9.\-eE]/g,'')) || 0 : 1;
    totals[sku] = (totals[sku] || 0) + qty;
    if (dateCol){
      const d = new Date(r[dateCol]);
      if (!isNaN(d)) {
        const key = d.toISOString().slice(0,10);
        dateSetBySku[sku] = dateSetBySku[sku] || new Set();
        dateSetBySku[sku].add(key);
      }
    }
  }
  // days_in_period: if any dates found, use unique days across whole data; else defaultDays
  let days = defaultDays;
  if (dateCol){
    const allDates = new Set();
    for (let r of salesArr){
      const d = new Date(r[dateCol]);
      if (!isNaN(d)) allDates.add(d.toISOString().slice(0,10));
    }
    if (allDates.size>0) days = allDates.size;
  }
  const result = [];
  for (let sku in totals){
    const totalSales = totals[sku];
    const drr = totalSales / days;
    result.push({
      SKU: sku,
      'Total Sales': totalSales,
      'Days_in_period': days,
      'DRR': drr,
      '30day_requirement': drr * 30
    });
  }
  return result;
}

function computeStockCover(drrArr, stockArr){
  // stockArr rows with SKU, Warehouse Id, Live on Website
  const skuCol = findCol(stockArr, ['SKU','SKU ID','product_sku','productsku']) || Object.keys(stockArr[0])[0];
  const whCol = findCol(stockArr, ['Warehouse Id','WarehouseId','Warehouse','Location Id','LocationId','FC Id']) || (Object.keys(stockArr[0])[1] || 'Warehouse Id');
  const liveCol = findCol(stockArr, ['Live on Website','LiveOnWebsite','Live','Available','AvailableQty','Stock','Qty']) || Object.keys(stockArr[0]).slice(-1)[0];

  // aggregate stock per SKU+Warehouse
  const warehouseGrouped = {};
  for (let r of stockArr){
    const sku = r[skuCol];
    const wh = r[whCol] || 'UNKNOWN';
    const live = Number(String(r[liveCol]).replace(/[^0-9.\-eE]/g,'')) || 0;
    const key = sku + '||' + wh;
    warehouseGrouped[key] = (warehouseGrouped[key] || 0) + live;
  }
  const warehouseRows = [];
  const totalStockBySku = {};
  for (let key in warehouseGrouped){
    const [sku, wh] = key.split('||');
    const live = warehouseGrouped[key];
    warehouseRows.push({ SKU: sku, 'Warehouse Id': wh, 'Live on Website': live });
    totalStockBySku[sku] = (totalStockBySku[sku] || 0) + live;
  }
  // merge with drr array -> summary
  const summary = drrArr.map(d => {
    const totalFbf = totalStockBySku[d.SKU] || 0;
    const cover = d.DRR === 0 ? Infinity : totalFbf / d.DRR;
    return {
      SKU: d.SKU,
      'Total Sales': d['Total Sales'],
      'Days_in_period': d.Days_in_period,
      'DRR': d.DRR,
      '30day_requirement': d['30day_requirement'],
      'Total FBF Stock': totalFbf,
      'Stock Cover Days (SKU level)': cover
    };
  });
  // compute warehouse-level cover (merge DRR)
  const warehouseWithDRR = warehouseRows.map(w => {
    const drrRow = drrArr.find(d => d.SKU === w.SKU) || { DRR: 0 };
    const cover = drrRow.DRR === 0 ? Infinity : w['Live on Website'] / drrRow.DRR;
    return {
      SKU: w.SKU,
      'Warehouse Id': w['Warehouse Id'],
      'Live on Website': w['Live on Website'],
      'DRR': drrRow.DRR || 0,
      '30day_requirement': drrRow['30day_requirement'] || 0,
      'Stock Cover Days (Warehouse)': cover
    };
  });
  return { summary, warehouse: warehouseWithDRR };
}

function getRecommendations(summaryArr, warehouseArr){
  // Refill: Total FBF Stock < 30day_requirement
  const refill = summaryArr.filter(s => (s['Total FBF Stock'] || 0) < (s['30day_requirement'] || 0)).map(s => {
    return {
      SKU: s.SKU,
      'Total Sales': s['Total Sales'],
      'DRR': s.DRR,
      '30day_requirement': s['30day_requirement'],
      'Total FBF Stock': s['Total FBF Stock'],
      'Required Qty to reach 30d': Math.max(0, Math.round((s['30day_requirement'] || 0) - (s['Total FBF Stock'] || 0))),
      'Recommended Warehouse': recommendWarehouse(s.SKU, warehouseArr)
    };
  });
  // Excess: warehouse rows where Stock Cover Days > 60
  const excess = warehouseArr.map(w => {
    const cover = w['Stock Cover Days (Warehouse)'];
    const dr = w.DRR || 0;
    const live = w['Live on Website'] || 0;
    const excessQty = (dr && cover > 60) ? Math.max(0, Math.round(live - dr * 60)) : 0;
    return {
      SKU: w.SKU,
      'Warehouse Id': w['Warehouse Id'],
      'Live on Website': live,
      'DRR': dr,
      'Stock Cover Days (Warehouse)': cover,
      'Excess Qty (if >60 days)': excessQty
    };
  }).filter(e => e['Excess Qty (if >60 days)'] > 0);
  return { refill, excess };
}

function recommendWarehouse(sku, warehouseArr){
  // prefer warehouse with highest Live on Website for the SKU
  const candidates = warehouseArr.filter(w => w.SKU === sku);
  if (!candidates || candidates.length===0) return '';
  candidates.sort((a,b) => (b['Live on Website']||0) - (a['Live on Website']||0));
  return candidates[0]['Warehouse Id'] || '';
}

// ---------- Rendering ----------

function renderSummaryCards(summary, warehouse, refill, excess){
  summaryCardsDiv.innerHTML = '';
  summaryCardsDiv.classList.remove('hidden');
  const div = document.createElement('div');
  div.className = 'cards';
  const cards = [
    { title: 'SKUs (summary)', value: summary.length },
    { title: 'Warehouse rows', value: warehouse.length },
    { title: 'SKUs needing refill', value: refill.length },
    { title: 'Excess entries (>60d)', value: excess.length },
  ];
  for (let c of cards){
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `<div class="title">${c.title}</div><div class="value">${c.value}</div>`;
    div.appendChild(card);
  }
  summaryCardsDiv.appendChild(div);
}

function showResults(){ resultsDiv.classList.remove('hidden'); summaryCardsDiv.classList.remove('hidden'); }

// tab behavior
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', (ev) => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.getAttribute('data-tab');
    renderTable(tab);
  });
});

function renderTable(tab){
  tableContainer.innerHTML = '';
  let rows = [];
  let cols = [];
  if (tab === 'summary') {
    rows = cached.summary || [];
    cols = ['SKU','Total Sales','DRR','30day_requirement','Total FBF Stock','Stock Cover Days (SKU level)'];
  } else if (tab === 'warehouse') {
    rows = cached.warehouse || [];
    cols = ['SKU','Warehouse Id','Live on Website','DRR','Stock Cover Days (Warehouse)'];
  } else if (tab === 'refill') {
    rows = cached.refill || [];
    cols = ['SKU','Total Sales','DRR','30day_requirement','Total FBF Stock','Required Qty to reach 30d','Recommended Warehouse'];
  } else if (tab === 'excess') {
    rows = cached.excess || [];
    cols = ['SKU','Warehouse Id','Live on Website','DRR','Stock Cover Days (Warehouse)','Excess Qty (if >60 days)'];
  }
  const table = document.createElement('table');
  const thead = document.createElement('thead'); const thr = document.createElement('tr');
  cols.forEach(c => { const th = document.createElement('th'); th.textContent = c; thr.appendChild(th); });
  thead.appendChild(thr); table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (let r of rows){
    const tr = document.createElement('tr');
    cols.forEach(c => {
      const td = document.createElement('td');
      let v = r[c];
      if (v === undefined) {
        // try lowercase variants
        v = r[c.toLowerCase()] || r[camelCase(c)] || '';
      }
      td.textContent = (v === Infinity) ? '∞' : (v === null || v === undefined ? '' : String(v));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableContainer.appendChild(table);
}

// helpers
function camelCase(s){
  return s.replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase());
}

// ---------- CSV download helpers ----------
function downloadCSV(dataArr, filename){
  if (!dataArr) return;
  const cols = Object.keys(dataArr[0] || {});
  const lines = [cols.join(',')].concat(dataArr.map(r => cols.map(c => {
    const v = r[c] === undefined ? '' : String(r[c]);
    // escape quotes
    return `"${v.replace(/"/g,'""')}"`;
  }).join(',')));
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

downloadSummaryBtn.addEventListener('click', ()=> downloadCSV(cached.summary, 'stock_cover_summary.csv'));
downloadWarehouseBtn.addEventListener('click', ()=> downloadCSV(cached.warehouse, 'warehouse_level_stock.csv'));
downloadRefillBtn.addEventListener('click', ()=> downloadCSV(cached.refill, 'refill_recommendations.csv'));
downloadExcessBtn.addEventListener('click', ()=> downloadCSV(cached.excess, 'excess_stock_over_60d.csv'));

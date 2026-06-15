const CAT_STYLES = {
  'Food & dining': { color: '#b45309', bg: '#fffbeb', border: '#b45309' },
  'Shopping':      { color: '#dc2626', bg: '#fff0f0', border: '#dc2626' },
  'Transport':     { color: '#1d4ed8', bg: '#eff4ff', border: '#2563eb' },
  'Entertainment': { color: '#7c3aed', bg: '#f5f3ff', border: '#7c3aed' },
  'Other':         { color: '#52524e', bg: '#f5f4f1', border: '#8a877f' },
};

const CAT_CHART_COLORS = ['#3b82f6','#f59e0b','#ef4444','#8b5cf6','#6b7280'];

let transactions = [];
let filtered = [];
let chart1 = null, chart2 = null;
let nextId = 13;

async function loadTransactions() {
  const response = await fetch("http://localhost:3000/transactions");
  const data = await response.json();

  transactions = data.map(t => ({
    id: t.id,
    date: t.date,
    desc: t.description,
    category: t.category,
    amount: Number(t.amount)
  }));

  filtered = [...transactions];
  render();
}

/* ── Navigation ── */
const navItems = document.querySelectorAll('.nav-item');
const pages    = document.querySelectorAll('.page');

navItems.forEach(btn => {
  btn.addEventListener('click', () => {
    navItems.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const target = btn.getAttribute('data-page');

    pages.forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + target).classList.add('active');

    if (target === 'categories') renderCategoriesPage();
  });
});

/* ── Filters ── */
function applyFilters() {
  const start = document.getElementById('filter-start').value;
  const end   = document.getElementById('filter-end').value;
  const cat   = document.getElementById('filter-cat').value;

  filtered = transactions.filter(t => {
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (cat && t.category !== cat) return false;
    return true;
  });

  render();
}

function resetFilters() {
  document.getElementById('filter-start').value = '';
  document.getElementById('filter-end').value   = '';
  document.getElementById('filter-cat').value   = '';

  filtered = [...transactions];
  render();
}

async function clearAll() {
  if (!confirm('Clear all transactions?')) return;

  await fetch("http://localhost:3000/transactions", {
    method: "DELETE"
  });

  transactions = [];
  filtered = [];

  render();
}

async function uploadPDF(event) {
  const file = event.target.files[0];

  if (!file) return;

  const formData = new FormData();
  formData.append("pdf", file);

  const response = await fetch("http://localhost:3000/upload", {
    method: "POST",
    body: formData
  });

  const data = await response.json();

  if (data.error) {
    alert(data.error);
    return;
  }

  document.getElementById("import-text").textContent =
    `Imported ${data.imported} transactions from 1 file`;

  document.getElementById("import-msg").style.display = "flex";

  await loadTransactions();
}

async function deleteTransaction(id) {

  await fetch(
    `http://localhost:3000/transactions/${id}`,
    {
      method: "DELETE"
    }
  );

  transactions = transactions.filter(
    t => t.id !== id
  );

  applyFilters();
}


/* ── Modal ── */
function openModal() {
  document.getElementById('f-desc').value = '';
  document.getElementById('f-amt').value  = '';
  document.getElementById('f-cat').value  = 'Food & dining';
  document.getElementById('f-date').value = new Date().toISOString().split('T')[0];

  document.getElementById('modal').classList.add('open');

  setTimeout(() => document.getElementById('f-desc').focus(), 50);
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

function closeModalOutside(e) {
  if (e.target === document.getElementById('modal')) closeModal();
}

async function addTransaction() {
  const desc = document.getElementById('f-desc').value.trim();
  const amt  = parseFloat(document.getElementById('f-amt').value);
  const cat  = document.getElementById('f-cat').value;
  const date = document.getElementById('f-date').value;

  if (!desc || isNaN(amt) || amt <= 0 || !date) return;

  const response = await fetch("http://localhost:3000/transactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      date: date,
      description: desc,
      category: cat,
      amount: amt
    })
  });

  const savedTransaction = await response.json();

  transactions.unshift({
    id: savedTransaction.id,
    date: savedTransaction.date,
    desc: savedTransaction.description,
    category: savedTransaction.category,
    amount: Number(savedTransaction.amount)
  });

  closeModal();
  applyFilters();
}
/* ── Helpers ── */
function fmtDate(d) {
  const date = new Date(d);

  return date.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric'
  });
}

function getCatTotals(src) {
  const cats = {};

  src.forEach(t => {
    if (!cats[t.category]) {
      cats[t.category] = { total: 0, count: 0 };
    }

    cats[t.category].total += t.amount;
    cats[t.category].count += 1;
  });

  return cats;
}

function fmt(n) {
  return '$' + n.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/* ── Render ── */
function render() {
  renderSummary();
  renderTransactions();
  renderChart('pie-chart', filtered, 'chart-legend', 'chart1');
}

function renderSummary() {
  const total = filtered.reduce((s, t) => s + t.amount, 0);

  document.getElementById('total-amt').textContent = fmt(total);

  const cats = getCatTotals(filtered);
  const grid = document.getElementById('cat-grid');

  grid.innerHTML = '';

  Object.entries(cats)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([name, data]) => {
      const s = CAT_STYLES[name] || CAT_STYLES['Other'];

      const card = document.createElement('div');
      card.className = 'cat-card';
      card.style.borderLeftColor = s.border;

      card.innerHTML = `
        <div class="cat-name" style="color:${s.color};">${name}</div>
        <div class="cat-amt">${fmt(data.total)}</div>
        <div class="cat-count">${data.count} transaction${data.count !== 1 ? 's' : ''}</div>
      `;

      grid.appendChild(card);
    });
}

function renderTransactions() {
  const tbody = document.getElementById('tx-body');

  document.getElementById('tx-count').textContent = `All transactions (${filtered.length})`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No transactions found.</div></td></tr>`;
    return;
  }

  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  tbody.innerHTML = sorted.map(t => {
    const s = CAT_STYLES[t.category] || CAT_STYLES['Other'];

    return `
      <tr>
        <td class="td-date">${fmtDate(t.date)}</td>
        <td>${t.desc}</td>
        <td><span class="badge" style="background:${s.bg};color:${s.color};">${t.category}</span></td>
        <td class="td-amt">${fmt(t.amount)}</td>
        <td class="td-actions">
          <button class="btn-del" onclick="deleteTransaction(${t.id})" title="Delete">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderChart(canvasId, src, legendId, chartRef) {
  const cats   = getCatTotals(src);
  const labels = Object.keys(cats);
  const values = Object.values(cats).map(c => c.total);
  const total  = values.reduce((s, v) => s + v, 0);
  const colors = labels.map((_, i) => CAT_CHART_COLORS[i % CAT_CHART_COLORS.length]);

  if (window[chartRef]) window[chartRef].destroy();

  const ctx = document.getElementById(canvasId).getContext('2d');

  window[chartRef] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => ` ${fmt(c.raw)}`
          }
        }
      },
      animation: { duration: 400 }
    }
  });

  document.getElementById(legendId).innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i]};"></div>
      <span class="legend-name">${l}</span>
      <span class="legend-pct">${total > 0 ? Math.round(values[i] / total * 100) : 0}%</span>
    </div>
  `).join('');
}

function renderCategoriesPage() {
  const cats = getCatTotals(transactions);
  const grid = document.getElementById('cat-page-grid');

  grid.innerHTML = '';

  Object.entries(cats)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([name, data]) => {
      const s = CAT_STYLES[name] || CAT_STYLES['Other'];

      const card = document.createElement('div');
      card.className = 'cat-page-card';
      card.style.borderTopColor = s.border;

      card.innerHTML = `
        <div class="cat-page-name" style="color:${s.color};">${name}</div>
        <div class="cat-page-amt">${fmt(data.total)}</div>
        <div class="cat-page-sub">${data.count} transaction${data.count !== 1 ? 's' : ''}</div>
      `;

      grid.appendChild(card);
    });

  renderChart('pie-chart-2', transactions, 'chart-legend-2', 'chart2');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

loadTransactions();
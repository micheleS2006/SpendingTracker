const API_URL = (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "")
  ? "http://localhost:3000"
  : "https://spending-tracker-lime-kappa.vercel.app";

const CATEGORIES = ['Food & dining', 'Shopping', 'Transport', 'Entertainment', 'Other'];

const CAT_STYLES = {
  'Food & dining': { color: '#b45309', bg: '#fffbeb', border: '#b45309' },
  'Shopping':      { color: '#dc2626', bg: '#fff0f0', border: '#dc2626' },
  'Transport':     { color: '#1d4ed8', bg: '#eff4ff', border: '#2563eb' },
  'Entertainment': { color: '#7c3aed', bg: '#f5f3ff', border: '#7c3aed' },
  'Other':         { color: '#52524e', bg: '#f5f4f1', border: '#8a877f' },
};

// Same colors as before, but each category always keeps the SAME color in every chart
const CAT_CHART_COLORS = {
  'Food & dining': '#f59e0b',
  'Shopping':      '#ef4444',
  'Transport':     '#3b82f6',
  'Entertainment': '#8b5cf6',
  'Other':         '#6b7280',
};
const chartColor = cat => CAT_CHART_COLORS[cat] || CAT_CHART_COLORS['Other'];

const SPARKLE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

let transactions = [];
let filtered = [];
let profile = { incomes: [], goals: [], totalMonthlyIncome: 0 }; // My budget
let budgets = {};   // monthly budget per category
let editingId = null; // id of the transaction being edited, null when adding

/* ── Loading data ── */
async function loadTransactions() {
  try {
    const response = await fetch(`${API_URL}/transactions`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load transactions');

    transactions = data.map(t => ({
      id: t.id,
      date: String(t.date).slice(0, 10), // keep only YYYY-MM-DD
      desc: t.description,
      category: t.category,
      amount: Number(t.amount)
    }));
  } catch (err) {
    console.error(err);
    transactions = [];
  }

  fillMonthPicker();
  applyFilters();
}

/* ── Sidebar (open / close) ── */
const isPhone = () => window.matchMedia('(max-width: 860px)').matches;

function toggleSidebar(force) {
  const body = document.body;
  let open;

  if (isPhone()) {
    // Phone: the sidebar slides over the page
    open = typeof force === 'boolean' ? force : !body.classList.contains('sidebar-open');
    body.classList.toggle('sidebar-open', open);
  } else {
    // Desktop: the sidebar hides and the page takes the full width
    open = typeof force === 'boolean' ? force : body.classList.contains('sidebar-collapsed');
    body.classList.toggle('sidebar-collapsed', !open);
    try { localStorage.setItem('sidebar', open ? 'open' : 'closed'); } catch (e) {}
  }

  document.getElementById('sidebar-toggle').setAttribute('aria-expanded', String(open));
}

// Remember the desktop choice between visits
try {
  if (localStorage.getItem('sidebar') === 'closed') document.body.classList.add('sidebar-collapsed');
} catch (e) {}

/* ── Navigation ── */
const navItems = document.querySelectorAll('.nav-item');
const pages    = document.querySelectorAll('.page');

function goToPage(target) {
  navItems.forEach(b => b.classList.toggle('active', b.getAttribute('data-page') === target));
  pages.forEach(p => p.classList.toggle('active', p.id === 'page-' + target));

  if (target === 'categories') renderCategoriesPage();
  if (isPhone()) toggleSidebar(false); // close the menu after choosing a page
  window.scrollTo(0, 0);
}

navItems.forEach(btn => {
  btn.addEventListener('click', () => goToPage(btn.getAttribute('data-page')));
});

/* ── Filters ── */
function monthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function fillMonthPicker() {
  const select = document.getElementById('filter-month');
  const current = select.value;
  const months = [...new Set(transactions.map(t => t.date.slice(0, 7)))].sort().reverse();

  select.innerHTML = '<option value="">All months</option>' +
    months.map(m => `<option value="${m}">${monthName(m)}</option>`).join('');

  if (months.includes(current)) select.value = current;
}

// Choosing a month fills the start and end dates for you
function pickMonth() {
  const ym = document.getElementById('filter-month').value;
  const start = document.getElementById('filter-start');
  const end = document.getElementById('filter-end');

  if (!ym) {
    start.value = '';
    end.value = '';
  } else {
    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    start.value = `${ym}-01`;
    end.value = `${ym}-${String(lastDay).padStart(2, '0')}`;
  }
  applyFilters();
}

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
  document.getElementById('filter-month').value = '';
  document.getElementById('filter-start').value = '';
  document.getElementById('filter-end').value   = '';
  document.getElementById('filter-cat').value   = '';
  applyFilters();
}

// Number of different months in the current view (at least 1)
function monthsInView() {
  if (document.getElementById('filter-month').value) return 1;
  return Math.max(new Set(filtered.map(t => t.date.slice(0, 7))).size, 1);
}

/* ── Clear all ── */
async function clearAll() {
  const ok = confirm(
    'Clear ALL data?\n\nThis deletes every transaction and resets your incomes, ' +
    'savings goals and category budgets. This cannot be undone.'
  );
  if (!ok) return;

  try {
    const response = await fetch(`${API_URL}/transactions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true })
    });
    if (!response.ok) throw new Error((await response.json()).error);

    await fetch(`${API_URL}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incomes: [], goals: [] })
    });
    await fetch(`${API_URL}/budgets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
  } catch (err) {
    alert('Could not clear the data: ' + err.message);
    return;
  }

  // Reset the screen too
  chatHistory.length = 0;
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('import-msg').style.display = 'none';
  resetFilters();
  await Promise.all([loadTransactions(), loadProfile(), loadBudgets()]);
}

/* ── Upload ── */
async function uploadPDF(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;

  const hint = document.getElementById('upload-hint');
  const oldHint = hint.textContent;
  hint.textContent = 'Reading your statement with AI... this can take a few seconds.';

  const formData = new FormData();
  formData.append("pdf", file);

  try {
    const response = await fetch(`${API_URL}/upload`, { method: "POST", body: formData });
    const data = await response.json();

    if (!response.ok || data.error) {
      alert(data.error || 'Upload failed');
      return;
    }

    document.getElementById("import-text").textContent =
      `Imported ${data.imported} transactions from ${file.name}`;
    document.getElementById("import-msg").style.display = "flex";

    await loadTransactions();
  } catch (err) {
    alert('Could not reach the server.');
  } finally {
    hint.textContent = oldHint;
    input.value = ''; // lets you upload the same file again
  }
}

/* ── Delete one ── */
async function deleteTransaction(id) {
  const t = transactions.find(x => x.id === id);
  if (!confirm(`Delete "${t ? t.desc : 'this transaction'}"?`)) return;

  const response = await fetch(`${API_URL}/transactions/${id}`, { method: "DELETE" });
  if (!response.ok) {
    alert('Could not delete the transaction.');
    return;
  }

  transactions = transactions.filter(x => x.id !== id);
  fillMonthPicker();
  applyFilters();
}

/* ── Modal: add OR edit a transaction ── */
function openModal() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Add transaction';
  document.getElementById('modal-save').textContent = 'Add';

  document.getElementById('f-desc').value = '';
  document.getElementById('f-amt').value  = '';
  document.getElementById('f-cat').value  = 'Food & dining';
  document.getElementById('f-date').value = new Date().toISOString().split('T')[0];

  document.getElementById('modal').classList.add('open');
  setTimeout(() => document.getElementById('f-desc').focus(), 50);
}

function openEditModal(id) {
  const t = transactions.find(x => x.id === id);
  if (!t) return;

  editingId = id;
  document.getElementById('modal-title').textContent = 'Edit transaction';
  document.getElementById('modal-save').textContent = 'Save changes';

  document.getElementById('f-desc').value = t.desc;
  document.getElementById('f-amt').value  = t.amount;
  document.getElementById('f-cat').value  = t.category;
  document.getElementById('f-date').value = t.date;

  document.getElementById('modal').classList.add('open');
  setTimeout(() => document.getElementById('f-desc').focus(), 50);
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

function closeModalOutside(e) {
  if (e.target === document.getElementById('modal')) closeModal();
}

async function saveTransaction() {
  const desc = document.getElementById('f-desc').value.trim();
  const amt  = parseFloat(document.getElementById('f-amt').value);
  const cat  = document.getElementById('f-cat').value;
  const date = document.getElementById('f-date').value;

  if (!desc || isNaN(amt) || amt <= 0 || !date) {
    alert('Please fill in a description, a positive amount and a date.');
    return;
  }

  const isEdit = editingId !== null;
  const url = isEdit ? `${API_URL}/transactions/${editingId}` : `${API_URL}/transactions`;

  const response = await fetch(url, {
    method: isEdit ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, description: desc, category: cat, amount: amt })
  });

  if (!response.ok) {
    alert("Could not save the transaction.");
    return;
  }

  const saved = await response.json();
  const clean = {
    id: isEdit ? editingId : saved.id,
    date: String(saved.date).slice(0, 10),
    desc: saved.description,
    category: saved.category,
    amount: Number(saved.amount)
  };

  if (isEdit) {
    transactions = transactions.map(t => (t.id === editingId ? clean : t));
  } else {
    transactions.unshift(clean);
  }

  closeModal();
  fillMonthPicker();
  applyFilters();
}

/* ── Export CSV ── */
function exportCSV() {
  if (filtered.length === 0) {
    alert('No transactions to export.');
    return;
  }

  // Quotes around every value, and inner quotes doubled, so commas in names are safe
  const cell = v => `"${String(v).replace(/"/g, '""')}"`;

  const rows = [['Date', 'Description', 'Category', 'Amount']]
    .concat([...filtered]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(t => [t.date, t.desc, t.category, t.amount.toFixed(2)]));

  const csv = rows.map(r => r.map(cell).join(',')).join('\n');

  // "﻿" helps Excel read accents (é, è) correctly
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

/* ── Helpers ── */
function fmtDate(d) {
  // Read the date as UTC so it doesn't shift back a day in Montreal's time zone
  const date = new Date(String(d).slice(0, 10) + 'T00:00:00Z');
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function getCatTotals(src) {
  const cats = {};
  src.forEach(t => {
    if (!cats[t.category]) cats[t.category] = { total: 0, count: 0 };
    cats[t.category].total += t.amount;
    cats[t.category].count += 1;
  });
  return cats;
}

function fmt(n) {
  return '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── Render ── */
function render() {
  renderSummary();
  renderTransactions();
  renderBarChart();
  renderDonut('pie-chart', filtered, 'chart-legend', 'chart1');
}

function renderSummary() {
  const total = filtered.reduce((s, t) => s + t.amount, 0);
  const month = document.getElementById('filter-month').value;
  const months = monthsInView();

  document.getElementById('total-amt').textContent = fmt(total);
  document.getElementById('total-label').textContent =
    month ? `Total spent in ${monthName(month)}` : 'Total spent';

  // Income vs spent vs left
  const monthlyIncome = profile.totalMonthlyIncome || 0;
  const income = monthlyIncome ? monthlyIncome * months : null;
  const nIncomes = profile.incomes.length;

  document.getElementById('stat-income').textContent = income !== null ? fmt(income) : '-';
  document.getElementById('stat-income-sub').textContent = income === null
    ? 'Add your incomes in My budget (Assistant page)'
    : `${nIncomes} income${nIncomes !== 1 ? 's' : ''}` + (months > 1 ? ` · ${months} months` : ' · per month');

  document.getElementById('stat-spent').textContent = fmt(total);
  document.getElementById('stat-spent-sub').textContent =
    `${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}`;

  const leftEl = document.getElementById('stat-left');
  const leftLabel = document.getElementById('stat-left-label');
  const leftSub = document.getElementById('stat-left-sub');
  leftEl.classList.remove('positive', 'negative');

  if (income === null) {
    leftLabel.textContent = 'Left';
    leftEl.textContent = '-';
    leftSub.textContent = 'Needs your income';
  } else {
    const left = income - total;
    leftLabel.textContent = left >= 0 ? 'Left to save' : 'Over budget';
    leftEl.textContent = fmt(Math.abs(left));
    leftEl.classList.add(left >= 0 ? 'positive' : 'negative');
    const nGoals = profile.goals.length;
    leftSub.textContent = left < 0
      ? 'You spent more than you earned'
      : nGoals
        ? `Toward ${nGoals} savings goal${nGoals !== 1 ? 's' : ''}`
        : 'Income minus spending';
  }

  // Category cards
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
        <div class="cat-name" style="color:${s.color};">${escapeHTML(name)}</div>
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
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No transactions yet. Upload a statement or add one.</div></td></tr>`;
    return;
  }

  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  tbody.innerHTML = sorted.map(t => {
    const s = CAT_STYLES[t.category] || CAT_STYLES['Other'];
    // escapeHTML: descriptions come from PDFs, so never insert them as raw HTML
    return `
      <tr>
        <td class="td-date">${fmtDate(t.date)}</td>
        <td class="td-desc">${escapeHTML(t.desc)}</td>
        <td><span class="badge" style="background:${s.bg};color:${s.color};">${escapeHTML(t.category)}</span></td>
        <td class="td-amt">${fmt(t.amount)}</td>
        <td class="td-actions">
          <button class="btn-icon" onclick="openEditModal(${t.id})" title="Edit" aria-label="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button class="btn-del" onclick="deleteTransaction(${t.id})" title="Delete" aria-label="Delete">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

/* ── Charts ── */

// Draws "Category  32%" labels around the donut with small leader lines,
// like a spreadsheet chart. (A tiny Chart.js plugin.)
const outsideLabels = {
  id: 'outsideLabels',
  afterDatasetsDraw(chart) {
    // Small screens: no room around the ring, the list under the chart shows the same info
    if (chart.width < 360 || window.innerWidth <= 860) return;

    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const values = chart.data.datasets[0].data;
    const total = values.reduce((s, v) => s + v, 0);
    if (!total) return;

    // 1. Work out where each label wants to go
    const labels = [];
    meta.data.forEach((arc, i) => {
      const pct = values[i] / total;
      if (pct < 0.02) return; // skip tiny slices
      const angle = (arc.startAngle + arc.endAngle) / 2;
      const r = arc.outerRadius;
      labels.push({
        i, pct, arc,
        right: Math.cos(angle) >= 0,
        x1: arc.x + Math.cos(angle) * (r + 4),
        y1: arc.y + Math.sin(angle) * (r + 4),
        x2: arc.x + Math.cos(angle) * (r + 16),
        y: arc.y + Math.sin(angle) * (r + 16),
      });
    });

    // 2. On each side, push labels apart so they never overlap (28px apart)
    [true, false].forEach(side => {
      const group = labels.filter(l => l.right === side).sort((a, b) => a.y - b.y);
      for (let k = 1; k < group.length; k++) {
        if (group[k].y - group[k - 1].y < 28) group[k].y = group[k - 1].y + 28;
      }
    });

    // 3. Draw the leader lines and the text
    ctx.save();
    ctx.font = '12px "Gill Sans", sans-serif';
    labels.forEach(l => {
      const x3 = l.x2 + (l.right ? 14 : -14);
      const tx = x3 + (l.right ? 4 : -4);

      ctx.strokeStyle = '#b5b3ae';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y);
      ctx.lineTo(x3, l.y);
      ctx.stroke();

      ctx.textAlign = l.right ? 'left' : 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#1a1916';
      ctx.fillText(chart.data.labels[l.i], tx, l.y - 1);
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#8a877f';
      ctx.fillText(`${(l.pct * 100).toFixed(1)}%`, tx, l.y + 1);
    });
    ctx.restore();
  }
};

function renderDonut(canvasId, src, legendId, chartRef) {
  const cats   = getCatTotals(src);
  const labels = Object.keys(cats).sort((a, b) => cats[b].total - cats[a].total);
  const values = labels.map(l => cats[l].total);
  const total  = values.reduce((s, v) => s + v, 0);
  const colors = labels.map(chartColor);

  if (window[chartRef]) window[chartRef].destroy();
  const ctx = document.getElementById(canvasId).getContext('2d');

  window[chartRef] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fafafa', hoverOffset: 4 }] },
    options: {
      maintainAspectRatio: false,
      cutout: '58%',
      layout: { padding: window.innerWidth > 860 ? { top: 30, bottom: 30, left: 95, right: 95 } : 8 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${fmt(c.raw)}` } }
      },
      animation: { duration: 400 }
    },
    plugins: [outsideLabels]
  });

  document.getElementById(legendId).innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i]};"></div>
      <span class="legend-name">${escapeHTML(l)}</span>
      <span class="legend-amt">${fmt(values[i])}</span>
      <span class="legend-pct">${total > 0 ? Math.round(values[i] / total * 100) : 0}%</span>
    </div>
  `).join('');
}

// Planned (budget) vs actual (spent), one pair of bars per category
let barChart = null;
function renderBarChart() {
  const cats = getCatTotals(filtered);
  const months = monthsInView();
  const hasBudgets = Object.keys(budgets).length > 0;

  const labels = CATEGORIES.filter(c => cats[c] || budgets[c] !== undefined);
  const actual = labels.map(c => Math.round((cats[c] ? cats[c].total : 0) * 100) / 100);
  const planned = labels.map(c => (budgets[c] !== undefined ? budgets[c] * months : 0));

  const datasets = [];
  if (hasBudgets) {
    datasets.push({
      label: 'Planned',
      data: planned,
      backgroundColor: labels.map(c => chartColor(c) + '55'), // same color, lighter
      borderRadius: 4,
      barPercentage: 0.9,
      categoryPercentage: 0.7
    });
  }
  datasets.push({
    label: 'Actual',
    data: actual,
    backgroundColor: labels.map(chartColor),
    borderRadius: 4,
    barPercentage: 0.9,
    categoryPercentage: 0.7
  });

  if (barChart) barChart.destroy();
  const ctx = document.getElementById('bar-chart').getContext('2d');
  barChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: 'y', // horizontal bars
      maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, grid: { color: '#efe9ed' }, ticks: { callback: v => '$' + v } },
        y: { grid: { display: false } }
      },
      plugins: {
        legend: { display: hasBudgets, position: 'top', labels: { boxWidth: 12, boxHeight: 12 } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } }
      },
      animation: { duration: 400 }
    }
  });

  // Note under the chart: over-budget categories, or how to set budgets
  const note = document.getElementById('bar-note');
  if (!hasBudgets) {
    note.innerHTML = 'Set a monthly budget per category on the <a href="#" onclick="goToPage(\'categories\'); return false;">Categories</a> page to compare plan and actual.';
  } else {
    const over = labels.filter((c, i) => budgets[c] !== undefined && actual[i] > planned[i]);
    const period = months > 1 ? ` (budgets x ${months} months)` : '';
    note.textContent = over.length
      ? `Over budget: ${over.join(', ')}${period}`
      : `All categories within budget${period}.`;
    note.classList.toggle('warn', over.length > 0);
  }
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
        <div class="cat-page-name" style="color:${s.color};">${escapeHTML(name)}</div>
        <div class="cat-page-amt">${fmt(data.total)}</div>
        <div class="cat-page-sub">${data.count} transaction${data.count !== 1 ? 's' : ''}</div>
      `;
      grid.appendChild(card);
    });

  renderBudgetInputs();
  renderBudgetProgress();
}

// One progress bar per category: spent this month vs that category's budget
function renderBudgetProgress() {
  const box = document.getElementById('budget-progress');
  const title = document.getElementById('progress-title');

  if (transactions.length === 0) {
    title.textContent = 'Budget used this month';
    box.innerHTML = '<div class="empty-state">No transactions yet.</div>';
    return;
  }

  // "This month" = the month picked in the filters, otherwise the most recent month with data
  const picked = document.getElementById('filter-month').value;
  const month = picked || transactions.map(t => t.date.slice(0, 7)).sort().pop();
  title.textContent = `Budget used in ${monthName(month)}`;

  const cats = getCatTotals(transactions.filter(t => t.date.startsWith(month)));

  box.innerHTML = CATEGORIES.map(c => {
    const spent = cats[c] ? cats[c].total : 0;
    const budget = budgets[c];
    const s = CAT_STYLES[c];

    if (budget === undefined) {
      return `
        <div class="progress-row">
          <div class="progress-top">
            <span class="progress-name" style="color:${s.color};">${escapeHTML(c)}</span>
            <span class="progress-nums">${fmt(spent)} <span class="muted">· no budget set</span></span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:0"></div></div>
        </div>`;
    }

    const pct = budget > 0 ? Math.round(spent / budget * 100) : (spent > 0 ? 100 : 0);
    const over = spent > budget;
    const left = budget - spent;

    return `
      <div class="progress-row">
        <div class="progress-top">
          <span class="progress-name" style="color:${s.color};">${escapeHTML(c)}</span>
          <span class="progress-nums">${fmt(spent)} of ${fmt(budget)}
            <span class="${over ? 'over' : 'muted'}">· ${over ? fmt(-left) + ' over' : fmt(left) + ' left'}</span>
          </span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${Math.min(pct, 100)}%;background:${over ? 'var(--red)' : chartColor(c)};"></div>
        </div>
        <div class="progress-pct ${over ? 'over' : ''}">${pct}% used</div>
      </div>`;
  }).join('');
}

/* ── Budgets per category ── */
async function loadBudgets() {
  try {
    const response = await fetch(`${API_URL}/budgets`);
    if (response.ok) budgets = await response.json();
  } catch (err) {
    budgets = {};
  }
  renderBudgetInputs();
  render();
}

function renderBudgetInputs() {
  const form = document.getElementById('budget-form');
  form.querySelectorAll('.filter-group').forEach(el => el.remove());
  const saveBtn = form.querySelector('button');

  CATEGORIES.forEach((c, i) => {
    const group = document.createElement('div');
    group.className = 'filter-group';
    group.innerHTML = `
      <span class="filter-label">${escapeHTML(c)}</span>
      <input type="number" class="filter-input" min="0" step="0.01" placeholder="No budget"
             id="b-${i}" value="${budgets[c] !== undefined ? budgets[c] : ''}" />
    `;
    form.insertBefore(group, saveBtn);
  });
}

async function saveBudgets(event) {
  event.preventDefault();
  const status = document.getElementById('b-status');

  const body = {};
  CATEGORIES.forEach((c, i) => { body[c] = document.getElementById(`b-${i}`).value; });

  const response = await fetch(`${API_URL}/budgets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();

  if (response.ok) {
    budgets = data;
    status.textContent = 'Saved';
    status.className = 'budget-status ok';
    render();
    renderBudgetProgress();
  } else {
    status.textContent = data.error || 'Could not save';
    status.className = 'budget-status error';
  }
}

/* ── Assistant (AI chatbot) ── */
const chatHistory = []; // [{ role: "user" | "assistant", text }]

// Turns the AI's markdown (**bold**, lists) into HTML, SAFELY:
// every character is escaped first, so the AI can never inject real HTML.
function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderMarkdown(text) {
  const inline = s => escapeHTML(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')   // **bold**
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>'); // *italic*

  const lines = text.split('\n');
  let html = '';
  let list = null; // 'ul' or 'ol' while inside a list

  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)/);
    const numbered = line.match(/^\d+[.)]\s+(.*)/);
    const type = bullet ? 'ul' : numbered ? 'ol' : null;

    if (list && type !== list) { html += `</${list}>`; list = null; }

    if (type) {
      if (!list) { html += `<${type}>`; list = type; }
      html += `<li>${inline((bullet || numbered)[1])}</li>`;
    } else if (/^#{1,6}\s+/.test(line)) {
      html += `<p><strong>${inline(line.replace(/^#{1,6}\s+/, ''))}</strong></p>`; // headings
    } else if (line) {
      html += `<p>${inline(line)}</p>`;
    }
  }
  if (list) html += `</${list}>`;
  return html;
}

function setBubbleText(bubble, role, text) {
  if (role === 'assistant') bubble.innerHTML = renderMarkdown(text); // safe: escaped first
  else bubble.textContent = text;                                    // user text stays plain
}

function addChatBubble(role, text) {
  const box = document.getElementById('chat-messages');

  const row = document.createElement('div');
  row.className = `chat-row ${role}`;

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'assistant-avatar';
    avatar.innerHTML = SPARKLE_ICON;
    row.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  setBubbleText(bubble, role, text);
  row.appendChild(bubble);

  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
  return bubble;
}

async function sendChat(event) {
  if (event) event.preventDefault(); // stop the form from reloading the page

  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addChatBubble('user', text);
  chatHistory.push({ role: 'user', text });

  const thinking = addChatBubble('assistant', 'Thinking...');
  sendBtn.disabled = true;

  try {
    const response = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory })
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Request failed');

    setBubbleText(thinking, 'assistant', data.reply);
    chatHistory.push({ role: 'assistant', text: data.reply });
  } catch (err) {
    thinking.textContent = 'Sorry, the assistant is unavailable right now.';
    thinking.classList.add('error');
    chatHistory.pop(); // forget the unanswered question
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

/* ── My budget: incomes and savings goals (two independent lists) ── */
function moneyRowHTML(kind, item = {}) {
  const isIncome = kind === 'income';
  return `
    <div class="money-row">
      <input type="text" class="filter-input money-name" maxlength="100"
             placeholder="${isIncome ? 'e.g. Tutoring' : 'e.g. Trip to Paris'}"
             value="${escapeHTML(item.name || '')}" aria-label="${isIncome ? 'Income name' : 'Goal name'}" />
      <input type="number" class="filter-input money-amount" min="0" step="0.01"
             placeholder="${isIncome ? '$ per month' : '$ target'}"
             value="${item.amount ?? ''}" aria-label="Amount" oninput="updateMoneyTotals()" />
      <button type="button" class="btn-del" title="Remove" aria-label="Remove"
              onclick="this.parentElement.remove(); updateMoneyTotals()">✕</button>
    </div>`;
}

function renderProfileForm() {
  const incomes = profile.incomes.length ? profile.incomes : [{}]; // always one empty row to start
  const goals = profile.goals.length ? profile.goals : [{}];
  document.getElementById('income-rows').innerHTML = incomes.map(i => moneyRowHTML('income', i)).join('');
  document.getElementById('goal-rows').innerHTML = goals.map(g => moneyRowHTML('goal', g)).join('');
  updateMoneyTotals();
}

function addMoneyRow(kind) {
  const box = document.getElementById(kind === 'income' ? 'income-rows' : 'goal-rows');
  box.insertAdjacentHTML('beforeend', moneyRowHTML(kind));
  box.lastElementChild.querySelector('.money-name').focus();
}

function readMoneyRows(boxId) {
  return [...document.querySelectorAll(`#${boxId} .money-row`)].map(row => ({
    name: row.querySelector('.money-name').value,
    amount: row.querySelector('.money-amount').value
  }));
}

function updateMoneyTotals() {
  const sum = id => readMoneyRows(id).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const inc = sum('income-rows');
  const goals = sum('goal-rows');
  document.getElementById('income-total').textContent = inc ? `Total ${fmt(inc)}/month` : '';
  document.getElementById('goal-total').textContent = goals ? `Total ${fmt(goals)}` : '';
}

async function loadProfile() {
  try {
    const response = await fetch(`${API_URL}/profile`);
    if (response.ok) profile = await response.json();
  } catch (err) {
    // backend not reachable: keep the empty profile
  }
  renderProfileForm();
  renderSummary();
}

async function saveProfile(event) {
  event.preventDefault();
  const status = document.getElementById('p-status');

  try {
    const response = await fetch(`${API_URL}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incomes: readMoneyRows('income-rows'),
        goals: readMoneyRows('goal-rows')
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save');

    profile = data;
    renderProfileForm();
    renderSummary();
    status.textContent = 'Saved';
    status.className = 'budget-status ok';
  } catch (err) {
    status.textContent = err.message;
    status.className = 'budget-status error';
  }
}

/* ── Learn: budgeting strategies ── */
async function loadStrategies() {
  const grid = document.getElementById('learn-grid');
  try {
    const response = await fetch(`${API_URL}/strategies`);
    const list = await response.json();

    grid.innerHTML = list.map(s => `
      <details class="learn-card">
        <summary>
          <span class="learn-name">${escapeHTML(s.name)}</span>
          <span class="learn-summary">${escapeHTML(s.summary)}</span>
        </summary>
        <ol class="learn-steps">
          ${s.howItWorks.map(step => `<li>${escapeHTML(step)}</li>`).join('')}
        </ol>
        <p class="learn-meta"><strong>Good for:</strong> ${escapeHTML(s.goodFor)}</p>
        <p class="learn-meta"><strong>Tip:</strong> ${escapeHTML(s.tip)}</p>
        <button type="button" class="btn-light small" data-name="${escapeHTML(s.name)}"
                onclick="askAboutStrategy(this.dataset.name)">
          How does this apply to me?
        </button>
      </details>
    `).join('');
  } catch (err) {
    grid.innerHTML = '<div class="empty-state">Strategies are unavailable right now.</div>';
  }
}

function askAboutStrategy(name) {
  document.getElementById('chat-input').value =
    `How could I apply the "${name}" strategy to my own spending?`;
  document.querySelector('.chat-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  sendChat();
}

function askSuggestion(btn) {
  document.getElementById('chat-input').value = btn.textContent;
  sendChat();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

loadTransactions();
loadProfile();
loadBudgets();
loadStrategies();
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const number = new Intl.NumberFormat('en-US');
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
let range = '1M';
let transactions = [];
let history = [];
const authConfig = await fetch('/api/auth/config').then((response) => response.json());
const supabase = createClient(authConfig.url, authConfig.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
const { data: { session } } = await supabase.auth.getSession();
if (!session) location.replace(`/login?next=${encodeURIComponent(location.pathname)}`);

const numeric = (input) => Number.isFinite(Number(input)) ? Number(input) : 0;
const escapeHtml = (input) => String(input ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const list = (payload, ...keys) => {
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return Array.isArray(payload) ? payload : [];
};

async function api(path) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json', Authorization: `Bearer ${session.access_token}` } });
  if (response.status === 401) {
    location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    throw new Error('Authentication required');
  }
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function resetMetrics() {
  ['credits-total', 'revenue-total', 'sales-total', 'buyers-total', 'messages-total', 'average-total', 'chart-total']
    .forEach((id) => { document.getElementById(id).textContent = '—'; });
  $('#credit-spark').innerHTML = '';
  $('#revenue-spark').innerHTML = '';
}

function renderSummary(payload = {}) {
  const data = payload.data || payload.summary || payload;
  const stars = numeric(data.totalStars ?? data.total_stars ?? data.stars);
  const revenue = numeric(data.totalRevenue ?? data.total_revenue ?? data.revenue);
  const sales = numeric(data.totalSales ?? data.total_sales ?? data.sales);
  const buyers = numeric(data.uniqueBuyers ?? data.unique_buyers ?? data.buyers);
  const messages = numeric(data.messages ?? data.total_messages);
  $('#credits-total').textContent = number.format(stars);
  $('#revenue-total').textContent = currency.format(revenue);
  $('#sales-total').textContent = number.format(sales);
  $('#buyers-total').textContent = number.format(buyers);
  $('#messages-total').textContent = number.format(messages);
  $('#average-total').textContent = currency.format(buyers ? revenue / buyers : 0);
  $('#chart-total').textContent = currency.format(revenue);
  $('#workspace-name').textContent = data.workspaceName ?? data.workspace_name ?? data.agencyName ?? data.agency_name ?? 'My earnings';
  $('#view-title').textContent = data.title ?? (data.role === 'agency' ? 'Agency earnings' : 'Your earnings');
  $('#view-description').textContent = 'Live earnings synced securely from Telegram.';
  const modelCount = data.modelCount ?? data.model_count;
  $('#model-count').textContent = modelCount == null ? 'your account' : `${modelCount} models`;
}

function renderTransactions(filter = '') {
  const query = filter.trim().toLowerCase();
  const filtered = transactions.filter((item) => `${item.user ?? item.customer ?? ''} ${item.model ?? item.model_name ?? ''}`.toLowerCase().includes(query));
  $('#transactions').innerHTML = filtered.map((item) => {
    const user = escapeHtml(item.user ?? item.customer ?? 'Customer');
    const model = escapeHtml(item.model ?? item.model_name ?? '—');
    const initials = user.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="transaction"><div class="user"><i>${initials}</i><span><b>${user}</b><small>${escapeHtml(item.time ?? item.created_at ?? '')}</small></span></div><span class="model-name">${model}</span><span class="credit-pill">✦ ${number.format(numeric(item.stars ?? item.credits))}</span><strong>${currency.format(numeric(item.revenue ?? item.amount))}</strong></div>`;
  }).join('') || '<p class="empty">No transactions found for this period.</p>';
}

function renderModels(payload) {
  const models = list(payload, 'models', 'data');
  $('#model-grid').innerHTML = models.map((model) => {
    const name = escapeHtml(model.name ?? model.display_name ?? 'Model');
    const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    return `<article class="model-card"><div class="model-card-head"><i class="model-avatar">${initials}</i><p><b>${name}</b><span>${escapeHtml(model.handle ?? '')}</span></p></div><strong>${currency.format(numeric(model.revenue ?? model.total_revenue))}</strong><span>✦ ${number.format(numeric(model.stars ?? model.total_stars))} stars</span></article>`;
  }).join('') || '<p class="empty">No models have reported earnings yet.</p>';
  $('.models-panel').hidden = models.length === 0;
}

function drawChart() {
  const canvas = $('#revenue-chart');
  const box = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, box.width * ratio);
  canvas.height = Math.max(1, box.height * ratio);
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.clearRect(0, 0, box.width, box.height);
  if (!history.length) {
    context.fillStyle = '#77717d'; context.font = '12px DM Sans'; context.textAlign = 'center';
    context.fillText('No revenue history available yet', box.width / 2, box.height / 2);
    return;
  }
  const values = history.map((point) => numeric(point.revenue ?? point.amount ?? point.value));
  const pad = { l: 42, r: 12, t: 12, b: 30 };
  const max = Math.max(...values, 1) * 1.12;
  const points = values.map((item, index) => ({ x: pad.l + (values.length === 1 ? 0 : index / (values.length - 1)) * (box.width - pad.l - pad.r), y: pad.t + (1 - item / max) * (box.height - pad.t - pad.b) }));
  context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.strokeStyle = '#43e28b'; context.lineWidth = 2; context.stroke();
}

async function loadDashboard() {
  resetMetrics();
  $('#transactions').innerHTML = '<p class="empty">Loading live data…</p>';
  $('#model-grid').innerHTML = '<p class="empty">Loading models…</p>';
  try {
    const [summary, revenue, activity, models, health] = await Promise.all([
      api(`/api/dashboard/summary?range=${range}`), api(`/api/dashboard/revenue-history?range=${range}`),
      api(`/api/dashboard/transactions?range=${range}`), api('/api/agency/models').catch(() => ({ models: [] })),
      api('/api/dashboard/sync-health').catch(() => null)
    ]);
    renderSummary(summary);
    history = list(revenue, 'history', 'data', 'points');
    transactions = list(activity, 'transactions', 'data');
    renderTransactions($('#transaction-search').value); renderModels(models); drawChart();
    const synced = health?.last_successful_sync_at ?? health?.lastSyncedAt ?? health?.last_synced_at;
    $('.sync').innerHTML = `<i></i> ${synced ? `Synced ${new Date(synced).toLocaleString()}` : 'Waiting for first sync'}`;
    $('.eyebrow span').textContent = 'LIVE DATA';
  } catch {
    $('#view-title').textContent = 'No earnings data yet';
    $('#view-description').textContent = 'Live values will appear after the first successful n8n sync.';
    $('#transactions').innerHTML = '<p class="empty">No transactions available.</p>';
    $('#model-grid').innerHTML = '<p class="empty">No models available.</p>';
    $('.eyebrow span').textContent = 'NO DATA'; drawChart();
  } finally { document.body.classList.remove('refreshing'); }
}

$$('.ranges button').forEach((button) => button.addEventListener('click', () => { range = button.dataset.range; $$('.ranges button').forEach((item) => item.classList.toggle('active', item === button)); loadDashboard(); }));
$('#transaction-search').addEventListener('input', (event) => renderTransactions(event.target.value));
$('#refresh').addEventListener('click', () => { document.body.classList.add('refreshing'); loadDashboard(); });
$('.mobile-menu').addEventListener('click', (event) => { const open = $('.top-actions').classList.toggle('open'); event.currentTarget.setAttribute('aria-expanded', String(open)); });
window.addEventListener('resize', drawChart);
loadDashboard();

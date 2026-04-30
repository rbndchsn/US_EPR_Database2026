/* US EPR Policy Tracker - Single-page app */
(function () {
  'use strict';

  const STATUS_ORDER = ['Passed', 'Amended', 'In Progress', 'Introduced', 'Failed', 'Unknown'];
  const STATUS_COLORS = {
    'Passed': '#0e6b56',
    'Amended': '#2a7ad6',
    'In Progress': '#6b4ec5',
    'Introduced': '#b88200',
    'Failed': '#a13a3a',
    'Unknown': '#6b7280',
  };
  const ELEMENT_ORDER = [
    'Covered Products',
    'Exclusions',
    'Producer Definition',
    'Producer Exclusions',
    'PRO Structure',
    'Program Responsibility',
    'Cost Coverage',
    'Fee Structure',
    'Targets',
    'Convenience',
    'Timeline',
    'Oversight',
    'Reporting',
    'Education & Labeling',
    'Stakeholder Engagement',
    'Definitions',
    'Other Provisions',
  ];

  const state = {
    bills: [],
    aggregates: null,
    statusFilter: new Set(),
    stateFilter: '',
    yearFilter: '',
    searchQuery: '',
    deadlinesPassedOnly: true,
  };

  const charts = {};

  function el(template) {
    const tpl = document.getElementById(template);
    if (!tpl) throw new Error('Missing template: ' + template);
    return tpl.content.cloneNode(true);
  }

  function statusClass(s) {
    if (!s) return 'unknown';
    return s.toLowerCase().replace(/\s+/g, '-');
  }

  function statusBadge(s) {
    const cls = statusClass(s || 'Unknown');
    return `<span class="status-badge ${cls}">${escapeHtml(s || 'Unknown')}</span>`;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseHash() {
    const hash = window.location.hash.replace(/^#/, '') || '/';
    const [path, queryString] = hash.split('?');
    const params = new URLSearchParams(queryString || '');
    return { path: path || '/', params };
  }

  async function loadData() {
    const [billsRes, aggRes] = await Promise.all([
      fetch('data/bills.json', { cache: 'no-cache' }),
      fetch('data/aggregates.json', { cache: 'no-cache' }),
    ]);
    if (!billsRes.ok || !aggRes.ok) {
      throw new Error('Could not load data files');
    }
    const billsData = await billsRes.json();
    const aggregates = await aggRes.json();
    state.bills = billsData.bills;
    state.aggregates = aggregates;
  }

  function destroyCharts() {
    Object.keys(charts).forEach(k => {
      try { charts[k].destroy(); } catch (e) {}
      delete charts[k];
    });
  }

  // ---------- Routing ----------

  function route() {
    const { path, params } = parseHash();
    const app = document.getElementById('app');
    destroyCharts();
    app.innerHTML = '';
    app.focus();

    if (path === '/' || path === '') {
      renderHome(app);
    } else if (path === '/about') {
      renderAbout(app);
    } else if (path === '/browse') {
      // Honour ?status=... for the passed-laws tile
      if (params.has('status')) {
        state.statusFilter = new Set(params.getAll('status'));
      }
      renderBrowse(app);
    } else if (path === '/deadlines') {
      renderDeadlines(app);
    } else if (path.startsWith('/bill/')) {
      const id = decodeURIComponent(path.replace('/bill/', ''));
      renderBill(app, id);
    } else {
      app.appendChild(el('tpl-not-found'));
    }
    window.scrollTo(0, 0);
  }

  // ---------- Home ----------

  function renderHome(root) {
    const node = el('tpl-home');
    const totals = state.aggregates;
    const total = state.bills.length;
    const stateCount = Object.keys(totals.state_counts).filter(s => s !== 'Unknown').length;
    const passed = (totals.status_counts.Passed || 0) + (totals.status_counts.Amended || 0);
    const deadlines = state.bills.filter(b => {
      if (b.status !== 'Passed' && b.status !== 'Amended') return false;
      const t = b.provisions['Timeline'];
      return t && Object.keys(t).length > 0;
    }).length;

    node.querySelector('[data-slot=total-bills]').textContent = total;
    node.querySelector('[data-slot=total-states]').textContent = stateCount;
    node.querySelector('[data-slot=passed-count]').textContent = passed;
    node.querySelector('[data-slot=all-count]').textContent = total;
    node.querySelector('[data-slot=deadlines-count]').textContent = deadlines;

    const recentList = node.querySelector('[data-slot=recent-list]');
    const recent = state.bills
      .filter(b => b.status === 'Passed' || b.status === 'Amended')
      .sort((a, b) => (b.year || 0) - (a.year || 0))
      .slice(0, 6);
    recent.forEach(b => {
      const row = document.createElement('a');
      row.href = '#/bill/' + encodeURIComponent(b.id);
      row.className = 'recent-row';
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(b.name)}</strong>
          <div class="recent-meta">${escapeHtml(b.state || '')} &bull; ${escapeHtml(b.year || '')}</div>
        </div>
        ${statusBadge(b.status)}
      `;
      recentList.appendChild(row);
    });

    root.appendChild(node);

    // Render charts after DOM insertion
    requestAnimationFrame(() => {
      renderStatusChart();
      renderStateChart();
    });
  }

  function renderStatusChart() {
    const counts = state.aggregates.status_counts;
    const labels = STATUS_ORDER.filter(s => counts[s] > 0);
    const data = labels.map(l => counts[l]);
    const colors = labels.map(l => STATUS_COLORS[l] || '#6b7280');
    const ctx = document.getElementById('chart-status');
    if (!ctx) return;
    charts.status = new Chart(ctx, {
      type: 'pie',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, padding: 10 } },
          tooltip: {
            callbacks: {
              label: (item) => `${item.label}: ${item.parsed} bills`,
            },
          },
        },
      },
    });
  }

  function renderStateChart() {
    const counts = state.aggregates.state_counts;
    const entries = Object.entries(counts)
      .filter(([k]) => k !== 'Unknown')
      .sort((a, b) => b[1] - a[1]);
    const top = entries.slice(0, 9);
    const otherSum = entries.slice(9).reduce((s, x) => s + x[1], 0);
    const labels = top.map(x => x[0]);
    const data = top.map(x => x[1]);
    if (otherSum) {
      labels.push('Other states');
      data.push(otherSum);
    }
    const palette = ['#0e6b56', '#2a7ad6', '#b88200', '#a13a3a', '#6b4ec5', '#136f63', '#1c637e', '#8a5b00', '#7d2a3a', '#9aa0a8'];
    const ctx = document.getElementById('chart-state');
    if (!ctx) return;
    charts.state = new Chart(ctx, {
      type: 'pie',
      data: { labels, datasets: [{ data, backgroundColor: palette, borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
          tooltip: {
            callbacks: { label: (item) => `${item.label}: ${item.parsed} bills` },
          },
        },
      },
    });
  }

  // ---------- About ----------

  function renderAbout(root) {
    const node = el('tpl-about');
    const list = node.querySelector('[data-slot=elements-list]');
    list.className = 'elements-list';

    const grouped = {};
    state.aggregates.elements.forEach(e => {
      if (!grouped[e.category]) grouped[e.category] = [];
      grouped[e.category].push(e);
    });

    ELEMENT_ORDER.forEach((cat, i) => {
      if (!grouped[cat]) return;
      const opts = grouped[cat];
      const div = document.createElement('div');
      div.className = 'element-item';
      const totalBills = opts.reduce((m, o) => Math.max(m, o.bill_count), 0);
      div.innerHTML = `
        <div class="name"><span>${i + 1}. ${escapeHtml(cat)}</span><span class="count">up to ${totalBills} bills cover this</span></div>
        <div class="options">${opts.map(o => `${escapeHtml(o.option)} (${o.bill_count})`).join(' &bull; ')}</div>
      `;
      list.appendChild(div);
    });

    root.appendChild(node);
  }

  // ---------- Browse ----------

  function renderBrowse(root) {
    const node = el('tpl-browse');

    // Status chips
    const chipBox = node.querySelector('[data-slot=status-chips]');
    STATUS_ORDER.forEach(s => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.textContent = s;
      const pressed = state.statusFilter.has(s);
      chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      if (pressed) chip.style.borderColor = STATUS_COLORS[s];
      chip.addEventListener('click', () => {
        if (state.statusFilter.has(s)) state.statusFilter.delete(s);
        else state.statusFilter.add(s);
        rerenderBrowseList(node);
        chip.setAttribute('aria-pressed', state.statusFilter.has(s) ? 'true' : 'false');
      });
      chipBox.appendChild(chip);
    });

    // State filter
    const stateSel = node.querySelector('[data-slot=state-filter]');
    const states = Array.from(new Set(state.bills.map(b => b.state).filter(Boolean))).sort();
    states.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      stateSel.appendChild(opt);
    });
    stateSel.value = state.stateFilter;
    stateSel.addEventListener('change', () => {
      state.stateFilter = stateSel.value;
      rerenderBrowseList(node);
    });

    // Year filter
    const yearSel = node.querySelector('[data-slot=year-filter]');
    const years = Array.from(new Set(state.bills.map(b => b.year).filter(y => y != null))).sort((a, b) => b - a);
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      yearSel.appendChild(opt);
    });
    yearSel.value = state.yearFilter;
    yearSel.addEventListener('change', () => {
      state.yearFilter = yearSel.value;
      rerenderBrowseList(node);
    });

    // Search
    const search = node.querySelector('[data-slot=search-input]');
    search.value = state.searchQuery;
    search.addEventListener('input', () => {
      state.searchQuery = search.value.toLowerCase();
      rerenderBrowseList(node);
    });

    // Reset
    node.querySelector('[data-slot=reset]').addEventListener('click', () => {
      state.statusFilter.clear();
      state.stateFilter = '';
      state.yearFilter = '';
      state.searchQuery = '';
      route();
    });

    root.appendChild(node);
    rerenderBrowseList(root);
  }

  function rerenderBrowseList(scope) {
    const filtered = state.bills.filter(b => {
      if (state.statusFilter.size && !state.statusFilter.has(b.status)) return false;
      if (state.stateFilter && b.state !== state.stateFilter) return false;
      if (state.yearFilter && String(b.year) !== state.yearFilter) return false;
      if (state.searchQuery) {
        const hay = [b.name, b.state, b.id, b.status].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(state.searchQuery)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const sa = STATUS_ORDER.indexOf(a.status || 'Unknown');
      const sb = STATUS_ORDER.indexOf(b.status || 'Unknown');
      if (sa !== sb) return sa - sb;
      if (a.state !== b.state) return (a.state || '').localeCompare(b.state || '');
      return (b.year || 0) - (a.year || 0);
    });

    const target = scope.querySelector('[data-slot=results]') || document.querySelector('[data-slot=results]');
    const counter = document.querySelector('[data-slot=result-count]');
    if (counter) counter.textContent = filtered.length;
    target.innerHTML = '';
    if (!filtered.length) {
      target.innerHTML = '<p style="text-align:center;padding:40px 0;color:var(--color-text-muted)">No bills match your filters.</p>';
      return;
    }

    const table = document.createElement('div');
    table.className = 'results-table';
    table.innerHTML = `
      <div class="results-row is-header">
        <div>Bill</div><div>State</div><div>Year</div><div>Status</div><div></div>
      </div>
    `;
    filtered.forEach(b => {
      const row = document.createElement('div');
      row.className = 'results-row' + (b.status === 'Failed' ? ' is-failed' : '');
      row.innerHTML = `
        <div><strong>${escapeHtml(b.id)}</strong><br><span style="font-size:0.85rem;color:var(--color-text-muted)">${escapeHtml(b.name)}</span></div>
        <div>${escapeHtml(b.state || '')}</div>
        <div>${escapeHtml(b.year || '')}</div>
        <div>${statusBadge(b.status)}</div>
        <div><a class="view-btn" href="#/bill/${encodeURIComponent(b.id)}">View</a></div>
      `;
      table.appendChild(row);
    });
    target.appendChild(table);
  }

  // ---------- Bill detail ----------

  function renderBill(root, id) {
    const bill = state.bills.find(b => b.id === id);
    if (!bill) {
      root.appendChild(el('tpl-not-found'));
      return;
    }
    const node = el('tpl-bill');
    node.querySelector('[data-slot=name]').textContent = bill.name || '';
    node.querySelector('[data-slot=state]').textContent = bill.state || '';
    node.querySelector('[data-slot=year]').textContent = bill.year || '';
    node.querySelector('[data-slot=id]').textContent = bill.id || '';
    node.querySelector('[data-slot=status-badge]').outerHTML = statusBadge(bill.status);

    const sourceLine = node.querySelector('[data-slot=source-line]');
    if (bill.source_url) {
      sourceLine.innerHTML = `Source: <a href="${escapeHtml(bill.source_url)}" target="_blank" rel="noopener">View on SPC</a>`;
    } else {
      sourceLine.style.display = 'none';
    }

    // Compliance snapshot pulls Timeline category
    const compliance = bill.provisions['Timeline'];
    const complianceWrap = node.querySelector('[data-slot=compliance]');
    const complianceBody = node.querySelector('[data-slot=compliance-body]');
    if (compliance && Object.keys(compliance).length) {
      const dl = document.createElement('dl');
      Object.keys(compliance).forEach(k => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = compliance[k].map(c => (c.heading ? c.heading + '. ' : '') + c.text).join(' ');
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
      complianceBody.appendChild(dl);
    } else {
      complianceWrap.style.display = 'none';
    }

    // Provisions in fixed element order
    const provBox = node.querySelector('[data-slot=provisions]');
    ELEMENT_ORDER.forEach(cat => {
      const subs = bill.provisions[cat];
      if (!subs || !Object.keys(subs).length) return;
      const det = document.createElement('details');
      det.className = 'element-card';
      // Open the first card by default for context
      if (cat === ELEMENT_ORDER.find(c => bill.provisions[c])) det.open = true;
      const sum = document.createElement('summary');
      sum.className = 'element-summary';
      sum.innerHTML = `<span>${escapeHtml(cat)}</span><span style="color:var(--color-text-muted);font-weight:normal;font-size:0.85rem">${Object.keys(subs).length} provision${Object.keys(subs).length === 1 ? '' : 's'}</span>`;
      det.appendChild(sum);
      const body = document.createElement('div');
      body.className = 'element-body';
      Object.keys(subs).forEach(name => {
        const wrap = document.createElement('div');
        wrap.className = 'subprov';
        const h4 = document.createElement('h4');
        h4.textContent = name;
        wrap.appendChild(h4);
        subs[name].forEach(chunk => {
          const p = document.createElement('p');
          p.className = 'chunk';
          if (chunk.heading) {
            const span = document.createElement('span');
            span.className = 'chunk-heading';
            span.textContent = chunk.heading + '. ';
            p.appendChild(span);
          }
          p.appendChild(document.createTextNode(chunk.text));
          wrap.appendChild(p);
        });
        body.appendChild(wrap);
      });
      det.appendChild(body);
      provBox.appendChild(det);
    });

    if (!provBox.children.length) {
      const p = document.createElement('p');
      p.style.color = 'var(--color-text-muted)';
      p.textContent = 'No provision-level detail captured for this bill.';
      provBox.appendChild(p);
    }

    root.appendChild(node);
  }

  // ---------- Deadlines ----------

  function renderDeadlines(root) {
    const node = el('tpl-deadlines');
    const checkbox = node.querySelector('[data-slot=filter-passed]');
    checkbox.checked = state.deadlinesPassedOnly;
    checkbox.addEventListener('change', () => {
      state.deadlinesPassedOnly = checkbox.checked;
      renderDeadlinesTable(node.querySelector('[data-slot=deadlines-table]'));
    });
    root.appendChild(node);
    renderDeadlinesTable(root.querySelector('[data-slot=deadlines-table]'));
  }

  function renderDeadlinesTable(target) {
    const rows = [];
    state.bills.forEach(b => {
      if (state.deadlinesPassedOnly && b.status !== 'Passed' && b.status !== 'Amended') return;
      const t = b.provisions['Timeline'];
      if (!t) return;
      Object.keys(t).forEach(k => {
        const summary = t[k].map(c => (c.heading ? c.heading + '. ' : '') + c.text).join(' ');
        rows.push({
          state: b.state,
          bill: b.name,
          billId: b.id,
          status: b.status,
          deadlineType: k,
          summary,
        });
      });
    });

    rows.sort((a, b) => {
      if (a.state !== b.state) return (a.state || '').localeCompare(b.state || '');
      const order = ['Deadline to Register', 'Deadline to Submit Plan', 'Date of Implementation'];
      return order.indexOf(a.deadlineType) - order.indexOf(b.deadlineType);
    });

    target.innerHTML = '';
    if (!rows.length) {
      target.innerHTML = '<p style="text-align:center;padding:40px 0;color:var(--color-text-muted)">No deadlines available for current filter.</p>';
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'deadlines-table';
    wrap.innerHTML = `
      <div class="deadlines-row is-header">
        <div>State</div><div>Bill</div><div>Deadline Type</div><div>Status</div>
      </div>
    `;
    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'deadlines-row';
      row.innerHTML = `
        <div>${escapeHtml(r.state)}</div>
        <div>
          <a href="#/bill/${encodeURIComponent(r.billId)}"><strong>${escapeHtml(r.bill)}</strong></a>
          <div class="summary">${escapeHtml(r.summary).slice(0, 240)}${r.summary.length > 240 ? '...' : ''}</div>
        </div>
        <div>${escapeHtml(r.deadlineType)}</div>
        <div>${statusBadge(r.status)}</div>
      `;
      wrap.appendChild(row);
    });
    target.appendChild(wrap);
  }

  // ---------- Boot ----------

  async function boot() {
    try {
      await loadData();
    } catch (e) {
      document.getElementById('app').innerHTML =
        '<div class="prose"><h1>Could not load data</h1><p>' + escapeHtml(e.message) + '</p></div>';
      return;
    }
    window.addEventListener('hashchange', route);
    route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

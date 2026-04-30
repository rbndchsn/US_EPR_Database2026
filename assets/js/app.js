/* US EPR Policy Tracker - Single-page app
 * Reads SPC's native JSON shape:
 *   data/policies.json   - { metadata, policies: [...] }
 *   data/aggregates.json - { status_counts, state_counts, ..., elements }
 *   data/fields.json     - { categories: [ { key, title, options: [{key, title}] } ] }
 */
(function () {
  'use strict';

  const STATUS_ORDER = ['Passed', 'Amended', 'In Progress', 'Introduced', 'Failed', 'Unknown'];

  const STATE_NAME_TO_CODE = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
    'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
    'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
    'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
    'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
    'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
    'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
    'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
  };

  // Canonical seven US states with enacted packaging EPR laws as of 2026,
  // in chronological order. Each entry references the bill version that we
  // expect to find in the SPC dataset; the home page panel falls back to
  // metadata-only display if a bill isn't in the current fetch.
  const ENACTED_PACKAGING_EPR = [
    { state: 'Maine',       version: 'LD1541A',      year: 2021, billLabel: 'LD 1541',           note: 'First state to enact packaging EPR' },
    { state: 'Oregon',      version: 'SB582B',       year: 2021, billLabel: 'SB 582',            note: 'First operational program (July 2025)' },
    { state: 'Colorado',    version: 'COHB221355RR', year: 2022, billLabel: 'HB 22-1355',        note: '' },
    { state: 'California',  version: 'SB54CH',       year: 2022, billLabel: 'SB 54',             note: '' },
    { state: 'Minnesota',   version: 'HF3911',       year: 2024, billLabel: 'HF 3911',           note: '' },
    { state: 'Maryland',    version: 'SB901C',       year: 2025, billLabel: 'SB 901',            note: '' },
    { state: 'Washington',  version: 'SB5284C',      year: 2025, billLabel: 'SB 5284',           note: '' },
  ];
  const STATUS_COLORS = {
    'Passed': '#0e6b56',
    'Amended': '#2a7ad6',
    'In Progress': '#6b4ec5',
    'Introduced': '#b88200',
    'Failed': '#a13a3a',
    'Unknown': '#6b7280',
  };

  const state = {
    policies: [],
    aggregates: null,
    fields: null,
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
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}`;
  }

  function parseHash() {
    const hash = window.location.hash.replace(/^#/, '') || '/';
    const [path, queryString] = hash.split('?');
    const params = new URLSearchParams(queryString || '');
    return { path: path || '/', params };
  }

  async function loadData() {
    const [polRes, aggRes, fieldsRes] = await Promise.all([
      fetch('data/policies.json', { cache: 'no-cache' }),
      fetch('data/aggregates.json', { cache: 'no-cache' }),
      fetch('data/fields.json', { cache: 'no-cache' }),
    ]);
    if (!polRes.ok || !aggRes.ok || !fieldsRes.ok) {
      throw new Error('Could not load data files');
    }
    const polData = await polRes.json();
    state.policies = polData.policies;
    state.metadata = polData.metadata;
    state.aggregates = await aggRes.json();
    state.fields = await fieldsRes.json();
  }

  function destroyCharts() {
    Object.keys(charts).forEach(k => {
      try { charts[k].destroy(); } catch (e) {}
      delete charts[k];
    });
  }

  // ---------- Routing ----------

  function route() {
    const rawHash = window.location.hash;

    // Same-page anchor (e.g. #enacted-states): scroll to the element if it
    // exists on the current view; do not re-render. If we're not on the home
    // view, route to home first, then scroll once the home view renders.
    if (rawHash && !rawHash.startsWith('#/')) {
      const id = rawHash.slice(1);
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // Element not on the current view: route to home and try again after.
      window.location.hash = '#/';
      requestAnimationFrame(() => {
        const t = document.getElementById(id);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }

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
      // URL params are the source of truth for filters. Anything not in the
      // URL resets to empty so that a filter from a previous browse call
      // doesn't bleed into a new one.
      state.statusFilter = new Set(params.getAll('status'));
      state.yearFilter = params.get('year') || '';
      state.stateFilter = params.get('state') || '';
      // Search query is interactive, not URL-driven, so leave it alone.
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
    const total = state.policies.length;
    const stateCount = Object.keys(state.aggregates.state_counts).filter(s => s !== 'Unknown').length;

    // Most recent year present in the dataset (we want the latest, e.g. 2026)
    const years = Object.keys(state.aggregates.year_counts).map(y => parseInt(y, 10)).filter(y => !isNaN(y));
    const currentYear = years.length ? Math.max(...years) : new Date().getFullYear();

    // States that introduced new bills in the current year
    const introducedCurrentYearStates = new Set(
      state.policies
        .filter(p => parseInt(p.year, 10) === currentYear && p.status === 'Introduced' && p.locationPrimary)
        .map(p => p.locationPrimary)
    );

    let deadlines = 0;
    state.policies.forEach(p => {
      if (p.status !== 'Passed' && p.status !== 'Amended') return;
      const t = p.timelines;
      if (t) deadlines += Object.keys(t).length;
    });

    node.querySelector('[data-slot=total-bills]').textContent = total;
    node.querySelector('[data-slot=total-states]').textContent = stateCount;
    node.querySelector('[data-slot=all-count]').textContent = total;
    node.querySelector('[data-slot=deadlines-count]').textContent = deadlines;
    node.querySelector('[data-slot=enacted-states-count]').textContent = ENACTED_PACKAGING_EPR.length;
    node.querySelector('[data-slot=introduced-current-year-count]').textContent = introducedCurrentYearStates.size;
    node.querySelector('[data-slot=current-year]').textContent = currentYear;

    // Make the "Bills introduced this year" tile link to a filter that
    // matches the count: status=Introduced AND year=<latest year>
    const introLink = node.querySelector('[data-slot=introduced-current-year-link]');
    if (introLink) introLink.setAttribute('href', `#/browse?status=Introduced&year=${currentYear}`);

    // Render the "States with Packaging EPR Laws" grid
    const grid = node.querySelector('[data-slot=enacted-states-grid]');
    if (grid) {
      ENACTED_PACKAGING_EPR.forEach(entry => {
        const policy = state.policies.find(p => p.version === entry.version);
        const card = document.createElement('a');
        card.className = 'state-card';
        card.href = policy ? `#/bill/${encodeURIComponent(entry.version)}` : '#/browse?status=Passed';
        const dateText = policy && policy.date ? formatDate(policy.date) : `${entry.year}`;
        card.innerHTML = `
          <div class="state-card-state">${escapeHtml(entry.state)}</div>
          <div class="state-card-bill">${escapeHtml(entry.billLabel)}</div>
          <div class="state-card-date">${escapeHtml(dateText)}</div>
          ${entry.note ? `<div class="state-card-note">${escapeHtml(entry.note)}</div>` : ''}
        `;
        grid.appendChild(card);
      });
    }

    if (state.metadata && state.metadata.fetched_at) {
      const slot = node.querySelector('[data-slot=fetched-at]');
      if (slot) slot.textContent = formatDate(state.metadata.fetched_at.slice(0, 10));
    }

    const recentList = node.querySelector('[data-slot=recent-list]');
    const recent = state.policies
      .filter(p => p.status === 'Passed' || p.status === 'Amended')
      .slice(0, 6);
    recent.forEach(p => {
      const row = document.createElement('a');
      row.href = '#/bill/' + encodeURIComponent(p.version);
      row.className = 'recent-row';
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(p.fullTitle)}</strong>
          <div class="recent-meta">${escapeHtml(p.locationPrimary || '')} &bull; ${escapeHtml(formatDate(p.date))}</div>
        </div>
        ${statusBadge(p.status)}
      `;
      recentList.appendChild(row);
    });

    root.appendChild(node);

    requestAnimationFrame(() => {
      renderStatusChart();
      renderUsMap(root);
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
          tooltip: { callbacks: { label: (item) => `${item.label}: ${item.parsed} bills` } },
        },
      },
    });
  }

  // Strongest legislative outcome per state, used to color-code the map.
  // Priority order: enacted (canonical 7) > passed > amended > introduced > failed > none.
  function classifyStateOutcome(stateName) {
    const enactedStates = new Set(ENACTED_PACKAGING_EPR.map(e => e.state));
    if (enactedStates.has(stateName)) return 'enacted';
    const bills = state.policies.filter(p => p.locationPrimary === stateName);
    if (!bills.length) return 'none';
    if (bills.some(b => b.status === 'Passed')) return 'passed';
    if (bills.some(b => b.status === 'Amended')) return 'amended';
    if (bills.some(b => b.status === 'Introduced')) return 'introduced';
    if (bills.some(b => b.status === 'Failed')) return 'failed';
    return 'none';
  }

  function summarizeStateForTooltip(stateName) {
    const bills = state.policies.filter(p => p.locationPrimary === stateName);
    const counts = { Passed: 0, Amended: 0, Introduced: 0, Failed: 0 };
    bills.forEach(b => {
      if (counts.hasOwnProperty(b.status)) counts[b.status] += 1;
    });
    const enacted = ENACTED_PACKAGING_EPR.find(e => e.state === stateName);
    const lines = [];
    if (enacted) {
      lines.push(`<strong>${stateName}</strong>`);
      lines.push(`Packaging EPR law: ${enacted.billLabel} (${enacted.year})`);
    } else if (bills.length) {
      lines.push(`<strong>${stateName}</strong>`);
    } else {
      lines.push(`<strong>${stateName}</strong>`);
      lines.push('No EPR bills tracked');
      return lines.join('<br>');
    }
    const breakdown = ['Passed', 'Amended', 'Introduced', 'Failed']
      .filter(k => counts[k] > 0)
      .map(k => `${counts[k]} ${k}`)
      .join(', ');
    if (breakdown) lines.push(breakdown);
    return lines.join('<br>');
  }

  async function renderUsMap(scope) {
    const host = scope.querySelector('[data-slot=map-host]');
    const tooltip = scope.querySelector('[data-slot=map-tooltip]');
    if (!host) return;

    let svgText;
    try {
      const resp = await fetch('assets/us-map.svg', { cache: 'force-cache' });
      svgText = await resp.text();
    } catch (e) {
      host.innerHTML = '<p style="color:var(--color-text-muted);text-align:center">Map could not load.</p>';
      return;
    }
    host.innerHTML = svgText;

    const svg = host.querySelector('svg');
    if (!svg) return;
    svg.classList.add('us-map');

    // Color each state by its strongest legislative outcome
    Object.entries(STATE_NAME_TO_CODE).forEach(([name, code]) => {
      const path = svg.querySelector('#' + code);
      if (!path) return;
      const cls = 'state-' + classifyStateOutcome(name);
      path.classList.add(cls);
      path.setAttribute('data-state', name);
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-label', name);
    });

    // Hover / focus tooltip
    function showTooltip(targetEl, evt) {
      const name = targetEl.getAttribute('data-state');
      if (!name) return;
      tooltip.innerHTML = summarizeStateForTooltip(name);
      tooltip.setAttribute('aria-hidden', 'false');
      tooltip.style.display = 'block';
      const hostRect = host.getBoundingClientRect();
      const x = (evt && evt.clientX !== undefined) ? evt.clientX - hostRect.left : 0;
      const y = (evt && evt.clientY !== undefined) ? evt.clientY - hostRect.top : 0;
      tooltip.style.left = (x + 14) + 'px';
      tooltip.style.top = (y + 14) + 'px';
    }
    function hideTooltip() {
      tooltip.setAttribute('aria-hidden', 'true');
      tooltip.style.display = 'none';
    }

    svg.addEventListener('mousemove', (e) => {
      const path = e.target.closest('path[data-state]');
      if (path) showTooltip(path, e);
      else hideTooltip();
    });
    svg.addEventListener('mouseleave', hideTooltip);

    svg.addEventListener('click', (e) => {
      const path = e.target.closest('path[data-state]');
      if (!path) return;
      const name = path.getAttribute('data-state');
      const bills = state.policies.filter(p => p.locationPrimary === name);
      if (bills.length) {
        // Persist the filter choice and navigate
        state.stateFilter = name;
        state.statusFilter.clear();
        window.location.hash = '#/browse';
      }
    });

    svg.addEventListener('keydown', (e) => {
      const path = e.target.closest('path[data-state]');
      if (!path) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        path.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
  }

  // ---------- About ----------

  function renderAbout(root) {
    const node = el('tpl-about');
    const list = node.querySelector('[data-slot=elements-list]');
    list.className = 'elements-list';

    state.fields.categories.forEach((cat, i) => {
      if (!cat.options.length) return;
      const div = document.createElement('div');
      div.className = 'element-item';
      const counts = state.aggregates.elements
        .filter(e => e.category === cat.title)
        .map(e => e.bill_count);
      const totalBills = counts.length ? Math.max(...counts) : 0;
      div.innerHTML = `
        <div class="name"><span>${i + 1}. ${escapeHtml(cat.title)}</span><span class="count">up to ${totalBills} bills cover this</span></div>
        <div class="options">${cat.options.map(o => `${escapeHtml(o.title)}`).join(' &bull; ')}</div>
      `;
      list.appendChild(div);
    });

    root.appendChild(node);
  }

  // ---------- Browse ----------

  function renderBrowse(root) {
    const node = el('tpl-browse');

    const chipBox = node.querySelector('[data-slot=status-chips]');
    STATUS_ORDER.forEach(s => {
      if (!(state.aggregates.status_counts[s] > 0)) return;
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.textContent = s;
      const pressed = state.statusFilter.has(s);
      chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      chip.addEventListener('click', () => {
        if (state.statusFilter.has(s)) state.statusFilter.delete(s);
        else state.statusFilter.add(s);
        rerenderBrowseList(node);
        chip.setAttribute('aria-pressed', state.statusFilter.has(s) ? 'true' : 'false');
      });
      chipBox.appendChild(chip);
    });

    const stateSel = node.querySelector('[data-slot=state-filter]');
    const statesList = Array.from(new Set(state.policies.map(p => p.locationPrimary).filter(Boolean))).sort();
    statesList.forEach(s => {
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

    const yearSel = node.querySelector('[data-slot=year-filter]');
    const years = Array.from(new Set(state.policies.map(p => p.year).filter(y => y != null))).sort((a, b) => b - a);
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

    const search = node.querySelector('[data-slot=search-input]');
    search.value = state.searchQuery;
    search.addEventListener('input', () => {
      state.searchQuery = search.value.toLowerCase();
      rerenderBrowseList(node);
    });

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
    const filtered = state.policies.filter(p => {
      if (state.statusFilter.size && !state.statusFilter.has(p.status)) return false;
      if (state.stateFilter && p.locationPrimary !== state.stateFilter) return false;
      if (state.yearFilter && String(p.year) !== state.yearFilter) return false;
      if (state.searchQuery) {
        const hay = [p.fullTitle, p.locationPrimary, p.version, p.status, p.summary].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(state.searchQuery)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const sa = STATUS_ORDER.indexOf(a.status || 'Unknown');
      const sb = STATUS_ORDER.indexOf(b.status || 'Unknown');
      if (sa !== sb) return sa - sb;
      return (b.date || '').localeCompare(a.date || '');
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
        <div>Bill</div><div>State</div><div>Date</div><div>Status</div><div></div>
      </div>
    `;
    filtered.forEach(p => {
      const row = document.createElement('div');
      row.className = 'results-row' + (p.status === 'Failed' ? ' is-failed' : '');
      row.innerHTML = `
        <div><strong>${escapeHtml(p.version)}</strong><br><span style="font-size:0.85rem;color:var(--color-text-muted)">${escapeHtml(p.fullTitle)}</span></div>
        <div>${escapeHtml(p.locationPrimary || '')}</div>
        <div>${escapeHtml(formatDate(p.date))}</div>
        <div>${statusBadge(p.status)}</div>
        <div><a class="view-btn" href="#/bill/${encodeURIComponent(p.version)}">View</a></div>
      `;
      table.appendChild(row);
    });
    target.appendChild(table);
  }

  // ---------- Bill detail ----------

  function renderBill(root, id) {
    const policy = state.policies.find(p => p.version === id);
    if (!policy) {
      root.appendChild(el('tpl-not-found'));
      return;
    }
    const node = el('tpl-bill');
    node.querySelector('[data-slot=name]').textContent = policy.fullTitle || '';
    node.querySelector('[data-slot=state]').textContent = policy.locationPrimary || '';
    node.querySelector('[data-slot=date]').textContent = formatDate(policy.date) || policy.year || '';
    node.querySelector('[data-slot=id]').textContent = policy.version || '';
    node.querySelector('[data-slot=status-badge]').outerHTML = statusBadge(policy.status);

    const sourceLine = node.querySelector('[data-slot=source-line]');
    const links = [];
    if (policy.link) {
      links.push(`<a href="${escapeHtml(policy.link)}" target="_blank" rel="noopener">Official bill text</a>`);
    }
    links.push(`<a href="https://epr.sustainablepackaging.org/policies/${encodeURIComponent(policy.version)}" target="_blank" rel="noopener">View on SPC</a>`);
    sourceLine.innerHTML = `Source: ${links.join(' &bull; ')}`;

    // Summary
    const summaryWrap = node.querySelector('[data-slot=summary]');
    if (summaryWrap) {
      if (policy.summary) {
        summaryWrap.textContent = policy.summary;
      } else {
        summaryWrap.style.display = 'none';
      }
    }

    // Compliance Snapshot from timelines
    const compliance = policy.timelines;
    const complianceWrap = node.querySelector('[data-slot=compliance]');
    const complianceBody = node.querySelector('[data-slot=compliance-body]');
    if (compliance && Object.keys(compliance).length) {
      const dl = document.createElement('dl');
      const optionTitles = (state.fields.categories.find(c => c.key === 'timelines') || {}).options || [];
      const titleByKey = Object.fromEntries(optionTitles.map(o => [o.key, o.title]));
      Object.keys(compliance).forEach(k => {
        const dt = document.createElement('dt');
        dt.textContent = titleByKey[k] || k;
        const dd = document.createElement('dd');
        dd.textContent = compliance[k];
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
      complianceBody.appendChild(dl);
    } else {
      complianceWrap.style.display = 'none';
    }

    // Provisions in field-defined category order
    const provBox = node.querySelector('[data-slot=provisions]');
    let firstOpened = false;
    state.fields.categories.forEach(cat => {
      const data = policy[cat.key];
      if (!data || typeof data !== 'object' || !Object.keys(data).length) return;
      const det = document.createElement('details');
      det.className = 'element-card';
      if (!firstOpened) { det.open = true; firstOpened = true; }
      const sum = document.createElement('summary');
      sum.className = 'element-summary';
      const keyCount = Object.keys(data).length;
      sum.innerHTML = `<span>${escapeHtml(cat.title)}</span><span style="color:var(--color-text-muted);font-weight:normal;font-size:0.85rem">${keyCount} provision${keyCount === 1 ? '' : 's'}</span>`;
      det.appendChild(sum);
      const body = document.createElement('div');
      body.className = 'element-body';
      const titleByKey = Object.fromEntries((cat.options || []).map(o => [o.key, o.title]));
      Object.entries(data).forEach(([key, value]) => {
        if (!value) return;
        const wrap = document.createElement('div');
        wrap.className = 'subprov';
        const h4 = document.createElement('h4');
        h4.textContent = titleByKey[key] || humaniseKey(key);
        wrap.appendChild(h4);
        const p = document.createElement('p');
        p.className = 'chunk';
        // SPC text uses literal newlines and bullet markers; preserve line breaks
        p.style.whiteSpace = 'pre-wrap';
        p.textContent = value;
        wrap.appendChild(p);
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

  // Light camelCase humaniser, used as a fallback when fields.json has no
  // matching entry (e.g. SPC adds a new sub-field after our last fetch).
  function humaniseKey(key) {
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^\w/, c => c.toUpperCase());
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
    const optionTitles = (state.fields.categories.find(c => c.key === 'timelines') || {}).options || [];
    const titleByKey = Object.fromEntries(optionTitles.map(o => [o.key, o.title]));

    const rows = [];
    state.policies.forEach(p => {
      if (state.deadlinesPassedOnly && p.status !== 'Passed' && p.status !== 'Amended') return;
      const t = p.timelines;
      if (!t) return;
      Object.keys(t).forEach(k => {
        rows.push({
          state: p.locationPrimary,
          fullTitle: p.fullTitle,
          version: p.version,
          status: p.status,
          deadlineType: titleByKey[k] || k,
          summary: t[k],
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
          <a href="#/bill/${encodeURIComponent(r.version)}"><strong>${escapeHtml(r.fullTitle)}</strong></a>
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

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
    } else if (path === '/verification') {
      renderVerification(app);
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

  // ---------- Verification (PPWR) ----------
  // Lazy-loaded view: pulls data/ppwr_verification.json on first render and
  // caches the result on the state object. Independent of the SPC dataset
  // boot path, so the home/browse/deadlines/bill views stay unaffected.

  const VERIF_PPWR_URL = 'https://eur-lex.europa.eu/eli/reg/2025/40/oj';
  const verifState = {
    data: null,
    loading: false,
    error: null,
    source: new Set(),
    loctype: new Set(),
    act: new Set(),
    chips: new Set(),
    search: '',
    selectedId: null,
  };

  function verifSortKey(e) {
    const ltOrder = { whereas: 0, article: 1, annex: 2, heading: 3, footnote: 4 };
    const lto = ltOrder[e.location_type] === undefined ? 9 : ltOrder[e.location_type];
    const loc = e.location;
    const isNum = /^\d+$/.test(loc);
    const num = isNum ? parseInt(loc, 10) : 999;
    const romanOrder = { VI: 1, VII: 2, VIII: 3, IX: 4, X: 5 };
    const ro = romanOrder[loc] === undefined ? 99 : romanOrder[loc];
    return [lto, num, ro, e.id];
  }
  function verifCompare(a, b) {
    const ka = verifSortKey(a), kb = verifSortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  }

  function verifLocationTitle(e) {
    if (e.location_type === 'whereas') return 'Recital ' + e.location;
    if (e.location_type === 'article') return 'Article ' + e.location;
    if (e.location_type === 'annex') return 'Annex ' + e.location;
    if (e.location_type === 'heading') return 'Heading: ' + e.location;
    if (e.location_type === 'footnote') return 'Footnote ' + e.location;
    return e.location_type + ' ' + e.location;
  }

  function verifEntryMatches(entry) {
    if (verifState.source.size && !verifState.source.has(entry.source_file)) return false;
    if (verifState.loctype.size && !verifState.loctype.has(entry.location_type)) return false;
    if (verifState.act.size) {
      const tags = entry.act_type_in_sentence || [];
      let any = false;
      for (const t of verifState.act) {
        if (t === 'none') {
          if (tags.length === 0) { any = true; break; }
        } else if (tags.indexOf(t) !== -1) { any = true; break; }
      }
      if (!any) return false;
    }
    if (verifState.chips.size) {
      const c = entry.chips || [];
      let any = false;
      for (const ch of verifState.chips) if (c.indexOf(ch) !== -1) { any = true; break; }
      if (!any) return false;
    }
    if (verifState.search) {
      if (entry.sentence.toLowerCase().indexOf(verifState.search.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function verifHighlight(text, query) {
    if (!query) return escapeHtml(text);
    const safe = escapeHtml(text);
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(q, 'gi'), function (m) {
      return '<mark class="verif-search-hit">' + m + '</mark>';
    });
  }

  function verifRenderEntryCard(entry) {
    const trunc = entry.sentence.length > 220 ? entry.sentence.slice(0, 220) + '...' : entry.sentence;
    const chipPills = (entry.chips || []).map(function (c) {
      return '<span class="verif-chip-mini">' + escapeHtml(c) + '</span>';
    }).join('');
    const actPills = (entry.act_type_in_sentence || []).map(function (a) {
      return '<span class="verif-chip-mini verif-act">' + escapeHtml(a) + '</span>';
    }).join('');
    const extPills = (entry.external_refs || []).map(function (r) {
      return '<span class="verif-chip-mini verif-ext">' + escapeHtml(r.citation) + '</span>';
    }).join('');
    const subHtml = entry.sub_location ? '<p class="verif-sub">' + escapeHtml(entry.sub_location) + '</p>' : '';
    const selected = verifState.selectedId === entry.id ? ' is-selected' : '';
    return '<div class="verif-card' + selected + '" data-id="' + escapeHtml(entry.id) + '">' +
      '<div class="verif-card-head">' +
      '<div><span class="verif-id">' + escapeHtml(entry.id) + '</span>' +
      '<span class="verif-loc">' + escapeHtml(verifLocationTitle(entry)) + '</span></div>' +
      '<span class="verif-source">' + escapeHtml(entry.source_file) + '</span></div>' +
      subHtml +
      '<p class="verif-sentence">' + verifHighlight(trunc, verifState.search) + '</p>' +
      '<div class="verif-pills">' + chipPills + actPills + extPills + '</div></div>';
  }

  function verifRenderEntryDetail(entry) {
    const detail = document.querySelector('[data-slot=verif-detail]');
    if (!detail) return;
    if (!entry) {
      detail.innerHTML = '<p class="verif-empty">Select an entry to see the verbatim source sentence, glossary terms, and external links. Use "Read in PPWR" to jump to the regulation.</p>';
      return;
    }
    let sentenceHtml = verifHighlight(entry.sentence, verifState.search);
    const glossTerms = entry.glossary_terms_in_sentence || [];
    if (glossTerms.length) {
      const sortedTerms = glossTerms.slice().sort(function (a, b) { return b.length - a.length; });
      const escapedTerms = sortedTerms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
      const combined = new RegExp('\\b(' + escapedTerms.join('|') + ')s?\\b', 'gi');
      sentenceHtml = sentenceHtml.replace(combined, function (m, p1) {
        const lower = p1.toLowerCase();
        const matched = sortedTerms.find(function (t) { return t.toLowerCase() === lower; }) || p1;
        return '<span class="verif-gloss-term" data-term="' + escapeHtml(matched) + '">' + m + '</span>';
      });
    }
    const chipPills = (entry.chips || []).map(function (c) { return '<span class="verif-chip-mini">' + escapeHtml(c) + '</span>'; }).join('');
    const actPills = (entry.act_type_in_sentence || []).map(function (a) { return '<span class="verif-chip-mini verif-act">' + escapeHtml(a) + '</span>'; }).join('');
    const extLinks = (entry.external_refs || []).map(function (r) {
      return '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener" class="verif-chip-mini verif-ext">' + escapeHtml(r.citation) + ' &#8599;</a>';
    }).join('');
    const glossList = glossTerms.map(function (t) { return '<span class="verif-chip-mini verif-gloss-chip" data-term="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>'; }).join('');

    const subHtml = entry.sub_location ? '<p class="verif-sub" style="margin-top:4px;">' + escapeHtml(entry.sub_location) + '</p>' : '';
    detail.innerHTML =
      '<div class="verif-detail-head">' +
      '<div class="verif-detail-row"><span class="verif-id">' + escapeHtml(entry.id) + '</span>' +
      '<span class="verif-source">' + escapeHtml(entry.source_file) + '</span></div>' +
      '<h3>' + escapeHtml(verifLocationTitle(entry)) + '</h3>' + subHtml + '</div>' +
      '<div class="verif-detail-section"><p class="verif-detail-label">Source sentence (verbatim)</p>' +
      '<p class="verif-sentence-block">' + sentenceHtml + '</p></div>' +
      '<div class="verif-detail-section"><a href="' + VERIF_PPWR_URL + '" target="_blank" rel="noopener" class="verif-read-link">Read in PPWR (EUR-Lex) &#8599;</a></div>' +
      (chipPills ? '<div class="verif-detail-section"><p class="verif-detail-label">Topics</p>' + chipPills + '</div>' : '') +
      (actPills ? '<div class="verif-detail-section"><p class="verif-detail-label">Commission-act mention</p>' + actPills + '</div>' : '') +
      (extLinks ? '<div class="verif-detail-section"><p class="verif-detail-label">External instruments cited</p>' + extLinks + '</div>' : '') +
      (glossList ? '<div class="verif-detail-section"><p class="verif-detail-label">Article 3 terms in sentence (click to define)</p>' + glossList + '</div>' : '') +
      '<p class="verif-detail-foot">For surrounding paragraph context, use the "Read in PPWR" link and navigate to ' +
      escapeHtml(verifLocationTitle(entry)) + (entry.sub_location ? ', ' + escapeHtml(entry.sub_location) : '') + '.</p>';

    detail.querySelectorAll('.verif-gloss-term, .verif-gloss-chip').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        verifShowGlossaryPopover(el.dataset.term, ev);
      });
    });
  }

  function verifShowGlossaryPopover(term, event) {
    const data = verifState.data;
    if (!data) return;
    const entry = data.glossary.find(function (g) { return g.term.toLowerCase() === term.toLowerCase(); });
    if (!entry) return;
    verifClosePopover();
    const pop = document.createElement('div');
    pop.id = 'verif-popover';
    pop.className = 'verif-popover';
    pop.style.left = Math.min(event.clientX, window.innerWidth - 420) + 'px';
    pop.style.top = Math.min(event.clientY + 12, window.innerHeight - 260) + 'px';
    const ptStr = entry.point ? 'Point (' + entry.point + ')' : 'Point lost in source MD';
    let body;
    if (entry.multi_part) {
      body = '<p class="verif-multi-note">Multi-part definition (' + entry.parts_count + ' subparts)</p>' +
        entry.definition_parts.map(function (p, i) { return '<p>(' + (i + 1) + ') ' + escapeHtml(p) + '</p>'; }).join('');
    } else {
      body = '<p>' + escapeHtml(entry.definition) + '</p>';
    }
    pop.innerHTML =
      '<div class="verif-popover-head"><div>' +
      '<p class="verif-popover-pt">' + ptStr + '</p>' +
      '<h4>' + escapeHtml(entry.term) + '</h4></div>' +
      '<button class="verif-popover-close" onclick="(function(){var p=document.getElementById(\'verif-popover\');if(p)p.remove();})()">&times;</button></div>' +
      body +
      '<p class="verif-line-ref">PPWR Article 3, source line(s) ' + entry.source_lines.join(', ') + '</p>';
    document.body.appendChild(pop);
    setTimeout(function () { document.addEventListener('click', verifClosePopover, { once: true }); }, 50);
  }
  function verifClosePopover() {
    const p = document.getElementById('verif-popover');
    if (p) p.remove();
  }

  function verifRender(root) {
    const data = verifState.data;
    if (!data) return;
    const filtered = data.entries.filter(verifEntryMatches).sort(verifCompare);
    const counter = document.querySelector('[data-slot=verif-counter]');
    if (counter) counter.textContent = filtered.length + ' of ' + data.entries.length + ' entries';
    const list = document.querySelector('[data-slot=verif-list]');
    if (list) {
      list.innerHTML = filtered.length
        ? filtered.map(verifRenderEntryCard).join('')
        : '<p class="verif-empty">No entries match the current filters.</p>';
      list.querySelectorAll('.verif-card').forEach(function (c) {
        c.addEventListener('click', function () {
          verifState.selectedId = c.dataset.id;
          verifRender(root);
        });
      });
    }
    if (verifState.selectedId) {
      const sel = data.entries.find(function (e) { return e.id === verifState.selectedId; });
      verifRenderEntryDetail(sel);
    } else {
      verifRenderEntryDetail(null);
    }
  }

  function verifBuildFilters(node) {
    const data = verifState.data;
    if (!data) return;
    const sources = ['verif', 'audit', 'authorised'];
    const sourceTarget = node.querySelector('[data-slot=verif-filter-source]');
    sourceTarget.innerHTML = sources.map(function (s) {
      const n = data.entries.filter(function (e) { return e.source_file === s; }).length;
      return '<button class="chip" data-filter="source" data-value="' + s + '" type="button">' + s + ' (' + n + ')</button>';
    }).join('');

    const lts = ['whereas', 'article', 'annex', 'heading', 'footnote'];
    const labels = { whereas: 'Recitals', article: 'Articles', annex: 'Annexes', heading: 'Headings', footnote: 'Footnotes' };
    const ltTarget = node.querySelector('[data-slot=verif-filter-loctype]');
    ltTarget.innerHTML = lts.map(function (s) {
      const n = data.entries.filter(function (e) { return e.location_type === s; }).length;
      if (!n) return '';
      return '<button class="chip" data-filter="loctype" data-value="' + s + '" type="button">' + labels[s] + ' (' + n + ')</button>';
    }).join('');

    const acts = ['implementing_act', 'delegated_act', 'implementing_powers'];
    const actLabels = { implementing_act: 'Implementing act', delegated_act: 'Delegated act', implementing_powers: 'Implementing powers' };
    const actTarget = node.querySelector('[data-slot=verif-filter-act]');
    let actHtml = acts.map(function (a) {
      const n = data.entries.filter(function (e) { return (e.act_type_in_sentence || []).indexOf(a) !== -1; }).length;
      return '<button class="chip" data-filter="act" data-value="' + a + '" type="button">' + actLabels[a] + ' (' + n + ')</button>';
    }).join('');
    const noneCount = data.entries.filter(function (e) { return (e.act_type_in_sentence || []).length === 0; }).length;
    actHtml += '<button class="chip" data-filter="act" data-value="none" type="button">No mention (' + noneCount + ')</button>';
    actTarget.innerHTML = actHtml;

    const chipsTarget = node.querySelector('[data-slot=verif-filter-chips]');
    chipsTarget.innerHTML = data.chip_vocabulary.map(function (c) {
      const n = data.entries.filter(function (e) { return (e.chips || []).indexOf(c) !== -1; }).length;
      return '<button class="chip" data-filter="chips" data-value="' + escapeHtml(c) + '" type="button">' + escapeHtml(c) + ' (' + n + ')</button>';
    }).join('');

    node.querySelectorAll('[data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const filter = btn.dataset.filter;
        const value = btn.dataset.value;
        const set = verifState[filter];
        if (set.has(value)) set.delete(value);
        else set.add(value);
        const pressed = set.has(value);
        btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        verifRender(document.getElementById('app'));
      });
    });
  }

  function verifResetFilters() {
    verifState.source.clear();
    verifState.loctype.clear();
    verifState.act.clear();
    verifState.chips.clear();
    verifState.search = '';
    verifState.selectedId = null;
    document.querySelectorAll('.verif-filters [data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    const s = document.querySelector('[data-slot=verif-search]');
    if (s) s.value = '';
    verifRender(document.getElementById('app'));
  }

  function verifOpenGlossary() {
    const data = verifState.data;
    if (!data) return;
    const overlay = document.createElement('div');
    overlay.className = 'verif-modal-overlay';
    overlay.id = 'verif-glossary-modal';
    const itemsHtml = data.glossary.map(function (g) {
      const ptStr = g.point ? '(' + g.point + ')' : '(no point)';
      let body;
      if (g.multi_part) {
        body = '<p class="verif-multi-note">Multi-part definition, ' + g.parts_count + ' subparts</p>' +
          g.definition_parts.map(function (p, i) { return '<p>(' + (i + 1) + ') ' + escapeHtml(p) + '</p>'; }).join('');
      } else {
        body = '<p>' + escapeHtml(g.definition) + '</p>';
      }
      return '<div class="verif-gloss-entry">' +
        '<div class="verif-gloss-head"><h4><span class="verif-gloss-pt">' + ptStr + '</span>' + escapeHtml(g.term) + '</h4>' +
        '<span class="verif-gloss-line">line ' + g.source_lines.join(',') + '</span></div>' +
        body + '</div>';
    }).join('');
    overlay.innerHTML =
      '<div class="verif-modal">' +
      '<div class="verif-modal-head"><div><h2>Article 3 Glossary</h2>' +
      '<p class="verif-modal-sub">Definitions verbatim from PPWR (Regulation EU 2025/40), Article 3</p></div>' +
      '<button class="verif-modal-close">&times;</button></div>' +
      '<div class="verif-modal-search"><input type="search" id="verif-gloss-search" placeholder="Search glossary terms..." /></div>' +
      '<div class="verif-modal-body" id="verif-gloss-list">' + itemsHtml + '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.verif-modal-close').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) overlay.remove(); });
    document.getElementById('verif-gloss-search').addEventListener('input', function (ev) {
      const q = ev.target.value.trim().toLowerCase();
      const filtered = q
        ? data.glossary.filter(function (g) { return g.term.toLowerCase().indexOf(q) !== -1 || g.definition.toLowerCase().indexOf(q) !== -1; })
        : data.glossary;
      document.getElementById('verif-gloss-list').innerHTML = filtered.length
        ? filtered.map(function (g) {
          const ptStr = g.point ? '(' + g.point + ')' : '(no point)';
          let body;
          if (g.multi_part) {
            body = '<p class="verif-multi-note">Multi-part definition, ' + g.parts_count + ' subparts</p>' +
              g.definition_parts.map(function (p, i) { return '<p>(' + (i + 1) + ') ' + escapeHtml(p) + '</p>'; }).join('');
          } else {
            body = '<p>' + escapeHtml(g.definition) + '</p>';
          }
          return '<div class="verif-gloss-entry">' +
            '<div class="verif-gloss-head"><h4><span class="verif-gloss-pt">' + ptStr + '</span>' + escapeHtml(g.term) + '</h4>' +
            '<span class="verif-gloss-line">line ' + g.source_lines.join(',') + '</span></div>' +
            body + '</div>';
        }).join('')
        : '<p class="verif-empty">No terms match the search.</p>';
    });
  }

  function verifOpenAbout() {
    const overlay = document.createElement('div');
    overlay.className = 'verif-modal-overlay';
    overlay.id = 'verif-about-modal';
    overlay.innerHTML =
      '<div class="verif-modal" style="max-width:640px;">' +
      '<div class="verif-modal-head"><h2>How this view was built</h2>' +
      '<button class="verif-modal-close">&times;</button></div>' +
      '<div class="verif-modal-body verif-about-body">' +
      '<p><strong>Purpose.</strong> A navigable index of every sentence about verification, audit, and authorised entities in Regulation (EU) 2025/40 (PPWR), drawn from three keyword-extracted source JSONs.</p>' +
      '<p><strong>Discipline.</strong> Sentence text is byte-equal to the source. Article 3 definitions are byte-equal to the regulation. Mechanical tags (Commission-act mentions, external citations, glossary term presence) are derived from literal source words by regex. Topic chips are authored labels and the only field on this view carrying authoring judgment.</p>' +
      '<p><strong>What this view is not.</strong> Not legal advice. Not an applicability assessment. Not a compliance check. Each user is responsible for reading the source sentence and deciding whether it applies to their own operation.</p>' +
      '<p><strong>Surrounding paragraph context.</strong> Use the "Read in PPWR" link on any selected entry to open Regulation (EU) 2025/40 on EUR-Lex and navigate to the cited location.</p>' +
      '<p><strong>Caveat on the glossary.</strong> 14 of 71 Article 3 definitions are extracted without their original point numbers because the regulation source markdown lost the (N) prefix during processing. Verify against the official OJ text before relying on these for compliance work.</p>' +
      '<p class="verif-about-foot">Built 2026-05-01.</p>' +
      '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.verif-modal-close').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) overlay.remove(); });
  }

  async function verifLoadData() {
    if (verifState.data) return verifState.data;
    if (verifState.loading) return null;
    verifState.loading = true;
    try {
      const resp = await fetch('data/ppwr_verification.json', { cache: 'no-cache' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      verifState.data = await resp.json();
      verifState.error = null;
    } catch (e) {
      verifState.error = e.message || 'Could not load verification data.';
    } finally {
      verifState.loading = false;
    }
    return verifState.data;
  }

  async function renderVerification(root) {
    if (!verifState.data) {
      root.appendChild(el('tpl-verification-loading'));
      const data = await verifLoadData();
      if (!data) {
        root.innerHTML = '';
        const errNode = el('tpl-verification-error');
        const slot = errNode.querySelector('[data-slot=verif-error-msg]');
        if (slot) slot.textContent = verifState.error || '';
        root.appendChild(errNode);
        return;
      }
      root.innerHTML = '';
    }
    const node = el('tpl-verification');
    root.appendChild(node);

    const scope = root;
    verifBuildFilters(scope);
    const search = scope.querySelector('[data-slot=verif-search]');
    if (search) {
      search.value = verifState.search;
      search.addEventListener('input', function (ev) {
        verifState.search = ev.target.value.trim();
        verifRender(root);
      });
    }
    const reset = scope.querySelector('[data-slot=verif-reset]');
    if (reset) reset.addEventListener('click', verifResetFilters);
    const gloss = scope.querySelector('[data-slot=verif-glossary-open]');
    if (gloss) gloss.addEventListener('click', verifOpenGlossary);
    const about = scope.querySelector('[data-slot=verif-about-open]');
    if (about) about.addEventListener('click', verifOpenAbout);

    verifRender(root);
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
    // Populate footer fetched-at slot now that data is loaded.
    if (state.metadata && state.metadata.fetched_at) {
      const slot = document.querySelector('[data-slot=fetched-at]');
      if (slot) slot.textContent = formatDate(state.metadata.fetched_at.slice(0, 10));
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

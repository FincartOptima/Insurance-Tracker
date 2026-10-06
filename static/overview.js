const $ = (id) => document.getElementById(id);

const PALETTE = ["#1747bd", "#568ef0", "#102a56", "#91b6f6", "#326ec9",
                 "#b7cff5", "#1b518b", "#6ea8de", "#4163a1", "#d0e1fa"];

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function compact(n) {
  n = n || 0;
  if (Math.abs(n) >= 1e7) return "₹" + (n / 1e7).toFixed(2) + " Cr";
  if (Math.abs(n) >= 1e5) return "₹" + (n / 1e5).toFixed(2) + " L";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function plainDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtDays(d) {
  if (d === null || d === undefined) return "";
  return `${Math.abs(d)}d overdue`;
}

const charts = {};
function render(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), config);
}

function syncOptions(id, label, options, selectedValue) {
  const select = $(id);
  select.replaceChildren(
    new Option(label, "all"),
    ...options.map((v) => new Option(v, v)),
  );
  select.value = selectedValue;
}
function syncMonthOptions(id, options, selectedValue) {
  const select = $(id);
  const fmt = (ym) => {
    const [y, m] = ym.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  };
  select.replaceChildren(
    new Option("All months", "all"),
    ...options.map((ym) => new Option(fmt(ym), ym)),
  );
  select.value = selectedValue;
}

/* --- portfolio-wide summary: KPI cards, team overdue/upcoming, type & insurer mix --- */

async function refresh() {
  $("overview-error").hidden = true;
  try {
  const res = await fetch("/api/overview", { cache: "no-store" });
  if (!res.ok) throw new Error("Unable to load portfolio");
  const data = await res.json();

  $("ov-overdue").textContent = data.total_overdue.toLocaleString("en-IN");
  $("ov-upcoming").textContent = data.total_upcoming.toLocaleString("en-IN");
  $("ov-active").textContent = data.total_active.toLocaleString("en-IN");
  $("ov-asof").textContent = `As of ${plainDate(data.as_of)} · IST`;

  const teams = data.team_breakdown;
  $("team-table-body").innerHTML = teams.map((t) => `
    <tr><th scope="row">${esc(t.team)}</th>
      <td class="numeric">${t.overdue.toLocaleString("en-IN")}</td>
      <td class="numeric">${t.upcoming.toLocaleString("en-IN")}</td>
    </tr>`).join("") ||
    `<tr><td colspan="3">No team data yet.</td></tr>`;

  render("team-chart", {
    type: "bar",
    data: {
      labels: teams.map((t) => t.team),
      datasets: [
        { label: "Overdue", data: teams.map((t) => t.overdue), backgroundColor: "#1747bd" },
        { label: "Upcoming (30d)", data: teams.map((t) => t.upcoming), backgroundColor: "#91b6f6" },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: false }, y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { position: "bottom" } },
    },
  });

  const types = data.business_type;
  render("type-chart", {
    type: "doughnut",
    data: {
      labels: types.map((t) => t.label),
      datasets: [{ data: types.map((t) => t.count), backgroundColor: PALETTE }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${c.parsed.toLocaleString("en-IN")} policies` } },
      },
    },
  });

  const insurers = data.insurer.slice(0, 10);
  render("insurer-chart", {
    type: "bar",
    data: {
      labels: insurers.map((i) => i.label),
      datasets: [{ label: "Policies", data: insurers.map((i) => i.count), backgroundColor: PALETTE }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => {
              const row = insurers[c.dataIndex];
              return `${row.count.toLocaleString("en-IN")} policies · ${compact(row.premium)} premium`;
            },
          },
        },
      },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
  } catch (error) {
    $('overview-error').hidden = false;
    $('ov-asof').textContent = 'Portfolio data is unavailable.';
  }
}

/* --- Overdue policies: filterable the same way as the renewal tracker --- */

let overduePolicies = [];
let overduePage = 1;
const OVERDUE_PAGE_SIZE = 25;
let odSearchTimer = null;
let odRequestId = 0;
let odController = null;
let odAppliedParams = null;
let odExporting = false;

function odSetError(message) {
  $('od-error-message').textContent = message;
  $('od-error').hidden = !message;
}
function odMarkPending() {
  odRequestId++;
  if (odController) odController.abort();
  $('od-export').disabled = true;
  $('overdue-section').setAttribute('aria-busy', 'true');
  $('od-caption').textContent = 'Updating overdue policies…';
}
function odSyncExport() {
  $('od-export').disabled = odExporting || !overduePolicies.length ||
    $('overdue-section').getAttribute('aria-busy') === 'true' ||
    !odAppliedParams || odAppliedParams.toString() !== odParams().toString() ||
    !$('od-error').hidden;
}

function odParams() {
  return new URLSearchParams({
    bucket: "overdue",
    q: $("od-search").value.trim(),
    month: $("od-month-filter").value,
    team: $("od-team-filter").value,
    rm: $("od-rm-filter").value,
    type: $("od-type-filter").value,
    status: $("od-status-filter").value,
  });
}

async function refreshOverdue() {
  clearTimeout(odSearchTimer);
  odMarkPending();
  const id = odRequestId;
  odController = new AbortController();
  const params = odParams();
  odSetError('');
  try {
    const res = await fetch('/api/renewals?' + params, { cache: 'no-store', signal: odController.signal });
    if (!res.ok) throw new Error('Could not load overdue policies. Please try again.');
    const data = await res.json();
    if (id !== odRequestId) return;

  syncOptions("od-team-filter", "All teams", data.team_options, data.team);
  syncOptions("od-rm-filter", "All managers", data.rm_options, data.rm);
  syncOptions("od-type-filter", "All types", data.type_options, data.insurance_type);
  syncMonthOptions("od-month-filter", data.month_options, data.month);

  overduePolicies = data.rows;
  overduePage = 1;
  odAppliedParams = new URLSearchParams(params);

  const teamCounts = {};
  for (const r of overduePolicies) teamCounts[r.team] = (teamCounts[r.team] || 0) + 1;
  const teamOrder = Object.keys(teamCounts).sort((a, b) => teamCounts[b] - teamCounts[a]);
  const activeTeam = $("od-team-filter").value;

  render("overdue-team-chart", {
    type: "bar",
    data: {
      labels: teamOrder,
      datasets: [{ label: "Overdue", data: teamOrder.map((t) => teamCounts[t]),
                   backgroundColor: teamOrder.map((t) => t === activeTeam ? "#102a56" : "#1747bd") }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const team = teamOrder[elements[0].index];
        $("od-team-filter").value = $("od-team-filter").value === team ? "all" : team;
        refreshOverdue();
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? "pointer" : "default"; },
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });

  renderOverdueTable();
  $('od-caption').textContent = `${overduePolicies.length} matching overdue ${overduePolicies.length === 1 ? 'policy' : 'policies'} · Earliest renewal first`;
  } catch (error) {
    if (id !== odRequestId || error.name === 'AbortError') return;
    odSetError(error.message || 'Could not load overdue policies. Please try again.');
    $('od-caption').textContent = 'Results could not be updated. Previous results may remain below.';
  } finally {
    if (id === odRequestId) {
      $('overdue-section').setAttribute('aria-busy', 'false');
      odSyncExport();
    }
  }
}

function renderOverdueTable() {
  const start = (overduePage - 1) * OVERDUE_PAGE_SIZE;
  const visible = overduePolicies.slice(start, start + OVERDUE_PAGE_SIZE);

  $("overdue-table-body").innerHTML = visible.map((r) => `
    <tr>
      <td><span class="primary-text">${esc(r.client_name) || "Unnamed client"}</span><small>${esc(r.policy_no)} · ${fmtDays(r.days_until)}</small></td>
      <td>${esc(r.client_email) || "—"}</td>
      <td>${esc(r.phone) || "—"}</td>
      <td><span class="primary-text">${esc(r.rm_name) || "Unassigned"}</span><small>${esc(r.team)}</small></td>
      <td><span class="primary-text">${esc(r.policy_partner)}</span><small>${esc(r.policy) || "—"}</small></td>
      <td>${r.next_premium_date ? plainDate(r.next_premium_date) : "—"}</td>
      <td class="numeric">${compact(r.premium_amount)}</td>
    </tr>`).join("") ||
    `<tr><td colspan="7">No overdue policies match these filters.</td></tr>`;

  const total = overduePolicies.length;
  $("overdue-page-info").textContent = total
    ? `Showing ${Math.min(start + 1, total)}–${Math.min(start + OVERDUE_PAGE_SIZE, total)} of ${total} overdue polic${total === 1 ? "y" : "ies"}`
    : "0 policies";
  $("overdue-prev").disabled = overduePage <= 1;
  $("overdue-next").disabled = start + OVERDUE_PAGE_SIZE >= total;
}

$("overdue-prev").addEventListener("click", () => { overduePage--; renderOverdueTable(); });
$("overdue-next").addEventListener("click", () => { overduePage++; renderOverdueTable(); });

$("od-filters").addEventListener("submit", (e) => e.preventDefault());
for (const id of ["od-month-filter", "od-team-filter", "od-rm-filter", "od-type-filter", "od-status-filter"])
  $(id).addEventListener("change", refreshOverdue);
$("od-search").addEventListener("input", () => {
  clearTimeout(odSearchTimer);
  odMarkPending();
  odSearchTimer = setTimeout(refreshOverdue, 250);
});
$("od-clear-filters").addEventListener("click", () => { $("od-filters").reset(); refreshOverdue(); });

$("od-export").addEventListener("click", async () => {
  if ($("od-export").disabled || !odAppliedParams) return;
  const params = new URLSearchParams(odAppliedParams);
  odExporting = true;
  const button = $("od-export"), label = button.querySelector("span");
  button.disabled = true;
  label.textContent = "Preparing Excel…";
  try {
    const res = await fetch("/api/renewals/export?" + params, { cache: "no-store" });
    if (!res.ok) throw new Error("Excel could not be downloaded. Please try again.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    const match = (res.headers.get("Content-Disposition") || "").match(/filename="?([^";]+)"?/);
    a.download = match ? match[1] : "overdue-policies.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    odSetError(err.message);
  } finally {
    label.textContent = "Download Excel";
    odExporting = false;
    odSyncExport();
  }
});

$('overview-retry').addEventListener('click', refresh);
$('od-retry').addEventListener('click', refreshOverdue);
// Both independent requests must settle before the opening screen clears.
Promise.allSettled([refresh(), refreshOverdue()]).finally(() => window.FincartLoader?.finish());

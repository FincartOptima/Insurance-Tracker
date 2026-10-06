const $ = (id) => document.getElementById(id);

const PALETTE = ["#285f95", "#71a39a", "#c39749", "#ab413c", "#6b5ca5",
                 "#3f8f6b", "#b06a8f", "#8a9eb4", "#c2884a", "#4a7fb5"];

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

const charts = {};
function render(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), config);
}

let overduePolicies = [];
let overdueTeamOrder = [];
let pickedTeam = null;
let overduePage = 1;
const OVERDUE_PAGE_SIZE = 25;

function fmtDays(d) {
  if (d === null || d === undefined) return "";
  return `${Math.abs(d)}d overdue`;
}

function renderOverdueTable() {
  const rows = pickedTeam ? overduePolicies.filter((r) => r.team === pickedTeam) : overduePolicies;
  const start = (overduePage - 1) * OVERDUE_PAGE_SIZE;
  const visible = rows.slice(start, start + OVERDUE_PAGE_SIZE);

  $("overdue-table-body").innerHTML = visible.map((r) => `
    <tr>
      <td><span class="primary-text">${esc(r.client_name) || "Unnamed client"}</span><small>${esc(r.policy_no)} · ${fmtDays(r.days_until)}</small></td>
      <td>${esc(r.client_email) || "—"}</td>
      <td>${esc(r.phone) || "—"}</td>
      <td><span class="primary-text">${esc(r.rm_name) || "Unassigned"}</span><small>${esc(r.team)}</small></td>
      <td><span class="primary-text">${esc(r.policy_partner)}</span><small>${esc(r.policy) || "—"}</small></td>
      <td>${r.last_renewal_date ? plainDate(r.last_renewal_date) : "—"}</td>
      <td class="numeric">${compact(r.premium_amount)}</td>
    </tr>`).join("") ||
    `<tr><td colspan="7">No overdue policies${pickedTeam ? " for " + esc(pickedTeam) : ""}.</td></tr>`;

  $("overdue-page-info").textContent = rows.length
    ? `Showing ${Math.min(start + 1, rows.length)}–${Math.min(start + OVERDUE_PAGE_SIZE, rows.length)} of ${rows.length} overdue polic${rows.length === 1 ? "y" : "ies"}`
    : "0 policies";
  $("overdue-prev").disabled = overduePage <= 1;
  $("overdue-next").disabled = start + OVERDUE_PAGE_SIZE >= rows.length;

  $("clear-team-pick").hidden = !pickedTeam;
  $("picked-team").textContent = pickedTeam || "";
}

function pickTeam(team) {
  pickedTeam = pickedTeam === team ? null : team;
  overduePage = 1;
  renderOverdueTable();
}

$("overdue-prev").addEventListener("click", () => { overduePage--; renderOverdueTable(); });
$("overdue-next").addEventListener("click", () => { overduePage++; renderOverdueTable(); });
$("clear-team-pick").addEventListener("click", () => { pickedTeam = null; overduePage = 1; renderOverdueTable(); });

async function refresh() {
  const res = await fetch("/api/overview", { cache: "no-store" });
  if (!res.ok) return;
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
        { label: "Overdue", data: teams.map((t) => t.overdue), backgroundColor: "#ab413c" },
        { label: "Upcoming (30d)", data: teams.map((t) => t.upcoming), backgroundColor: "#71a39a" },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: false }, y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { position: "bottom" } },
    },
  });

  overduePolicies = data.overdue_policies;
  overdueTeamOrder = teams.filter((t) => t.overdue > 0).map((t) => t.team);
  if (pickedTeam && !overdueTeamOrder.includes(pickedTeam)) pickedTeam = null;
  render("overdue-team-chart", {
    type: "bar",
    data: {
      labels: overdueTeamOrder,
      datasets: [{ label: "Overdue", data: overdueTeamOrder.map((t) => teams.find((x) => x.team === t).overdue),
                   backgroundColor: overdueTeamOrder.map((t) => t === pickedTeam ? "#8a2f2a" : "#ab413c") }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, elements) => { if (elements.length) pickTeam(overdueTeamOrder[elements[0].index]); },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? "pointer" : "default"; },
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
  overduePage = 1;
  renderOverdueTable();

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
}

refresh();

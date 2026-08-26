const $ = (id) => document.getElementById(id);

let currentBucket = "next7";
let searchTimer = null;

function compact(n) {
  n = n || 0;
  if (Math.abs(n) >= 1e7) return "₹" + (n / 1e7).toFixed(2) + " Cr";
  if (Math.abs(n) >= 1e5) return "₹" + (n / 1e5).toFixed(2) + " L";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function fmtDate(iso) {
  if (!iso) return "&mdash;";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDays(d) {
  if (d === null || d === undefined) return "";
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return `in ${d}d`;
}

function daysClass(d) {
  if (d === null || d === undefined) return "";
  if (d < 0) return "days-overdue";
  if (d <= 2) return "days-urgent";
  return "days-soon";
}

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

async function refresh() {
  const params = new URLSearchParams({ bucket: currentBucket, q: $("search").value });
  const res = await fetch("/api/renewals?" + params.toString());
  const d = await res.json();

  $("c-overdue").textContent = d.counts.overdue;
  $("c-tomorrow").textContent = d.counts.tomorrow;
  $("c-next2").textContent = d.counts.next2;
  $("c-next7").textContent = d.counts.next7;
  $("table-title").textContent = d.bucket_label;
  $("asof").textContent = `As of ${d.as_of}` +
    (d.no_date ? ` · ${d.no_date} stored polic${d.no_date === 1 ? "y has" : "ies have"} no renewal date and never appear here` : "");

  const body = d.rows.map((r) => `
    <tr>
      <td class="${daysClass(r.days_until)}">${fmtDays(r.days_until)}<br><small>${fmtDate(r.next_premium_date)}</small></td>
      <td>${esc(r.client_name)}</td>
      <td>${esc(r.client_email)}</td>
      <td>${esc(r.rm_name)}</td>
      <td>${esc(r.policy)}</td>
      <td>${esc(r.policy_partner)}</td>
      <td>${esc(r.insurance_type)}</td>
      <td>${r.sum_assured != null ? compact(r.sum_assured) : "&mdash;"}</td>
      <td>${r.premium_amount != null ? compact(r.premium_amount) : "&mdash;"}</td>
      <td class="mono">${esc(r.policy_no)}</td>
    </tr>`).join("");

  $("table-body").innerHTML = body;
  $("empty-row").style.display = d.rows.length ? "none" : "block";
}

document.querySelectorAll(".bcard").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".bcard").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentBucket = btn.dataset.bucket;
    refresh();
  });
});

$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refresh, 250);
});

refresh();

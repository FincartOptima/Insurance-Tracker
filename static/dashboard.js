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
      <td><span class="pill ${daysClass(r.days_until)}">${fmtDays(r.days_until)}</span><br><small>${fmtDate(r.next_premium_date)}</small></td>
      <td>${esc(r.client_name)}</td>
      <td>${esc(r.client_email)}</td>
      <td>${esc(r.rm_name)}</td>
      <td>${esc(r.policy)}</td>
      <td>${esc(r.policy_partner)}</td>
      <td>${esc(r.insurance_type)}</td>
      <td>${r.sum_assured != null ? compact(r.sum_assured) : "&mdash;"}</td>
      <td>${r.premium_amount != null ? compact(r.premium_amount) : "&mdash;"}</td>
      <td class="mono">${esc(r.policy_no)}</td>
      <td>
        <select class="status-field ${r.status === "Done" ? "done" : ""}" data-policy="${esc(r.policy_no)}">
          <option value="Not Done"${r.status !== "Done" ? " selected" : ""}>Not Done</option>
          <option value="Done"${r.status === "Done" ? " selected" : ""}>Done</option>
        </select>
      </td>
      <td class="reschedule-cell">
        <button type="button" class="reschedule-btn${r.rescheduled ? " set" : ""}" data-policy="${esc(r.policy_no)}">${r.rescheduled ? "Rescheduled" : "Reschedule"}</button>
      </td>
      <td>
        <input type="text" class="remarks-field" data-policy="${esc(r.policy_no)}" value="${esc(r.remarks)}" placeholder="Add a note&hellip;">
      </td>
    </tr>`).join("");

  $("table-body").innerHTML = body;
  $("empty-row").style.display = d.rows.length ? "none" : "block";
}

async function updateField(policyNo, field, value) {
  const res = await fetch(`/api/renewals/${encodeURIComponent(policyNo)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field, value }),
  });
  if (!res.ok) alert("Could not save that change - please try again.");
  return res.ok;
}

function closeAllPopovers() {
  document.querySelectorAll(".reschedule-pop").forEach((p) => p.remove());
}

function openReschedulePopover(btn) {
  const already = btn.closest("td").querySelector(".reschedule-pop");
  closeAllPopovers();
  if (already) return; // clicking the same row's button again just closes it

  const pop = document.createElement("div");
  pop.className = "reschedule-pop";
  pop.dataset.policy = btn.dataset.policy;
  pop.innerHTML = `
    <label>Client said they'll renew on</label>
    <input type="date" class="reschedule-date">
    <div class="pop-actions">
      <button type="button" class="reschedule-cancel">Cancel</button>
      <button type="button" class="reschedule-confirm primary">Confirm</button>
    </div>`;
  btn.closest("td").appendChild(pop);
  pop.querySelector(".reschedule-date").focus();
}

async function confirmReschedule(confirmBtn) {
  const pop = confirmBtn.closest(".reschedule-pop");
  const dateValue = pop.querySelector(".reschedule-date").value;
  if (!dateValue) return; // require an actual pick, not just an empty confirm
  const ok = await updateField(pop.dataset.policy, "next_premium_date", dateValue);
  if (ok) { closeAllPopovers(); refresh(); }
}

$("table-body").addEventListener("change", (e) => {
  const sel = e.target.closest(".status-field");
  if (sel) {
    sel.classList.toggle("done", sel.value === "Done");
    updateField(sel.dataset.policy, "status", sel.value);
  }
});

$("table-body").addEventListener("blur", (e) => {
  const inp = e.target.closest(".remarks-field");
  if (inp) updateField(inp.dataset.policy, "remarks", inp.value);
}, true);

$("table-body").addEventListener("click", (e) => {
  const resBtn = e.target.closest(".reschedule-btn");
  if (resBtn) { openReschedulePopover(resBtn); return; }
  if (e.target.closest(".reschedule-confirm")) { confirmReschedule(e.target); return; }
  if (e.target.closest(".reschedule-cancel")) { closeAllPopovers(); }
});

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

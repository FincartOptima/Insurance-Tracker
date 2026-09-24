const $ = (id) => document.getElementById(id);

let currentBucket = "next7";
let searchTimer = null;
let rowData = new Map(); // policy_no -> row, so contact buttons can build messages

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

function plainDate(iso) {
  if (!iso) return "the due date on file";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

// Digits-only, country-code-prefixed number for a wa.me link - mirrors
// ingest.normalize_whatsapp_number so a bare 10-digit Indian mobile number
// (the common case when someone just types one in) still works.
function normalizeWhatsApp(value) {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 11 && digits[0] === "0") return "91" + digits.slice(1);
  return digits;
}

function renewalEmail(r) {
  const subject = `Reminder: Your ${r.policy || "insurance"} policy is due for renewal`;
  const body =
`Dear ${r.client_name || "Sir/Madam"},

This is a reminder that your ${r.policy || "insurance"} policy with ${r.policy_partner || "your insurer"}` +
` (Policy No. ${r.policy_no}) is due for renewal on ${plainDate(r.next_premium_date)}.

To make sure your coverage continues without a break, please let us know if` +
` you'd like to proceed with the renewal, or if there's anything that's changed` +
` that we should factor in.

Feel free to reach out to ${r.rm_name || "your relationship manager"} or reply` +
` to this email with any questions.

Warm regards,
Team Fincart`;
  return { subject, body };
}

function renewalWhatsApp(r) {
  return `Hi ${r.client_name || ""}, this is ${r.rm_name || "your relationship manager"} from Fincart. ` +
    `Just a reminder that your ${r.policy || "insurance"} policy with ${r.policy_partner || "your insurer"}` +
    ` (Policy No. ${r.policy_no}) is due for renewal on ${plainDate(r.next_premium_date)}.` +
    ` Would you like us to go ahead with the renewal? Let us know if you have any questions!`;
}

function syncFilterOptions(selectId, defaultLabel, options, selectedValue) {
  const select = $(selectId);
  const current = [...select.options].map((o) => o.value).join(",");
  const fresh = ["all", ...options].join(",");
  if (current !== fresh) {
    select.innerHTML = `<option value="all">${defaultLabel}</option>` +
      options.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    select.value = selectedValue;
  }
}

async function refresh() {
  const params = new URLSearchParams({
    bucket: currentBucket,
    q: $("search").value,
    type: $("type-filter").value,
    team: $("team-filter").value,
    rm: $("rm-filter").value,
  });
  const res = await fetch("/api/renewals?" + params.toString());
  const d = await res.json();

  syncFilterOptions("type-filter", "All policy types", d.type_options, d.insurance_type);
  syncFilterOptions("team-filter", "All teams", d.team_options, d.team);
  syncFilterOptions("rm-filter", "All RMs", d.rm_options, d.rm);

  $("c-overdue").textContent = d.counts.overdue;
  $("c-tomorrow").textContent = d.counts.tomorrow;
  $("c-next2").textContent = d.counts.next2;
  $("c-next7").textContent = d.counts.next7;
  $("c-next30").textContent = d.counts.next30;
  $("table-title").textContent = d.bucket_label;
  $("asof").textContent = `As of ${d.as_of}` +
    (d.no_date ? ` · ${d.no_date} stored polic${d.no_date === 1 ? "y has" : "ies have"} no renewal date and never appear here` : "");

  rowData = new Map(d.rows.map((r) => [r.policy_no, r]));

  const body = d.rows.map((r) => `
    <tr>
      <td><span class="pill ${daysClass(r.days_until)}">${fmtDays(r.days_until)}</span><br><small>${fmtDate(r.next_premium_date)}</small></td>
      <td>${esc(r.client_name)}</td>
      <td>${esc(r.client_email)}</td>
      <td>${esc(r.rm_name)}</td>
      <td>${esc(r.team)}</td>
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
      <td class="contact-cell">
        <input type="tel" class="phone-field" data-policy="${esc(r.policy_no)}" value="${esc(r.phone)}" placeholder="Add phone for WhatsApp">
        <div class="contact-btns">
          <button type="button" class="contact-btn email-btn" data-policy="${esc(r.policy_no)}" ${r.client_email ? "" : "disabled title=\"No email on file\""}>Email</button>
          <button type="button" class="contact-btn whatsapp-btn" data-policy="${esc(r.policy_no)}" ${normalizeWhatsApp(r.phone) ? "" : "disabled title=\"Enter a phone number first\""}>WhatsApp</button>
        </div>
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
  const remarks = e.target.closest(".remarks-field");
  if (remarks) { updateField(remarks.dataset.policy, "remarks", remarks.value); return; }

  const phone = e.target.closest(".phone-field");
  if (phone) {
    const waBtn = phone.closest("td").querySelector(".whatsapp-btn");
    const valid = normalizeWhatsApp(phone.value);
    waBtn.disabled = !valid;
    waBtn.title = valid ? "" : "Enter a phone number first";
    updateField(phone.dataset.policy, "phone", phone.value);
  }
}, true);

$("table-body").addEventListener("click", (e) => {
  const resBtn = e.target.closest(".reschedule-btn");
  if (resBtn) { openReschedulePopover(resBtn); return; }
  if (e.target.closest(".reschedule-confirm")) { confirmReschedule(e.target); return; }
  if (e.target.closest(".reschedule-cancel")) { closeAllPopovers(); return; }

  const emailBtn = e.target.closest(".email-btn");
  if (emailBtn) {
    const r = rowData.get(emailBtn.dataset.policy);
    if (!r || !r.client_email) return;
    const { subject, body } = renewalEmail(r);
    window.location.href =
      `mailto:${encodeURIComponent(r.client_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return;
  }

  const waBtn = e.target.closest(".whatsapp-btn");
  if (waBtn) {
    const cell = waBtn.closest("td");
    const phoneInput = cell.querySelector(".phone-field");
    const number = normalizeWhatsApp(phoneInput.value);
    if (!number) { alert("Enter a phone number first."); return; }
    const r = rowData.get(waBtn.dataset.policy);
    if (!r) return;
    updateField(waBtn.dataset.policy, "phone", phoneInput.value); // in case not yet saved
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(renewalWhatsApp(r))}`, "_blank");
  }
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

$("type-filter").addEventListener("change", refresh);
$("team-filter").addEventListener("change", refresh);
$("rm-filter").addEventListener("change", refresh);

refresh();

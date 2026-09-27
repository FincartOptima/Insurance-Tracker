const $ = (id) => document.getElementById(id);
let rows = [],
  page = 1,
  selected = null,
  appliedParams = null;
let requestId = 0,
  controller = null,
  searchTimer = null,
  toastTimer = null;
let saving = false;

function compact(n) {
  n = n || 0;
  if (Math.abs(n) >= 1e7) return "₹" + (n / 1e7).toFixed(2) + " Cr";
  if (Math.abs(n) >= 1e5) return "₹" + (n / 1e5).toFixed(2) + " L";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function fmtDate(iso) {
  if (!iso) return "&mdash;";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
  return (s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function plainDate(iso) {
  if (!iso) return "the due date on file";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
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
  return (
    `Hi ${r.client_name || ""}, this is ${r.rm_name || "your relationship manager"} from Fincart. ` +
    `Just a reminder that your ${r.policy || "insurance"} policy with ${r.policy_partner || "your insurer"}` +
    ` (Policy No. ${r.policy_no}) is due for renewal on ${plainDate(r.next_premium_date)}.` +
    ` Would you like us to go ahead with the renewal? Let us know if you have any questions!`
  );
}

const money = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(n);
function paramsFromControls() {
  const params = new URLSearchParams({
    bucket: $("timeline").value,
    q: $("search").value.trim(),
    type: $("type-filter").value,
    team: $("team-filter").value,
    rm: $("rm-filter").value,
    status: $("status-filter").value,
  });
  if ($("timeline").value === "custom") {
    params.set("start", $("start-date").value);
    params.set("end", $("end-date").value);
  }
  return params;
}
function syncOptions(id, label, options, selectedValue) {
  const select = $(id);
  select.replaceChildren(
    new Option(label, "all"),
    ...options.map((v) => new Option(v, v)),
  );
  select.value = selectedValue;
}
function setError(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function markPending() {
  $("export").disabled = true;
  $("results").setAttribute("aria-busy", "true");
  // Invalidate in-flight responses immediately, including during search debounce.
  requestId++;
  if (controller) controller.abort();
}
function syncTimeline() {
  const bucket = $("timeline").value;
  $("custom-range").hidden = bucket !== "custom";
  $("start-date").required = $("end-date").required = bucket === "custom";
  document.querySelectorAll(".bcard").forEach((b) => {
    b.classList.toggle("active", b.dataset.bucket === bucket);
    b.setAttribute("aria-pressed", String(b.dataset.bucket === bucket));
  });
}
async function refresh() {
  clearTimeout(searchTimer);
  markPending();
  const id = requestId,
    params = paramsFromControls();
  syncTimeline();
  setError("");
  if (
    params.get("bucket") === "custom" &&
    (!params.get("start") ||
      !params.get("end") ||
      params.get("start") > params.get("end"))
  ) {
    if (params.get("start") && params.get("end")) {
      setError("Start date must be on or before end date.");
    }
    $("results").setAttribute("aria-busy", "false");
    $("results-caption").textContent =
      "Choose your dates and select Apply dates. Previous results remain below.";
    return;
  }
  controller = new AbortController();
  $("results-caption").textContent = "Updating policies…";
  try {
    const res = await fetch("/api/renewals?" + params, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error || "Could not load policies. Please try again.",
      );
    }
    const data = await res.json();
    if (id !== requestId) return;
    syncOptions(
      "type-filter",
      "All types",
      data.type_options,
      data.insurance_type,
    );
    syncOptions("team-filter", "All teams", data.team_options, data.team);
    syncOptions("rm-filter", "All managers", data.rm_options, data.rm);
    for (const key of ["overdue", "today", "next7", "next30"])
      $("c-" + key).textContent = data.counts[key].toLocaleString("en-IN");
    $("asof").textContent =
      `${data.total.toLocaleString("en-IN")} stored policies · As of ${plainDate(data.as_of)} · IST`;
    $("table-title").textContent = data.bucket_label;
    $("result-count").textContent = data.rows.length.toLocaleString("en-IN");
    $("premium-total").textContent = money(data.premium_total);
    $("results-caption").textContent =
      data.bucket === "custom"
        ? `${plainDate(data.start)} – ${plainDate(data.end)} · Earliest renewal first`
        : `${data.rows.length} matching ${data.rows.length === 1 ? "policy" : "policies"} · Earliest renewal first`;
    $("date-notice").hidden = !data.no_date || data.bucket === "no_date";
    $("missing-date-copy").textContent =
      `${data.no_date} ${data.no_date === 1 ? "policy has" : "policies have"} no renewal date and won't appear in date-based timelines.`;
    rows = data.rows;
    page = 1;
    appliedParams = new URLSearchParams(params);
    renderRows();
    $("export").disabled = rows.length === 0;
  } catch (err) {
    if (id !== requestId || err.name === "AbortError") return;
    setError(err.message || "Could not load policies. Please try again.");
    $("results-caption").textContent =
      "Results could not be updated. Change a filter or reset filters to retry.";
  } finally {
    if (id === requestId) $("results").setAttribute("aria-busy", "false");
  }
}
function renderRows() {
  const size = Number($("page-size").value),
    start = (page - 1) * size;
  const visible = rows.slice(start, start + size);
  $("table-body").innerHTML = visible
    .map(
      (r, i) => `<tr>
    <td><button class="client-button" data-index="${start + i}" aria-label="View details for ${esc(r.client_name || r.policy_no)}">${esc(r.client_name) || "Unnamed client"}</button><small>${esc(r.policy_no)}</small></td>
    <td><span class="primary-text">${fmtDate(r.next_premium_date)}</span><small><span class="pill ${daysClass(r.days_until)}">${r.days_until == null ? "No date on file" : fmtDays(r.days_until)}</span>${r.rescheduled ? " · Rescheduled" : ""}</small></td>
    <td><span class="primary-text">${esc(r.policy_partner) || "—"}</span><small>${esc(r.policy) || "—"} · ${esc(r.insurance_type)}</small></td>
    <td><span class="primary-text">${esc(r.rm_name) || "Unassigned"}</span><small>${esc(r.team)}</small></td>
    <td class="numeric"><span class="primary-text">${money(r.premium_amount)}</span></td>
    <td><span class="status ${r.status === "Done" ? "done" : ""}">${r.status === "Done" ? "Done" : "Pending"}</span></td>
    <td><button class="view-button" data-index="${start + i}" aria-label="Open policy ${esc(r.policy_no)}">→</button></td>
  </tr>`,
    )
    .join("");
  $("empty-row").hidden = rows.length > 0;
  $("page-info").textContent = rows.length
    ? `Showing ${start + 1}–${Math.min(start + size, rows.length)} of ${rows.length} policies`
    : "0 policies";
  $("prev-page").disabled = page <= 1;
  $("next-page").disabled = start + size >= rows.length;
}
function clearFilters() {
  $("filters").reset();
  $("start-date").value = "";
  $("end-date").value = "";
  refresh();
}
function chooseTimeline(bucket) {
  $("timeline").value = bucket;
  refresh();
}
$("filters").addEventListener("submit", (e) => {
  e.preventDefault();
  refresh();
});
$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  markPending();
  searchTimer = setTimeout(refresh, 250);
});
for (const id of [
  "timeline",
  "team-filter",
  "rm-filter",
  "type-filter",
  "status-filter",
])
  $(id).addEventListener("change", refresh);
for (const id of ["start-date", "end-date"])
  $(id).addEventListener("input", () => {
    markPending();
    $("results").setAttribute("aria-busy", "false");
    $("results-caption").textContent =
      "Date range changed. Select Apply dates to update results.";
  });
$("clear-filters").addEventListener("click", clearFilters);
$("empty-reset").addEventListener("click", clearFilters);
$("show-undated").addEventListener("click", () => chooseTimeline("no_date"));
document
  .querySelectorAll(".bcard")
  .forEach((b) =>
    b.addEventListener("click", () => chooseTimeline(b.dataset.bucket)),
  );
$("page-size").addEventListener("change", () => {
  page = 1;
  renderRows();
});
$("prev-page").addEventListener("click", () => {
  page--;
  renderRows();
});
$("next-page").addEventListener("click", () => {
  page++;
  renderRows();
});

$("export").addEventListener("click", async () => {
  if (!appliedParams || $("export").disabled) return;
  const params = new URLSearchParams(appliedParams),
    id = requestId;
  const button = $("export"),
    label = button.querySelector("span");
  button.disabled = true;
  label.textContent = "Preparing Excel…";
  try {
    const res = await fetch("/api/renewals/export?" + params, {
      cache: "no-store",
    });
    if (!res.ok)
      throw new Error("Excel could not be downloaded. Please try again.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    const match = (res.headers.get("Content-Disposition") || "").match(
      /filename="?([^";]+)"?/,
    );
    a.download = match ? match[1] : "filtered-renewals.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showToast("Excel downloaded with all matching policies.");
  } catch (err) {
    setError(err.message);
  } finally {
    label.textContent = "Download Excel";
    if (id === requestId) button.disabled = rows.length === 0;
  }
});

function detailFields() {
  return {
    status: $("detail-status").value,
    phone: $("detail-phone").value,
    remarks: $("detail-remarks").value,
    next_premium_date: $("detail-date").value,
  };
}
function changedFields() {
  const fields = detailFields();
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) => value !== (selected[key] || ""),
    ),
  );
}
function setContactLink(id, href) {
  const a = $(id);
  a.setAttribute("aria-disabled", String(!href));
  if (href) {
    a.href = href;
    a.removeAttribute("tabindex");
  } else {
    a.removeAttribute("href");
    a.tabIndex = -1;
  }
}
function updateContactLinks() {
  const r = {
    ...selected,
    phone: $("detail-phone").value,
    next_premium_date: $("detail-date").value || selected.next_premium_date,
  };
  const { subject, body } = renewalEmail(r);
  setContactLink(
    "detail-email",
    r.client_email
      ? `mailto:${encodeURIComponent(r.client_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      : null,
  );
  const phone = normalizeWhatsApp(r.phone);
  setContactLink(
    "detail-whatsapp",
    phone && phone.length >= 10 && phone.length <= 15
      ? `https://wa.me/${phone}?text=${encodeURIComponent(renewalWhatsApp(r))}`
      : null,
  );
}
function openDetail(index) {
  selected = rows[index];
  if (!selected) return;
  $("detail-name").textContent = selected.client_name || "Unnamed client";
  $("detail-policy-no").textContent = `Policy ${selected.policy_no}`;
  const facts = [
    ["Email", selected.client_email],
    ["Phone", selected.phone],
    ["Relationship manager", selected.rm_name],
    ["Team", selected.team],
    ["Insurer", selected.policy_partner],
    ["Policy type", selected.insurance_type],
    ["Plan", selected.policy],
    ["Sum insured", money(selected.sum_assured)],
    ["Premium", money(selected.premium_amount)],
    [
      "Renewal date",
      selected.next_premium_date
        ? plainDate(selected.next_premium_date)
        : "Not available",
    ],
  ];
  $("detail-facts").innerHTML =
    '<dl class="detail-facts">' +
    facts
      .map(
        ([label, value]) =>
          `<div${label === "Plan" ? ' class="wide"' : ""}><dt>${label}</dt><dd>${esc(value) || "Not available"}</dd></div>`,
      )
      .join("") +
    "</dl>";
  $("detail-status").value = selected.status;
  $("detail-phone").value = selected.phone;
  $("detail-remarks").value = selected.remarks;
  $("detail-date").value = selected.next_premium_date || "";
  $("detail-date").required = !!selected.next_premium_date;
  $("save-message").textContent = "";
  updateContactLinks();
  $("detail-dialog").showModal();
}
$("table-body").addEventListener("click", (e) => {
  const button = e.target.closest("[data-index]");
  if (button) openDetail(Number(button.dataset.index));
});
function closeDetail() {
  if (saving) return;
  if (
    selected &&
    Object.keys(changedFields()).length &&
    !confirm("Discard your unsaved changes?")
  )
    return;
  $("detail-dialog").close();
}
$("close-detail").addEventListener("click", closeDetail);
$("cancel-detail").addEventListener("click", closeDetail);
$("detail-dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDetail();
});
$("detail-phone").addEventListener("input", updateContactLinks);
$("detail-date").addEventListener("input", updateContactLinks);
$("detail-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (saving) return;
  const fields = changedFields();
  if (!Object.keys(fields).length) {
    $("detail-dialog").close();
    return;
  }
  saving = true;
  $("save-detail").disabled = true;
  $("save-detail").textContent = "Saving…";
  $("save-message").textContent = "";
  // Freeze the form so edits cannot be lost while a save is in flight.
  const controls = [
    ...$("detail-form").querySelectorAll("input,select,textarea"),
  ];
  controls.forEach((c) => (c.disabled = true));
  try {
    const res = await fetch(
      "/api/renewals/" + encodeURIComponent(selected.policy_no),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      },
    );
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(
        error.error || "Could not save changes. Please try again.",
      );
    }
    $("detail-dialog").close();
    showToast("Policy details saved.");
    await refresh();
  } catch (err) {
    $("save-message").textContent = err.message;
    $("save-message").className = "notice error";
  } finally {
    saving = false;
    $("save-detail").disabled = false;
    $("save-detail").textContent = "Save changes";
    controls.forEach((c) => (c.disabled = false));
  }
});
function showToast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
}
refresh();

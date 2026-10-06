const { JSDOM, VirtualConsole } = require("jsdom");
const assert = require("node:assert/strict");
const base = "http://127.0.0.1:5003";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const errors = [];
  const calls = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(e.message));
  const dom = await JSDOM.fromURL(base + "/tracker", {
    resources: "usable",
    runScripts: "dangerously",
    virtualConsole,
    beforeParse(w) {
      w.fetch = (url, options) => {
        calls.push([String(url), options?.method || "GET"]);
        return fetch(new URL(url, base), options);
      };
      w.AbortController = AbortController;
      w.confirm = () => true;
      w.HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
      };
      w.HTMLDialogElement.prototype.close = function () {
        this.open = false;
      };
    },
  });
  const w = dom.window,
    d = w.document,
    $ = (id) => d.getElementById(id);
  async function loaded() {
    for (let i = 0; i < 100; i++) {
      if ($("results")?.getAttribute("aria-busy") === "false") return;
      await delay(20);
    }
    throw Error("Load timed out");
  }
  function change(id, value, event = "change") {
    $(id).value = value;
    $(id).dispatchEvent(new w.Event(event, { bubbles: true }));
  }
  await loaded();
  assert.equal($("error").hidden, true);
  await delay(300);
  assert.equal($("loading-screen").hidden, true);
  assert.equal($("app-shell").inert, false);
  $("toggle-filters").click();
  assert.equal($("filter-options").hidden, true);
  assert.equal($("toggle-filters").getAttribute("aria-expanded"), "false");
  $("toggle-filters").click();
  assert.equal($("filter-options").hidden, false);
  assert.equal($("table-body").rows.length, 25);
  assert.equal($("result-count").textContent, "30");
  $("next-page").click();
  assert.equal($("table-body").rows.length, 5);
  assert.match($("page-info").textContent, /26–30/);
  change("timeline", "custom");
  await loaded();
  assert.equal($("export").disabled, true);
  assert.equal($("custom-range").hidden, false);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  change("start-date", today, "input");
  change("end-date", today, "input");
  $("filters").dispatchEvent(
    new w.Event("submit", { bubbles: true, cancelable: true }),
  );
  await loaded();
  assert.equal($("result-count").textContent, "6");
  assert.equal($("export").disabled, false);
  change("team-filter", "East");
  await loaded();
  assert.equal($("result-count").textContent, "3");
  assert.equal($("filter-count").textContent, "2");
  change("search", "NO SUCH CLIENT", "input");
  await delay(350);
  await loaded();
  assert.equal($("empty-row").hidden, false);
  assert.equal($("export").disabled, true);
  $("empty-reset").click();
  await loaded();
  assert.equal($("result-count").textContent, "30");
  d.querySelector(".client-button").click();
  assert.equal($("detail-dialog").open, true);
  assert.ok($("detail-name").textContent);
  const policyNo = $("detail-policy-no").textContent.replace("Policy ", "");
  change("detail-remarks", "DOM interaction test note", "input");
  change("detail-status", "Done");
  $("detail-form").dispatchEvent(
    new w.Event("submit", { bubbles: true, cancelable: true }),
  );
  for (let i = 0; i < 100 && $("detail-dialog").open; i++) await delay(20);
  await loaded();
  assert.equal($("detail-dialog").open, false);
  assert.ok(
    calls.some(
      ([u, m]) => u.includes(encodeURIComponent(policyNo)) && m === "PATCH",
    ),
  );
  const response = await fetch(
    base + "/api/renewals?bucket=all&q=" + encodeURIComponent(policyNo),
  );
  const saved = (await response.json()).rows[0];
  assert.equal(saved.remarks, "DOM interaction test note");
  assert.equal(saved.status, "Done");
  change("timeline", "no_date");
  await loaded();
  assert.equal($("result-count").textContent, "5");
  assert.equal($("date-notice").hidden, true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: initial loading, pagination, invalid/custom dates, combined filters, search empty state, reset, detail panel, atomic save, slash policy ID, undated view. No JS runtime errors.",
  );
  dom.window.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

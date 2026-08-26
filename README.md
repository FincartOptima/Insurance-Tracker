# Health Ops Renewal Tracker

Flask app that tracks upcoming policy renewals from the monthly Insurance export.
Upload the file, see how many renewals are overdue, due tomorrow, in the next
2 days, or in the next 7 days, with full client details for each.

Run locally:

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in a Postgres connection string
python app.py
```

Then open <http://127.0.0.1:5003>. See [DEPLOY.md](DEPLOY.md) for Render + Neon.

## How it works

`ingest.py` reads the export, keeps only rows where `recordStatus = "Confirmed"`,
and stores them in Postgres keyed on `PolicyNo`. Uploads accumulate: re-uploading
the same or a later export updates existing policies (their renewal date may have
moved) instead of duplicating them.

**Renewal date** comes from `NextPremimum_Date` — when the next premium is due.

### Buckets

Computed live from today's date on every page load, not fixed at upload time:

| Bucket | Window |
| --- | --- |
| Overdue | Renewal date already passed |
| Next Day | Today or tomorrow |
| Next 2 Days | Today through 2 days out |
| Next 7 Days | Today through 7 days out |

The windows are nested on purpose (Next Day is a subset of Next 7 Days) so
"what's due this week" naturally includes "what's due tomorrow" — the way you'd
actually ask the question. A renewal due **today** counts in all three forward
buckets, not just its own — otherwise same-day renewals would only be visible in
"All upcoming" and could be missed on the one day they matter most.

Clicking a bucket card filters the table below it to exactly that window, with a
client-name search on top.

### Client details shown

Client name, email, RM, policy, policy partner, insurance type, sum insured,
premium, renewal date, and policy number.

## Files

| File | Purpose |
| --- | --- |
| `app.py` | routes and upload handling |
| `ingest.py` | parsing, Confirmed filter, upsert |
| `queries.py` | bucket math and the client-detail table |
| `db.py` | Postgres schema and connection |

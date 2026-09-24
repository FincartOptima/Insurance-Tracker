# SOP — Health Ops Renewal Tracker

This document explains everything about the Renewal Tracker in plain language:
how to use it day to day, how to rebuild it from scratch if something breaks,
and what it can't do. No coding background needed to follow this.

**Live webpage:** https://health-ops-renewal-tracker-4zop.onrender.com


## 1. What this tool does

Every month, an Insurance export file is uploaded. The tool reads it and shows
which client policies are coming up for renewal — due today, tomorrow, this
week, or already overdue — so nothing gets missed.

It remembers everything you've ever uploaded. Uploading a new file adds to
that history; it never deletes what's already there.


## 2. Using it day to day

### 2.1 Uploading a new file

1. Open the webpage and go to the **Upload** tab (it's the home page).
2. Click **Choose File**, pick the `Insurance_YYYY_MM_DD` export.
3. Click **Upload & process**.
4. You'll see a summary: how many policies were new, how many were updated,
   how many were skipped, and how many had no renewal date.

Things worth knowing about what happens during upload:

- **Only "Confirmed" policies are kept.** Anything marked Punched or Rejected
  in the source file is silently skipped (it's counted in the "skipped"
  number, not thrown away — it's just never shown here).
- **Uploading the same month twice is safe.** Each policy is matched by its
  Policy Number. If it already exists, its details are refreshed; it's never
  duplicated.
- **Your own notes are protected.** If you've set a Status, written a
  Remark, or Rescheduled a policy (see below), re-uploading a file will
  never overwrite those — they're yours until you change them again.
- If the same Policy Number appears **twice in one file with two different
  premium amounts**, that's flagged in the upload summary as a conflict —
  it usually means two different policies accidentally share a number, or
  one row is a correction of the other. Worth a manual look.

### 2.2 The Dashboard

Click **Dashboard** at the top. You'll see five cards:

| Card | What it means |
| --- | --- |
| **Overdue** | The renewal date has already passed |
| **Next Day** | Due today or tomorrow |
| **Next 2 Days** | Due today, tomorrow, or the day after |
| **Next 7 Days** | Due anytime in the coming week |
| **All Upcoming** | Everything with a renewal date, past or future |

Click any card to filter the table below it to just those policies. The
counts update live, based on today's date — the same data will show
different numbers on different days automatically. You don't need to do
anything for that to happen.

### 2.3 The table

Each row is one policy, with these columns:

- **Renews** — how many days until renewal, and the actual date underneath
- **Client, Email, RM, Policy, Partner, Type** — details pulled from the
  uploaded file
- **Sum Insured, Premium** — shown in lakhs/crores for readability
- **Policy No** — the unique identifier used to match uploads
- **Status, Reschedule, Remarks** — see below, these are yours to edit

Use the **search box** above the table to filter by client name.

### 2.4 Status, Reschedule, and Remarks

These three columns are for your own tracking — the source file never has
this information, it lives only in this tool.

- **Status** — a dropdown: *Not Done* or *Done*. Every policy starts as
  *Not Done*. Change it any time; it saves immediately.
- **Reschedule** — use this when a client tells you they'll actually renew
  on a different date than what's on file.
  1. Click the **Reschedule** button on that row.
  2. A small calendar box appears. Pick the new date.
  3. Click **Confirm**.
  - Nothing is saved until you click Confirm — picking a date and clicking
    away, or clicking Cancel, does nothing. This is deliberate, so an
    accidental click can't change a client's renewal date.
  - Once confirmed, that policy moves to whichever bucket matches its new
    date, and the button changes to say **Rescheduled**.
  - **Once a policy is rescheduled, future uploads will never change its
    date again automatically.** If you need to undo a reschedule and go
    back to letting uploads control the date, there's currently no button
    for that — see Section 6 (Limitations).
- **Remarks** — a free text box. Type anything, click away from the box,
  and it saves. Leave it blank if you don't need it.

### 2.5 Clearing all data

The **Clear all stored data** button on the Upload page deletes every
policy ever uploaded — permanently. There's a confirmation prompt before it
runs. Only use this if you genuinely want to start over from nothing.


## 3. How the pieces fit together

You don't need to understand this to use the tool, but it helps if
something ever needs fixing.

```
GitHub  →  Render (runs the webpage)  →  Neon (stores the data)
```

- **GitHub** holds the code. Repo: `FincartOptima/Insurance-Tracker`.
- **Render** runs the actual webpage, for free. Every time new code is
  pushed to GitHub, Render automatically rebuilds and redeploys — usually
  within 2-3 minutes.
- **Neon** is a separate, free database that stores every policy you've
  ever uploaded, plus your Status/Reschedule/Remarks. It is completely
  independent of Render — redeploying the webpage, or even deleting and
  recreating the Render service, never touches the data sitting in Neon.

This separation is intentional: Render's free tier wipes its own local
files on every restart, so nothing important is ever stored there directly.


## 4. Setting up the database again from scratch

You'd only need this if you're moving to a new Neon account, lost access to
the old one, or are setting the whole thing up fresh on a new computer.

**Recommended: use Neon's website (no command line needed)**

1. Go to [neon.tech](https://neon.tech) and sign in (or sign up — it's free).
2. Click **New Project**. Give it any name, pick any region.
3. On the project page, find the **Connection String** — it looks like:
   ```
   postgresql://username:password@some-host.neon.tech/dbname?sslmode=require
   ```
   Copy it.
4. Go to your Render dashboard → your service → **Environment** tab.
5. Set `DATABASE_URL` to the connection string you just copied. Save.
6. Render will restart the service automatically. Open the webpage — the
   very first time it loads, it automatically creates all the tables it
   needs. You don't have to set up anything inside the database yourself.
7. The database starts **empty**. Upload your files again to rebuild the
   history, or see the note below about moving data from an old database.

**Moving data from an old Neon database to a new one:** this app doesn't
do that automatically. If you need everything carried over rather than
re-uploaded, that requires a manual database export/import (a `pg_dump`
and `pg_restore`, in database terms) — ask for help with this specifically
if it comes up, since it's a separate, more careful process.

**Alternative: Neon's command-line tool.** If you're comfortable with a
terminal, `npx neon@latest auth` followed by `npx neon@latest projects
create` does the same thing. In practice the browser sign-in step for this
timed out for us more than once, so the website method above is the more
reliable path unless you're already set up with the CLI.


## 5. Updating the code

Only needed if the tool itself needs a fix or a new feature — not for
regular monthly use.

1. Make the code change.
2. From inside the `Health Ops Renewal Tracker` folder:
   ```bash
   git add -A
   git commit -m "describe what changed"
   git push origin main
   ```
3. Render picks up the push automatically and redeploys. Check the
   **Events** tab on Render to confirm it finished without errors.

Pushing code never affects the data in Neon — those two systems are
completely separate, as explained in Section 3.


## 6. Limitations — things to know

- **No login.** Anyone with the webpage link can view and edit every
  policy — there's no password or user accounts. Don't share the link
  outside the people who should have access.
- **Free-tier sleep.** Both Render and Neon pause themselves after a few
  minutes of no activity, to stay free. The first person to open the page
  after a quiet spell will wait 10-30 seconds while everything wakes up.
  After that it's instant again.
- **Storage cap.** Neon's free tier holds 0.5 GB. At current usage (~375
  policies ≈ 7.6 MB), that's room for roughly 25,000 policies — at normal
  upload volume, several years before it's a concern.
- **Only "Confirmed" rows are tracked.** Punched or Rejected policies never
  appear here at all, by design.
- **Missing renewal dates are invisible everywhere.** If a policy has no
  date in the source file's `NextPremimum_Date` column, it can never show
  up in any bucket. The dashboard tells you how many are affected, but it
  can't guess a date that isn't there.
- **Rescheduling is one-way.** Once you reschedule a policy, uploads will
  never again update its date automatically — see Section 2.4. There's no
  "undo" button for this yet.
- **Search only matches client name** — not policy number, RM, or partner.
- **No notifications.** This is a dashboard you check, not something that
  emails or texts anyone about upcoming renewals.
- **No history of who changed what.** Status and Remarks don't record who
  made the change or when — only the current value is kept.


## 7. If something goes wrong

- **Upload says the file isn't a valid Insurance export** — you've likely
  picked the wrong file, or a genuinely old-format `.xls` that this tool
  can't read. Re-save it as `.xlsx` from Excel and try again.
- **Page won't load / shows an error** — check Render's **Logs** tab for
  the service. If it mentions `DATABASE_URL`, the Neon connection string is
  missing or wrong in Render's Environment settings (Section 4).
- **A deploy fails right after pushing code** — check Render's **Events**
  tab for the failed build's log. Share the error if you need help reading
  it.
- **Data looks wrong or missing** — confirm you're looking at the right
  bucket card (Overdue vs Next 7 Days show very different things), and
  check the "as of" date shown under the cards matches today.

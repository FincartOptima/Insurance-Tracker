"""Renewal bucket counts and the client-detail table, computed live against today."""
import datetime as dt

from ingest import UNASSIGNED_TEAM, _to_date

STATUS_VALUES = ("Not Done", "Done")

BUCKET_LABELS = {
    "overdue": "Overdue",
    "tomorrow": "Next Day",
    "next2": "Next 2 Days",
    "next7": "Next 7 Days",
    "next30": "Next 30 Days",
    "all": "All upcoming",
}


def _in_bucket(days, bucket):
    """Windows include today (day 0): a renewal due today must show up
    somewhere actionable, not only fall into the 'All upcoming' catch-all.
    Windows nest (Next Day subset of Next 2 Days subset of Next 7 Days subset
    of Next 30 Days), which matches how "what's due this month" is meant to
    read - it includes what's due tomorrow. Next 30 Days exists because
    actually reaching a client before they renew needs more runway than a
    week - a week's notice is often too late to matter.
    """
    if days is None:
        return False
    if bucket == "overdue":
        return days < 0
    if bucket == "tomorrow":
        return 0 <= days <= 1
    if bucket == "next2":
        return 0 <= days <= 2
    if bucket == "next7":
        return 0 <= days <= 7
    if bucket == "next30":
        return 0 <= days <= 30
    return True  # "all": anything with a date, overdue or future


def _row_out(r, days):
    """Convert a DB row (Decimal/date types) into JSON-safe values."""
    return {
        "policy_no": r["policy_no"],
        "client_name": r["client_name"] or "",
        "client_email": r["client_email"] or "",
        "rm_name": r["rm_name"] or "",
        "policy": r["policy"] or "",
        "policy_partner": r["policy_partner"] or "",
        "insurance_type": r["insurance_type"] or "",
        "sum_assured": float(r["sum_assured"]) if r["sum_assured"] is not None else None,
        "premium_amount": float(r["premium_amount"]) if r["premium_amount"] is not None else None,
        "next_premium_date": r["next_premium_date"].isoformat() if r["next_premium_date"] else None,
        "days_until": days,
        "status": r["status"] or "Not Done",
        "remarks": r["remarks"] or "",
        "rescheduled": r["rescheduled_at"] is not None,
        "phone": r["phone"] or "",
        "team": r["team"] or UNASSIGNED_TEAM,
    }


def build(conn, bucket, search, insurance_type="all", team="all", rm="all"):
    if bucket not in BUCKET_LABELS:
        bucket = "next7"

    with conn.cursor() as cur:
        cur.execute("SELECT * FROM renewals")
        rows = cur.fetchall()

    # Every value present across ALL data, regardless of the current filters,
    # so a dropdown's option list never shrinks just because a filter is active.
    type_options = sorted({r["insurance_type"] for r in rows if r["insurance_type"]})
    team_options = sorted({r["team"] or UNASSIGNED_TEAM for r in rows})
    rm_options = sorted({r["rm_name"] for r in rows if r["rm_name"]})

    if insurance_type and insurance_type != "all":
        rows = [r for r in rows if r["insurance_type"] == insurance_type]
    if team and team != "all":
        rows = [r for r in rows if (r["team"] or UNASSIGNED_TEAM) == team]
    if rm and rm != "all":
        rows = [r for r in rows if r["rm_name"] == rm]

    today = dt.date.today()
    enriched = []
    for r in rows:
        d = r["next_premium_date"]
        days = (d - today).days if d else None
        enriched.append((r, days))

    # Computed through the same _in_bucket used for the table, so the card
    # counts can never drift out of sync with what selecting that card shows.
    # Reflects the type filter (if any), same as the table does.
    counts = {
        b: sum(1 for _, days in enriched if _in_bucket(days, b))
        for b in ("overdue", "tomorrow", "next2", "next7", "next30")
    }
    no_date = sum(1 for _, days in enriched if days is None)

    table = [_row_out(r, days) for r, days in enriched if _in_bucket(days, bucket)]
    if search:
        s = search.strip().casefold()
        table = [row for row in table if s in row["client_name"].casefold()]
    table.sort(key=lambda row: (row["days_until"] is None, row["days_until"]))

    return {
        "counts": counts,
        "no_date": no_date,
        "total": len(rows),
        "bucket": bucket,
        "bucket_label": BUCKET_LABELS[bucket],
        "rows": table,
        "as_of": today.isoformat(),
        "type_options": type_options,
        "insurance_type": insurance_type or "all",
        "team_options": team_options,
        "team": team or "all",
        "rm_options": rm_options,
        "rm": rm or "all",
    }


def update_field(conn, policy_no, field, value):
    """Apply one ops-tracking edit (status / remarks / a manual reschedule).

    Each branch owns a literal SQL string - field is never interpolated into
    the query, so an unexpected field name can only ever raise, never reach SQL.
    """
    if field == "status":
        if value not in STATUS_VALUES:
            raise ValueError("Status must be 'Not Done' or 'Done'")
        sql = "UPDATE renewals SET status = %s WHERE policy_no = %s"
    elif field == "remarks":
        value = "" if value is None else str(value)[:2000]
        sql = "UPDATE renewals SET remarks = %s WHERE policy_no = %s"
    elif field == "phone":
        value = "" if value is None else str(value).strip()[:40]
        sql = "UPDATE renewals SET phone = %s WHERE policy_no = %s"
    elif field == "next_premium_date":
        parsed = _to_date(value)
        if parsed is None:
            raise ValueError("Invalid date")
        value = parsed
        sql = ("UPDATE renewals SET next_premium_date = %s, rescheduled_at = now() "
               "WHERE policy_no = %s")
    else:
        raise ValueError(f"Cannot update field '{field}'")

    with conn.cursor() as cur:
        cur.execute(sql, (value, policy_no))
        if cur.rowcount == 0:
            raise ValueError(f"No policy found with number '{policy_no}'")
    conn.commit()

    return {
        "policy_no": policy_no,
        "field": field,
        "value": value.isoformat() if hasattr(value, "isoformat") else value,
    }

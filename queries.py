"""Renewal bucket counts and the client-detail table, computed live against today."""
import datetime as dt

BUCKET_LABELS = {
    "overdue": "Overdue",
    "tomorrow": "Next Day",
    "next2": "Next 2 Days",
    "next7": "Next 7 Days",
    "all": "All upcoming",
}


def _in_bucket(days, bucket):
    """Windows include today (day 0): a renewal due today must show up
    somewhere actionable, not only fall into the 'All upcoming' catch-all.
    Windows nest (Next Day subset of Next 2 Days subset of Next 7 Days), which
    matches how "what's due this week" is meant to read - it includes tomorrow.
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
    }


def build(conn, bucket, search):
    if bucket not in BUCKET_LABELS:
        bucket = "next7"

    with conn.cursor() as cur:
        cur.execute("SELECT * FROM renewals")
        rows = cur.fetchall()

    today = dt.date.today()
    enriched = []
    for r in rows:
        d = r["next_premium_date"]
        days = (d - today).days if d else None
        enriched.append((r, days))

    # Computed through the same _in_bucket used for the table, so the card
    # counts can never drift out of sync with what selecting that card shows.
    counts = {
        b: sum(1 for _, days in enriched if _in_bucket(days, b))
        for b in ("overdue", "tomorrow", "next2", "next7")
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
    }

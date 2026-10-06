"""Renewal bucket counts and the client-detail table, computed live against today."""
import datetime as dt
from collections import Counter, defaultdict
from zoneinfo import ZoneInfo

from ingest import UNASSIGNED_TEAM, _to_date

STATUS_VALUES = ("Not Done", "Done")

BUCKET_LABELS = {
    "overdue": "Overdue", "today": "Due today", "tomorrow": "Today & tomorrow",
    "next2": "Next 2 days", "next7": "Next 7 days", "next14": "Next 14 days",
    "next30": "Next 30 days", "next60": "Next 60 days", "next90": "Next 90 days",
    "upcoming": "All upcoming", "all": "All policies", "no_date": "Missing renewal date",
    "custom": "Custom date range",
}


def _in_bucket(days, bucket, superseded=False):
    """Forward windows include today through the named day, inclusive.

    A superseded policy (its number shows up as someone else's Previous
    Policy Number - i.e. it's already been renewed under a new number) never
    counts as due for anything: it would otherwise double up with its own
    successor record. It still shows under 'all' for audit/history purposes.
    """
    if bucket == "all":
        return True
    if superseded:
        return False
    if bucket == "no_date":
        return days is None
    if days is None:
        return False
    if bucket == "overdue":
        return days < 0
    if bucket == "today":
        return days == 0
    if bucket == "tomorrow":
        return 0 <= days <= 1
    if bucket.startswith("next"):
        return 0 <= days <= int(bucket[4:])
    return days >= 0


def business_today():
    return dt.datetime.now(ZoneInfo("Asia/Kolkata")).date()


def _date_range(start, end):
    try:
        start, end = dt.date.fromisoformat(start or ""), dt.date.fromisoformat(end or "")
    except (ValueError, TypeError):
        raise ValueError("Choose a valid start and end date.") from None
    if start > end:
        raise ValueError("Start date must be on or before end date.")
    return start, end


def _row_out(r, days, superseded=False):
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
        "business_type": r["business_type"] or "",
        "superseded": superseded,
    }


def _month_key(d):
    return d.strftime("%Y-%m") if d else None


def _fetch_all(conn):
    """One fetch, shared by every view: every row plus which ones are
    superseded (policy_no shows up as someone else's Previous Policy Number).
    """
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM renewals")
        rows = cur.fetchall()
    superseded_nos = {r["previous_policy_no"] for r in rows if r["previous_policy_no"]}
    return rows, superseded_nos


def build(conn, bucket="next7", search="", insurance_type="all", team="all", rm="all",
          status="all", month="all", start=None, end=None, today=None):
    if bucket not in BUCKET_LABELS:
        raise ValueError("Choose a valid renewal timeline.")
    if status not in ("all", *STATUS_VALUES):
        raise ValueError("Choose a valid follow-up status.")
    date_range = _date_range(start, end) if bucket == "custom" else None
    rows, superseded_nos = _fetch_all(conn)
    type_options = sorted({r["insurance_type"] for r in rows if r["insurance_type"]})
    team_options = sorted({r["team"] or UNASSIGNED_TEAM for r in rows})
    rm_options = sorted({r["rm_name"] for r in rows if r["rm_name"]})
    month_options = sorted({_month_key(r["next_premium_date"]) for r in rows if r["next_premium_date"]})
    today = today or business_today()
    filtered = []
    search = search.strip().casefold()
    for r in rows:
        if insurance_type != "all" and r["insurance_type"] != insurance_type:
            continue
        if team != "all" and (r["team"] or UNASSIGNED_TEAM) != team:
            continue
        if rm != "all" and r["rm_name"] != rm:
            continue
        if status != "all" and (r["status"] or "Not Done") != status:
            continue
        if month != "all" and _month_key(r["next_premium_date"]) != month:
            continue
        if search and not any(search in str(r.get(k) or "").casefold() for k in
                              ("client_name", "client_email", "phone", "policy_no")):
            continue
        date = r["next_premium_date"]
        is_superseded = r["policy_no"] in superseded_nos
        filtered.append(_row_out(r, (date - today).days if date else None, is_superseded))
    counts = {b: sum(_in_bucket(r["days_until"], b, r["superseded"]) for r in filtered)
              for b in ("overdue", "today", "tomorrow", "next2", "next7", "next30")}
    if date_range:
        table = [r for r in filtered if not r["superseded"] and r["next_premium_date"] and
                 date_range[0].isoformat() <= r["next_premium_date"] <= date_range[1].isoformat()]
    else:
        table = [r for r in filtered if _in_bucket(r["days_until"], bucket, r["superseded"])]
    table.sort(key=lambda r: (r["days_until"] is None, r["days_until"] or 0,
                              r["client_name"].casefold(), r["policy_no"]))
    return {
        "counts": counts, "no_date": sum(r["days_until"] is None for r in filtered),
        "total": len(rows), "matching_total": len(filtered), "bucket": bucket,
        "bucket_label": BUCKET_LABELS[bucket], "rows": table, "as_of": today.isoformat(),
        "type_options": type_options, "insurance_type": insurance_type,
        "team_options": team_options, "team": team, "rm_options": rm_options, "rm": rm,
        "status": status, "search": search, "start": start if date_range else None,
        "end": end if date_range else None,
        "month_options": month_options, "month": month,
        "premium_total": sum(r["premium_amount"] or 0 for r in table),
    }


def overview(conn, today=None):
    """Portfolio-level summary for the Overview tab: overdue/upcoming counts
    (overall and team-wise), New/Port/Renewal split, and insurer mix.

    Superseded policies (already renewed under a newer policy number) are
    excluded everywhere here, same as in build() - otherwise a renewed
    client's business would be counted twice, once under each number.
    Cancelled-type rows never reach the table at all (dropped at ingest).
    """
    rows, superseded_nos = _fetch_all(conn)
    today = today or business_today()

    active = []
    for r in rows:
        if r["policy_no"] in superseded_nos:
            continue
        date = r["next_premium_date"]
        days = (date - today).days if date else None
        active.append({
            "policy_no": r["policy_no"],
            "client_name": r["client_name"] or "",
            "client_email": r["client_email"] or "",
            "phone": r["phone"] or "",
            "rm_name": r["rm_name"] or "",
            "team": r["team"] or UNASSIGNED_TEAM,
            "policy": r["policy"] or "",
            "days_until": days,
            "last_renewal_date": date.isoformat() if date else None,
            "business_type": r["business_type"] or "Unspecified",
            "policy_partner": r["policy_partner"] or "Unspecified",
            "premium_amount": float(r["premium_amount"]) if r["premium_amount"] is not None else 0.0,
        })

    overdue = [r for r in active if r["days_until"] is not None and r["days_until"] < 0]
    upcoming = [r for r in active if r["days_until"] is not None and 0 <= r["days_until"] <= 30]
    overdue_policies = sorted(overdue, key=lambda r: r["days_until"])

    overdue_by_team = Counter(r["team"] for r in overdue)
    upcoming_by_team = Counter(r["team"] for r in upcoming)
    all_teams = set(overdue_by_team) | set(upcoming_by_team) | {r["team"] for r in active}
    team_breakdown = sorted(
        ({"team": t, "overdue": overdue_by_team.get(t, 0), "upcoming": upcoming_by_team.get(t, 0)}
         for t in all_teams),
        key=lambda x: (-x["overdue"], -x["upcoming"], x["team"]),
    )

    business_type_counts = Counter(r["business_type"] for r in active)
    business_type_breakdown = [
        {"label": label, "count": count} for label, count in business_type_counts.most_common()
    ]

    insurer_counts = Counter(r["policy_partner"] for r in active)
    insurer_premium = defaultdict(float)
    for r in active:
        insurer_premium[r["policy_partner"]] += r["premium_amount"]
    insurer_breakdown = [
        {"label": label, "count": count, "premium": insurer_premium[label]}
        for label, count in insurer_counts.most_common()
    ]

    return {
        "as_of": today.isoformat(),
        "total_active": len(active),
        "total_overdue": len(overdue),
        "total_upcoming": len(upcoming),
        "team_breakdown": team_breakdown,
        "business_type": business_type_breakdown,
        "insurer": insurer_breakdown,
        "overdue_policies": overdue_policies,
    }


def _validated_update(field, value):
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

    return sql, value


def update_fields(conn, policy_no, fields):
    """Validate the entire edit first, then save it in one transaction."""
    if not isinstance(fields, dict) or not fields:
        raise ValueError("No changes supplied.")
    updates = [(field, *_validated_update(field, value)) for field, value in fields.items()]
    try:
        with conn.cursor() as cur:
            for field, sql, value in updates:
                cur.execute(sql, (value, policy_no))
                if cur.rowcount == 0:
                    raise ValueError("Policy not found.")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"policy_no": policy_no, "fields": {
        field: value.isoformat() if hasattr(value, "isoformat") else value
        for field, _, value in updates
    }}


def update_field(conn, policy_no, field, value):
    result = update_fields(conn, policy_no, {field: value})
    return {"policy_no": policy_no, "field": field, "value": result["fields"][field]}

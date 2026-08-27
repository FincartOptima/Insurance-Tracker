import os

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL", "")

SCHEMA = """
CREATE TABLE IF NOT EXISTS renewals (
    policy_no         TEXT PRIMARY KEY,
    client_name       TEXT,
    client_email      TEXT,
    rm_name           TEXT,
    policy            TEXT,
    policy_partner    TEXT,
    insurance_type    TEXT,
    sum_assured       NUMERIC,
    premium_amount    NUMERIC,
    next_premium_date DATE,
    source_file       TEXT,
    uploaded_at       TIMESTAMP,
    status            TEXT NOT NULL DEFAULT 'Not Done',
    remarks           TEXT NOT NULL DEFAULT '',
    rescheduled_at    TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_next_premium ON renewals(next_premium_date);

-- Adds these columns (with the same defaults) to a database created before
-- this feature existed; a no-op on a fresh install where they're already there.
ALTER TABLE renewals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Not Done';
ALTER TABLE renewals ADD COLUMN IF NOT EXISTS remarks TEXT NOT NULL DEFAULT '';
ALTER TABLE renewals ADD COLUMN IF NOT EXISTS rescheduled_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def connect():
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is not set. Create a free Postgres database "
            "(e.g. at neon.tech or supabase.com) and set the DATABASE_URL "
            "environment variable to its connection string."
        )
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def init_db():
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def set_meta(conn, key, value):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO meta(key, value) VALUES(%s, %s) "
            "ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
            (key, str(value)),
        )


def get_meta(conn, key, default=None):
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM meta WHERE key=%s", (key,))
        row = cur.fetchone()
    return row["value"] if row else default


def count_renewals(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM renewals")
        return cur.fetchone()["c"]

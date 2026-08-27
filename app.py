import os
import tempfile

from dotenv import load_dotenv

load_dotenv()

from flask import Flask, flash, jsonify, redirect, render_template, request, url_for  # noqa: E402

import db  # noqa: E402
import ingest  # noqa: E402
import queries  # noqa: E402

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "health-ops-renewal-tracker")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

ALLOWED = {".xls", ".xlsx"}


@app.route("/", methods=["GET"])
def home():
    db.init_db()
    conn = db.connect()
    try:
        total = db.count_renewals(conn)
        last = db.get_meta(conn, "last_upload")
    finally:
        conn.close()
    return render_template("upload.html", total=total, last_upload=last, result=None)


@app.route("/upload", methods=["POST"])
def upload():
    db.init_db()
    file = request.files.get("insurance")
    if not file or not file.filename:
        flash("Choose a file to upload.", "error")
        return redirect(url_for("home"))

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED:
        flash(f"'{file.filename}' is not an Excel file. Upload .xls or .xlsx.", "error")
        return redirect(url_for("home"))

    fd, tmp_path = tempfile.mkstemp(suffix=ext)
    os.close(fd)
    file.save(tmp_path)
    try:
        result = ingest.ingest_file(tmp_path, file.filename)
    except ingest.IngestError as exc:
        flash(str(exc), "error")
        return redirect(url_for("home"))
    finally:
        os.remove(tmp_path)

    conn = db.connect()
    try:
        total = db.count_renewals(conn)
        last = db.get_meta(conn, "last_upload")
    finally:
        conn.close()
    return render_template("upload.html", total=total, last_upload=last, result=result)


@app.route("/dashboard")
def dashboard():
    db.init_db()
    conn = db.connect()
    try:
        total = db.count_renewals(conn)
    finally:
        conn.close()
    return render_template("dashboard.html", total=total)


@app.route("/api/renewals")
def api_renewals():
    conn = db.connect()
    try:
        data = queries.build(
            conn,
            bucket=request.args.get("bucket", "next7"),
            search=request.args.get("q", ""),
        )
    finally:
        conn.close()
    return jsonify(data)


@app.route("/api/renewals/<policy_no>", methods=["PATCH"])
def update_renewal(policy_no):
    data = request.get_json(silent=True) or {}
    conn = db.connect()
    try:
        result = queries.update_field(conn, policy_no, data.get("field"), data.get("value"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    finally:
        conn.close()
    return jsonify(result)


@app.route("/reset", methods=["POST"])
def reset():
    db.init_db()
    conn = db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM renewals")
        conn.commit()
    finally:
        conn.close()
    flash("All stored renewal data cleared.", "ok")
    return redirect(url_for("home"))


if __name__ == "__main__":
    db.init_db()
    app.run(debug=True, port=5003)

import os
import tempfile

from dotenv import load_dotenv

load_dotenv()

from flask import Flask, flash, jsonify, redirect, render_template, request, url_for, send_file  # noqa: E402

import db  # noqa: E402
import ingest  # noqa: E402
import queries  # noqa: E402
import exports  # noqa: E402

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "health-ops-renewal-tracker")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

ALLOWED = {".xls", ".xlsx"}


@app.route("/", methods=["GET"])
def overview():
    db.init_db()
    conn = db.connect()
    try:
        total = db.count_renewals(conn)
    finally:
        conn.close()
    return render_template("overview.html", total=total)


@app.route("/tracker", methods=["GET"])
def tracker():
    db.init_db()
    conn = db.connect()
    try:
        total = db.count_renewals(conn)
    finally:
        conn.close()
    return render_template("dashboard.html", total=total)


def _render_upload_page(result=None, employee_result=None, leads_result=None):
    conn = db.connect()
    try:
        total = db.count_renewals(conn)
        last = db.get_meta(conn, "last_upload")
        last_employee = db.get_meta(conn, "last_employee_upload")
    finally:
        conn.close()
    return render_template(
        "upload.html", total=total, last_upload=last, last_employee=last_employee,
        result=result, employee_result=employee_result, leads_result=leads_result,
    )


def _save_and_run(file_storage, run):
    ext = os.path.splitext(file_storage.filename)[1].lower()
    if ext not in ALLOWED:
        raise ingest.IngestError(f"'{file_storage.filename}' is not an Excel file. Upload .xls or .xlsx.")
    fd, tmp_path = tempfile.mkstemp(suffix=ext)
    os.close(fd)
    file_storage.save(tmp_path)
    try:
        return run(tmp_path, file_storage.filename)
    finally:
        os.remove(tmp_path)


@app.route("/upload", methods=["GET", "POST"])
def upload():
    db.init_db()

    if request.method == "GET":
        return _render_upload_page()

    insurance_file = request.files.get("insurance")
    employee_file = request.files.get("employee_ref")
    leads_file = request.files.get("leads")
    if not any(f and f.filename for f in (insurance_file, employee_file, leads_file)):
        flash("Choose at least one file to upload.", "error")
        return redirect(url_for("upload"))

    employee_result = None
    try:
        # Employee reference first, so an insurance file uploaded in the same
        # submission resolves teams against the freshly uploaded mapping.
        if employee_file and employee_file.filename:
            employee_result = _save_and_run(employee_file, ingest.ingest_employee_file)

        result = None
        if insurance_file and insurance_file.filename:
            result = _save_and_run(insurance_file, ingest.ingest_policy_file)

        # Leads/RM backfill last - it only fills in RM where the policy
        # import above left one blank, so it should see today's import first.
        leads_result = None
        if leads_file and leads_file.filename:
            leads_result = _save_and_run(leads_file, ingest.backfill_rm_from_leads)
    except ingest.IngestError as exc:
        flash(str(exc), "error")
        return redirect(url_for("upload"))

    return _render_upload_page(result=result, employee_result=employee_result, leads_result=leads_result)


def _filtered_renewals():
    conn = db.connect()
    try:
        return queries.build(
            conn, bucket=request.args.get("bucket", "next7"),
            search=request.args.get("q", ""), insurance_type=request.args.get("type", "all"),
            team=request.args.get("team", "all"), rm=request.args.get("rm", "all"),
            status=request.args.get("status", "all"), month=request.args.get("month", "all"),
            start=request.args.get("start"), end=request.args.get("end"),
        )
    finally:
        conn.close()


@app.route("/api/overview")
def api_overview():
    conn = db.connect()
    try:
        return jsonify(queries.overview(conn))
    finally:
        conn.close()


@app.route("/api/renewals")
def api_renewals():
    try:
        return jsonify(_filtered_renewals())
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/renewals/export")
def export_renewals():
    try:
        data = _filtered_renewals()
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    response = send_file(
        exports.workbook(data), as_attachment=True,
        download_name=f"renewals-{data['bucket']}-{data['as_of']}.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/renewals/<path:policy_no>", methods=["PATCH"])
def update_renewal(policy_no):
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Expected an object."}), 400
    conn = db.connect()
    try:
        result = (queries.update_fields(conn, policy_no, data["fields"]) if "fields" in data
                  else queries.update_field(conn, policy_no, data.get("field"), data.get("value")))
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
    return redirect(url_for("upload"))


if __name__ == "__main__":
    db.init_db()
    app.run(debug=True, port=5003)

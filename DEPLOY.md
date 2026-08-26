# Deploying to Render + GitHub (with a free Neon Postgres database)

Render's free web services have **no persistent disk** — any local file, including
a SQLite database, gets wiped on every deploy or restart. So this app stores data
in a real hosted Postgres database instead (free, and independent of Render), and
Render only hosts the Flask app itself. Push to GitHub, Render redeploys the code,
your data stays untouched in Postgres.

## 1. Create a free Postgres database (Neon)

1. Go to [neon.tech](https://neon.tech) and sign up (GitHub login is fastest).
2. Create a new project. Any region close to you is fine.
3. On the project dashboard, copy the **connection string** — it looks like:
   ```
   postgresql://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
   ```
   Keep this safe; it's the only thing that connects the app to your data.

*(Supabase's free Postgres works the same way if you prefer it — the connection
string is in Project Settings &rarr; Database.)*

## 2. Push this folder to GitHub

```bash
cd "Health Ops Renewal Tracker"
git init
git add .
git commit -m "Renewal tracker"
```

Create a new **empty** repository on GitHub (no README/license), then:

```bash
git remote add origin YOUR_REPO_URL
git branch -M main
git push -u origin main
```

## 3. Create the Render web service

1. Go to [render.com](https://render.com) and sign in with GitHub.
2. **New +** &rarr; **Blueprint**, and pick the repo you just pushed.
   Render reads `render.yaml` in this folder automatically and fills in the
   build/start commands.
   - If you'd rather set it up by hand: **New +** &rarr; **Web Service**,
     Build command `pip install -r requirements.txt`, Start command `gunicorn app:app`.
3. When asked for environment variables, set:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | the Neon connection string from step 1 |
   | `SECRET_KEY` | Render can auto-generate this (the blueprint does) |

4. Click **Deploy**. First deploy takes a couple of minutes.

Your app is now live at `https://YOUR-SERVICE-NAME.onrender.com`.

## 4. Every future update

```bash
git add .
git commit -m "describe the change"
git push
```

Render redeploys automatically on every push to `main`. The renewal data in
Neon is completely separate from this — a redeploy never touches it.

## Notes

- **Free-tier spin-down.** Render's free web services sleep after 15 minutes of
  no traffic and take ~30-50 seconds to wake on the next request. Fine for an
  internal ops tool checked a few times a day; just expect the first load to be slow.
- **Neon free-tier limits.** 0.5 GB storage and the database auto-suspends when
  idle (wakes automatically on the next query, similarly slow first hit). This
  dataset is a few hundred KB per thousand policies, so storage is not a concern.
- **Local testing before you deploy:**
  ```bash
  pip install -r requirements.txt
  cp .env.example .env    # then paste your Neon connection string into it
  python app.py
  ```
  Open <http://127.0.0.1:5003>. This talks to the *same* Neon database as
  production, so test uploads there are real data — use a throwaway Neon
  project for testing if you don't want that.

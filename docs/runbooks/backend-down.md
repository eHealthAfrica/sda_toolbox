# Backend down

**Applies to:** `app` container (`sda-toolbox-api`, port 8000, FastAPI under uvicorn)  **Owner:** to assign  **Last tested:** not yet (draft written 2026-10-30)

Run every command below from the repository root, `C:\Workspace\DEV\Toolbox`, in PowerShell.

## Symptoms

- Every page fails to load data; the Dashboard says it could not reach the job log.
- `http://localhost:8000/docs` does not open.
- A Slack alert from the daily canary naming `platform_health`, or from an uptime probe on `/ready` (alert A6: not ready twice in a row; this needs a probe outside the app, because a dead app cannot report itself).

## Confirm

```powershell
docker compose ps
docker inspect -f "{{.State.Status}} health={{.State.Health.Status}} OOMKilled={{.State.OOMKilled}} exit={{.State.ExitCode}}" sda-toolbox-api
docker compose logs --tail 200 app
Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod http://localhost:8000/ready
```

`/health` answers `{"status":"ok"}` whenever the process can run Python, and does nothing else. `/ready` runs the real checks (job database, logs folder, free disk, PostGIS, config) and says which one failed.

How to read it:

- `exited`: the process stopped or crashed. The last lines of the log say why.
- `running` with `health=unhealthy`: the process is alive but not answering `/docs`, usually because one heavy job is blocking it (backlog item H7). Docker does **not** restart a container for being unhealthy; `restart: unless-stopped` only acts when the process exits.
- `OOMKilled=true`: the container ran out of memory.
- `docker compose ps` itself fails with a connection error: Docker Desktop is not running. Start it first.

## Mitigate

1. **Exited:** `docker compose up -d app`. The app waits for the `db` container to be healthy, so check `docker compose ps db` if it does not start.
2. **Running but unhealthy:** `docker compose restart app`. Any job running at that moment is lost. On start the backend marks those rows as failed with "interrupted — backend restarted or crashed while this job was running", and they count against the success rate. Tell users with a job in progress to rerun it.
3. **OOMKilled:** restart as above, then ask users not to run two large spatial jobs at the same time until a memory limit or process isolation is in place.
4. **Will not start:** read the log for an `ImportError` or a database connection error. A database error means follow `postgis-unreachable.md`.

## Fix

Open or update the incident, then fix the cause, not only the symptom:

- Blocked by a heavy job: backlog item H7 (plain `def` routes or `run_in_threadpool`).
- Out of memory: `mem_limit` in `docker-compose.yml` and running the heaviest tools in a process pool (Hardening, item 3).
- Bad release: check out the previous commit (`git log -5 --oneline`) and rebuild with `docker compose up -d --build app`.
- The `app` healthcheck in `docker-compose.yml` only requests `/docs`. `/health` now exists and is the lighter probe; ask the infrastructure owner whether to point the healthcheck at it.

## Verify

```powershell
Invoke-RestMethod http://localhost:8000/jobs/summary
docker inspect -f "{{.State.Health.Status}}" sda-toolbox-api
```

The first returns counts; the second shows `healthy` within about 45 seconds of a restart. Run one small job (a single UUID lookup) and check the Reliability page shows no new failures.

## Escalate

Call the backend owner if the container will not stay up after two restarts, or if the log mentions `jobs.sqlite3` being corrupt. Never run `docker compose down -v` or delete the `job-tracker-data` or `postgres-data` volumes.

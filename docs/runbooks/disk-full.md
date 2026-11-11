# Disk full

**Applies to:** the host disk and Docker Desktop's disk; volumes `job-tracker-logs`, `job-tracker-data` and `postgres-data`  **Owner:** to assign  **Last tested:** not yet (draft written 2026-10-30)

## Symptoms

- Jobs fail with `OSError: [Errno 28] No space left on device` (category `resource`).
- Errors mentioning "database or disk is full", from the job tracker or from Postgres.
- Docker Desktop reports it is out of space, or the `disk_free` check on `http://localhost:8000/ready` fails (status `not_ready`, HTTP 503; the detail gives the free space and the minimum).

## Confirm

```powershell
docker system df
docker system df -v
Get-PSDrive C
docker compose exec app df -h /app/src/toolbox/logs /app/src/toolbox/data /tmp
docker compose exec app du -sh /app/src/toolbox/logs
```

`docker system df -v` lists each volume's size, so you can see whether the logs, the job database or Postgres is the large one.

## Mitigate

Work down this list; the first steps are the safest.

1. **Build cache and old images** (does not touch volumes):

   ```powershell
   docker builder prune
   docker image prune
   ```

2. **Old log folders.** Logs are in dated folders under `/app/src/toolbox/logs`. List the ones older than 30 days first:

   ```powershell
   docker compose exec app find /app/src/toolbox/logs -mindepth 1 -maxdepth 1 -type d -mtime +30
   ```

   Check none belong to an open incident, then delete them by repeating the command with `-exec rm -rf {} +` on the end. This is permanent.
3. **Temporary files from failed jobs** inside the container: `docker compose exec app du -sh /tmp`. Restarting the app clears the container's `/tmp` and leaves the volumes alone.
4. **Docker Desktop's disk image is full** while the host has space: raise the disk image size in Docker Desktop (Settings, Resources), or ask the infrastructure owner to compact it.
5. **The host disk is full:** free space on `C:`.

**Never** run `docker volume prune`, `docker system prune --volumes` or `docker compose down -v`. With the stack stopped they delete `postgres-data` and `job-tracker-data`.

## Fix

- Add a log retention job that removes folders older than 30 days.
- Delete temp files in a `finally` block or a background task on every route (Hardening, item 2).
- Add per-tool upload size limits.
- The `disk_free` check already exists; raise `MIN_FREE_DISK_GB` in `.env` (default 2) if you want `/ready` to flag low disk earlier, and point an uptime probe at `/ready` so it reaches Slack.

## Verify

Free space is above the threshold (default 2 GB), `/ready` shows `disk_free` green, and a small job completes. Check Postgres still accepts connections (`postgis-unreachable.md`, Confirm).

## Escalate

Call the backend owner if Postgres or `jobs.sqlite3` reports corruption after the disk filled.

# PostGIS unreachable

**Applies to:** `db` container (`sda-toolbox-db`, image `postgis/postgis:18-3.6`, host port 5432) and the app's database connection (`toolbox/utils/credential.py`)  **Owner:** to assign  **Last tested:** not yet (draft written 2026-10-30)

## Symptoms

- Tools that read boundaries or settlements fail with connection errors (category `dependency`): UUID Checker, QC, target area, and others.
- `http://localhost:8000/ready` shows status `degraded` with the `postgis` check failing; its detail names the error (for example "Connection refused").
- The `app` container is up and the Dashboard loads, but tool runs fail.

## Confirm

```powershell
docker compose ps db
docker inspect -f "{{.State.Health.Status}}" sda-toolbox-db
docker compose logs --tail 100 db
docker compose exec db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

`accepting connections` means the database itself is fine and the problem is on the app side.

## Mitigate

1. **"Connection refused" to `localhost` (or `::1`) port 5432, and the app runs in Docker:** inside a container `localhost` is the app container itself, not the database. In `.env` set `HOST=db` (the database service's name in `docker-compose.yml`) and leave `PORT=5432`, then `docker compose up -d app`. This is what an app started on the host with `HOST=localhost` looks like once it moves into Docker.
2. **`db` exited:** `docker compose up -d db`, then wait for `healthy` (it checks every 10 seconds).
3. **"port is already allocated" when starting `db`:** the native Windows Postgres is using port 5432.

   ```powershell
   Get-NetTCPConnection -LocalPort 5432 | Select-Object OwningProcess
   Get-Service *postgres*
   ```

   Stop the native service from an elevated PowerShell, or ask the infrastructure owner to map the container to `5433:5432` in `docker-compose.yml`.
4. **`db` is healthy but the app still errors:** `docker compose restart app`. Connections opened before the database went away can be stale.
5. **Authentication failed after `.env` changed:** the database keeps the user and password it was first created with; editing `.env` later does not change them. Put the original values back. Use `docker compose config` to see what Compose resolved, but do not paste its output anywhere, because it contains the password.
6. **Connects, but tables are empty:** the `postgres-data` volume was replaced. Stop users writing and restore from the most recent `pg_dump`.

**Never** run `docker compose down -v`, `docker volume prune` or `docker system prune --volumes`. They delete the `postgres-data` volume and with it every boundary and settlement table.

## Fix

- Ask the backend owner to check whether the SQLAlchemy engine uses `pool_pre_ping=True`, so stale connections are replaced instead of failing the job.
- Keep a scheduled `pg_dump` and test a restore.
- Point an uptime probe (or the host scheduler) at `/ready` every minute, so a failing `postgis` check reaches Slack before users report it. The canary's `platform_ready` check does this once a day.

## Verify

A single UUID lookup works, `/ready` shows the `postgis` check green ("PostGIS ... reachable"), and the next tool run completes.

## Escalate

Call the backend owner immediately for any sign of data loss or corruption, and do not run anything that writes to the database until a backup is confirmed.

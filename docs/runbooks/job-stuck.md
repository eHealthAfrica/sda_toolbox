# Job stuck

**Applies to:** any tool endpoint; jobs recorded as `active` in the job tracker  **Owner:** to assign  **Last tested:** not yet (draft written 2026-10-30)

## Symptoms

- A job shows **Active** on the Dashboard far longer than that tool normally takes, or a tool page's progress card keeps spinning.
- Other requests are slow or time out at the same time (the heavy job is blocking the server).
- Slack alert A4: a job active longer than `STUCK_JOB_MINUTES` (default 30; per-tool limits in `STUCK_JOB_MINUTES_OVERRIDES`, for example `gts_device_tracking=90`). The alert names the tool and, if the tool reports it, the last stage.

## Confirm

List the active jobs and when they started:

```powershell
(Invoke-RestMethod "http://localhost:8000/jobs?status=active&limit=50").jobs | Select-Object tool, started_at, stage, label
```

Check whether the server is still responsive and what it is using:

```powershell
docker stats --no-stream sda-toolbox-api
Measure-Command { Invoke-WebRequest http://localhost:8000/docs -UseBasicParsing | Out-Null }
docker compose logs --tail 100 app
```

How to read it:

- `/docs` takes more than a few seconds while CPU sits near one full core: a heavy job is blocking the server for everyone (backlog item H7).
- `/docs` answers quickly: only that job is slow. Compare its age with the tool's p95 time on the Reliability page. Very large inputs are legitimately slow; one device-tracking run took 27 minutes before failing.
- Log lines stop for many minutes with no error: the job is probably waiting on something (database, disk). Check `postgis-unreachable.md` and `disk-full.md`.

## Mitigate

1. Only that job is slow and the rest of the toolbox works: wait until the job is about twice the tool's p95, then decide.
2. The server is unresponsive for everyone: tell users, then `docker compose restart app`. Every running job is lost and shows as failed ("interrupted"), which counts against the success rate.
3. The input is very large: ask the user to split it (by state, LGA or week) and rerun in parts.

## Fix

- Backlog item H7: change `async def` routes that do heavy pandas/geopandas work to plain `def`, or wrap the heavy call in `run_in_threadpool`.
- Run the heaviest tools in a process pool so one job cannot freeze the API.
- Call `report_stage('reading tracks')` (from `toolbox.job_tracker`) at the main steps of each long tool. The `stage` column then says where a stalled or crashed job got to, and the A4 alert includes it.
- Add per-tool upload size limits and a stuck-job alert threshold.

## Verify

The job row is `completed` or `failed`, not `active`. During a long run, `/docs` still answers in under a second.

## Escalate

If the same tool gets stuck twice in a week, open it as a sev2 incident with the tool's runbook linked, and ask the backend owner to prioritise item H7.

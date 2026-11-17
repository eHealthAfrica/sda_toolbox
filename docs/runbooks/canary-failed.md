# Canary failed

**Applies to:** the weekly canary run (`scripts\canary.py`, scheduled in Windows Task Scheduler); alert A5  **Owner:** to assign  **Last tested:** not yet (draft written 2026-10-30)

The canary posts a small request to the running backend and checks the answer. Three checks need no files (`platform_health`, `platform_ready`, `database_lookup`); the tool checks (`gts_device_tracking`, `reach`, `h2h`) run only once their fixture files exist and they are enabled in `tests\fixtures\canary\manifest.json`. A check that cannot run counts as failed, never as a pass.

## Schedule

The run is a Windows Task Scheduler task named "SDA Toolbox Canary" (weekly, on Monday at 07:00 by default; `-DayOfWeek`, `-Time` and `-Schedule Daily` change that), created by `scripts\schedule_canary.ps1`; its output is appended to `logs\canary\scheduler.log`. If no alert ever arrives, check that the task exists, that its last result is 0, and that the PC was signed in at that time (the task runs only while you are signed in).

```powershell
powershell -ExecutionPolicy Bypass -File scripts\schedule_canary.ps1 -RunNow    # create or update it, then run once
powershell -ExecutionPolicy Bypass -File scripts\schedule_canary.ps1 -Time 06:30
powershell -ExecutionPolicy Bypass -File scripts\schedule_canary.ps1 -Remove
```

## Symptoms

- An alert says a canary check failed for a named tool.
- The Reliability page's Recent failures table shows a failed job tagged `canary`.
- The canary's own record: `logs\canary\runs.jsonl` (every run) and `logs\canary\state.json` (consecutive failures per check).

## Confirm

1. Which checks failed: one, or all of them? The alert text lists each check and the reason.
2. Look at the failed canary jobs:

   ```powershell
   (Invoke-RestMethod "http://localhost:8000/jobs?status=failed&source=canary&limit=20").jobs | Select-Object tool, started_at, error_type, error_detail
   ```

3. Run that check again by hand, which prints the detail and sends no alert: `python scripts\canary.py --tool <check name>`. Is it repeatable?

Decide what failed:

- **`platform_health` failed, or "backend not reachable":** the app is down. Go to `backend-down.md`.
- **`platform_ready` failed:** the reason names the failing critical check (job database, logs folder, disk). See `disk-full.md` for disk; otherwise `backend-down.md`.
- **`database_lookup` failed while `platform_health` passed:** the app cannot read the database. Go to `postgis-unreachable.md`.
- **One tool, started after a deploy:** a real regression.
- **One tool, no deploy:** the failure says `HTTP 422` or `400 (the fixture may be out of date)` when the tool rejected the sample file, for example because a required column changed. Otherwise a dependency changed (a database table, a reference file).

## Mitigate

- **Real regression after a deploy:** roll back (see `high-failure-rate.md`) and tell users in the channel.
- **Tool down, others fine:** say which tool to avoid until it is fixed. The Slack alert is sev2; a second consecutive failure of the same check makes it sev1. Alerts for one check repeat at most every 6 hours.

## Fix

- Fix the tool and add a regression test named after the incident.
- If the fixture is out of date (for example a new campaign changed a column or a team-code format), rebuild all three tool fixtures together from the current campaign's files. They are one small LGA, so the tracks, the settlement list and the data-source rows agree with each other:

  ```powershell
  python scripts\make_canary_fixture.py areas --tracks <tracks.csv> --settlements <settlement list> --sources <data sources.xlsx>
  python scripts\make_canary_fixture.py area  --tracks <tracks.csv> --settlements <settlement list> --sources <data sources.xlsx> --state <State> --lga <LGA>
  ```

  `areas` lists LGAs that have correctly coded teams and rows in every data source (REACH rejects a source with no rows for the planned state). `area` writes `tests\fixtures\canary\...` and prints the `activity_code` to put in the manifest. It replaces device ids in the tracks with stand-ins. Open the files and check they contain nothing sensitive, then write in the commit message what changed and why. For a single file, `tracks` and `head` still work. Do not loosen the canary's assertion just to make it pass.

  The shipped fixtures were built from the November 2026 SNIPDs files: Tureta LGA, Sokoto State, activity code `SNIPDS`.

## Verify

Rerun `python scripts\canary.py` and see it pass. Canary runs count towards closing incidents, so the incident resolves after two clean runs, and the channel gets a "resolved after ..." message. The scheduled run is only weekly, so run it by hand twice after a fix instead of waiting two weeks for the incident to close.

Because the run is weekly, a platform outage can go unnoticed by the canary for days; the backend's own alerts (health, readiness, failure rate) are what catch those in between. A second failed run is a week after the first, so "two consecutive failures" (sev1) means a problem that survived a whole week.

## Escalate

Two consecutive failures for the same tool is sev1: call the owner. If the canary itself cannot run (script error, fixture missing), treat that as a failed check, not a pass, and fix the script first.

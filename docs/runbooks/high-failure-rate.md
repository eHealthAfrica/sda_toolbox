# High failure rate

**Applies to:** one tool or all tools; raised by alert A2 (3 or more failures on a tool in an hour) or A3 (7-day success rate below 95%)  **Owner:** to assign  **Last tested:** not yet (draft written 2026-10-30)

## Symptoms

- The Reliability page shows a success rate below the 95% target, or a tool in red.
- An A2 or A3 alert arrived in the channel.

## Confirm

On the Reliability page:

1. **Reliability by tool:** is it one tool or many?
2. **Why jobs failed:** which category dominates? Only the red categories count against the target.
3. **Most common crash causes:** is there one traceback hash with a high count?
4. **Recent failures:** the newest failed jobs with their category, error type and short detail. The same list comes from `Invoke-RestMethod "http://localhost:8000/jobs?status=failed&limit=20"`.
5. **Success rate by day:** when did it start? Compare with the last deploy:

```powershell
git log --since="3 days ago" --oneline
docker inspect -f "{{.Created}}" sda-toolbox-api
```

## Decide

| What you see | Likely cause | Go to |
| --- | --- | --- |
| Every tool failing, mostly `dependency` | Database unreachable | `postgis-unreachable.md` |
| Every tool failing, mostly `resource` | Disk full or out of memory | `disk-full.md`, `backend-down.md` |
| One tool, one hash, started right after a deploy | Bad release | Roll back (below) |
| Mostly `user_input` or `data_contract` | Bad uploads, not a platform fault | Improve the validation message on that tool's page; these are not counted |
| `ValueError: max_workers must be greater than 0` in batch-read tools | Fewer than 3 CPUs visible to the container (`toolbox.CPU_COUNT` is CPU count minus 2); see quirk 4 in `DOCKERIZATION_PLAN.md` | Give Docker Desktop more CPUs, or set `cpus` under `deploy.resources.limits` |
| Chart-producing tools fail with a Chromium or sandbox error | kaleido under the non-root container user; see the note near the end of the `Dockerfile` | Backend owner |

## Mitigate

- **Bad release:** `git checkout <previous commit>` then `docker compose up -d --build app`. Note the commit you rolled back from in the incident.
- **One tool broken:** tell users in the channel which tool to avoid until fixed.
- Acknowledge the incident on the Reliability page and set its severity (sev2 if a core tool is down for users).

## Fix

Fix the top cause first and add a regression test named after the incident (`tests/regression/test_inc_<id8>.py`). If the cause is on the hardening backlog (H1 to H7), fix it from there.

## Verify

The next 10 jobs on the affected tool complete. The incident closes by itself after two clean runs. The daily success rate is back above 95% within two days.

## Escalate

Call the backend owner if the 7-day rate falls below 90%, or if a core tool (REACH, device tracking, H2H) is failing for every user.

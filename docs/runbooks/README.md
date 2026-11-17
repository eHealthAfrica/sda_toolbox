# Runbooks

Short, step-by-step guides for the failures the toolbox reports. The Slack alerts name one of these (for example "Runbook: job-stuck"). Each runbook has the same sections: Symptoms, Confirm, Mitigate, Fix, Verify, Escalate. Run commands from the repository root in PowerShell.

| Runbook | Use it when |
| --- | --- |
| `backend-down.md` | The app does not answer, every page fails, or `/health` is down. |
| `job-stuck.md` | A job has been Active far longer than usual (alert A4). |
| `high-failure-rate.md` | One tool or all tools are failing more than the 95% target allows (alerts A2, A3). |
| `postgis-unreachable.md` | `/ready` shows `postgis` failing, or tools that read boundaries fail with connection errors. |
| `disk-full.md` | Jobs fail with "No space left on device", or `/ready` shows `disk_free` failing. |
| `canary-failed.md` | The daily canary reported a failed check (alert A5). |

Every runbook says **Last tested: not yet**. After the first real use or a rehearsal, update that line with the date and what you changed.

To make the runbook names in alerts into links, set `ALERT_RUNBOOK_BASE_URL` in `.env` to where these files are served (for example the repository's `docs/runbooks` folder on your Git host) and restart the app.

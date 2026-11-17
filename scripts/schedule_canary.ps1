<#
.SYNOPSIS
  Registers (or removes) the daily SDA Toolbox canary in Windows Task Scheduler.

.DESCRIPTION
  Creates one scheduled task that runs scripts\canary.py every day and appends
  its output to logs\canary\scheduler.log. The canary posts to Slack itself
  when a check fails (see docs\runbooks\canary-failed.md), so the task only
  needs to run it.

  No administrator rights are needed. The task runs as you, only while you are
  signed in (so the backend, which lives in Docker Desktop on this PC, is
  normally up). If the PC was off at the scheduled time, the run happens as
  soon as it is available again.

  Before registering, the script checks that a usable Python (3.10 or newer) is
  found, that canary.py starts, and that CANARY_TOKEN is set in .env (it only
  checks that the value is there; it never prints it).

.PARAMETER Time
  Time of day to run, 24-hour HH:mm. Default 07:00.

.PARAMETER TaskName
  Name shown in Task Scheduler. Default "SDA Toolbox Canary".

.PARAMETER PythonPath
  Full path to python.exe, if the script cannot find one itself.

.PARAMETER RunNow
  After registering, start the task once and show the result.

.PARAMETER Remove
  Delete the task instead of creating it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\schedule_canary.ps1 -RunNow

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\schedule_canary.ps1 -Time 06:30

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\schedule_canary.ps1 -Remove
#>
[CmdletBinding()]
param(
    [string]$Time = '07:00',
    [string]$TaskName = 'SDA Toolbox Canary',
    [string]$PythonPath,
    [switch]$RunNow,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$canary = Join-Path $repo 'scripts\canary.py'
$envFile = Join-Path $repo '.env'
$logDir = Join-Path $repo 'logs\canary'
$logFile = Join-Path $logDir 'scheduler.log'

function Find-Python {
    param([string]$Wanted)
    $candidates = @()
    if ($Wanted) { $candidates += $Wanted }
    $venv = Join-Path $repo '.venv\Scripts\python.exe'
    if (Test-Path $venv) { $candidates += $venv }
    foreach ($name in 'python', 'python3') {
        $found = Get-Command $name -ErrorAction SilentlyContinue
        if ($found -and $found.Source) { $candidates += $found.Source }
    }
    foreach ($path in $candidates) {
        try {
            $version = & $path -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
            if ($LASTEXITCODE -eq 0 -and $version -and ([version]$version -ge [version]'3.10')) { return $path }
        } catch {
            continue
        }
    }
    return $null
}

if ($Remove) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed the task '$TaskName'."
    } else {
        Write-Host "There is no task named '$TaskName'."
    }
    return
}

try {
    $at = [datetime]::ParseExact($Time, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
} catch {
    throw "Time must look like 07:00 (24-hour HH:mm); got '$Time'."
}

if (-not (Test-Path $canary)) { throw "Cannot find $canary. Run this script from the Toolbox repository." }

$python = Find-Python -Wanted $PythonPath
if (-not $python) {
    throw 'No Python 3.10 or newer found. Install it, or pass -PythonPath C:\path\to\python.exe.'
}
Write-Host "Using Python: $python"

& $python $canary --list | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'canary.py did not start; run it by hand to see the error: python scripts\canary.py --list' }

$tokenSet = (Test-Path $envFile) -and (Select-String -Path $envFile -Pattern '^\s*CANARY_TOKEN\s*=\s*\S+' -Quiet)
if (-not $tokenSet) {
    Write-Warning 'CANARY_TOKEN is not set in .env. The canary will exit with an error until it is (add a long random value, restart the app container, then run again).'
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# cmd.exe so the output can be appended to a log file; the outer quotes keep cmd from mangling the inner ones.
$inner = '"{0}" "{1}" >> "{2}" 2>&1' -f $python, $canary, $logFile
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "{0}"' -f $inner) -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At $at
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force `
    -Description 'Runs the SDA Toolbox canary (scripts\canary.py) and posts to Slack if a check fails.' | Out-Null

Write-Host ''
Write-Host "Registered '$TaskName': every day at $Time."
Write-Host "Output is appended to: $logFile"
Write-Host 'Change or remove it later in Task Scheduler, or run this script again (-Time, -Remove).'

if ($RunNow) {
    Write-Host ''
    Write-Host 'Running it once now...'
    Start-ScheduledTask -TaskName $TaskName
    $deadline = (Get-Date).AddMinutes(3)
    do {
        Start-Sleep -Seconds 2
        $state = (Get-ScheduledTask -TaskName $TaskName).State
    } while ($state -eq 'Running' -and (Get-Date) -lt $deadline)

    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    if ($state -eq 'Running') {
        Write-Host 'Still running after 3 minutes; check the log file later.'
    } else {
        Write-Host ("Last result: {0} (0 = all checks passed)" -f $info.LastTaskResult)
    }
    if (Test-Path $logFile) {
        Write-Host '--- end of the log ---'
        Get-Content $logFile -Tail 15
    }
}

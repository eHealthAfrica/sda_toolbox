"""Tests for hardening item H7: heavy work must not block the event loop.

Run from the repo root:  python -m unittest tests.test_offload -v

Acceptance from the spec: "while a long job runs, /health still answers in under 1 s".
These tests measure the same thing directly: a ticker coroutine records how long the event
loop was unable to run while a slow job was in progress.
"""
import asyncio
import contextvars
import importlib
import importlib.util
import os
import sys
import time
import types
import unittest
from pathlib import Path
from unittest import mock

from tests import test_reliability  # noqa: F401  (puts the package on sys.path)
from toolbox.utils import offload

SRC = Path(__file__).resolve().parents[1] / 'src' / 'toolbox'
SLOW = 0.6          # seconds of "analysis"
MAX_STALL = 0.25    # the loop may never be stuck for longer than this


async def worst_stall(work, interval=0.02):
    """Run `work()` (a coroutine) while a ticker watches the event loop; return (result, longest gap between ticks)."""
    gaps, running = [], True

    async def ticker():
        last = time.perf_counter()
        while running:
            await asyncio.sleep(interval)
            now = time.perf_counter()
            gaps.append(now - last)
            last = now

    watcher = asyncio.create_task(ticker())
    await asyncio.sleep(interval * 3)          # let the ticker settle
    try:
        result = await work()
    finally:
        running = False
        await watcher
    return result, max(gaps)


class RunHeavy(unittest.TestCase):
    def setUp(self):
        patch = mock.patch.dict(os.environ, {}, clear=False)
        patch.start()
        self.addCleanup(patch.stop)
        os.environ.pop('HEAVY_JOB_LIMIT', None)

    def test_the_loop_stays_responsive_during_a_slow_job(self):
        async def scenario():
            return await worst_stall(lambda: offload.run_heavy(time.sleep, SLOW))
        _, stall = asyncio.run(scenario())
        self.assertLess(stall, MAX_STALL)

    def test_the_same_job_run_directly_would_have_frozen_the_loop(self):
        """Control: proves the measurement above can tell the difference."""
        async def blocking():
            time.sleep(SLOW)
        _, stall = asyncio.run(worst_stall(blocking))
        self.assertGreater(stall, SLOW * 0.8)

    def test_returns_the_result_and_passes_arguments(self):
        def work(a, b, *, c):
            return (a, b, c)
        self.assertEqual(asyncio.run(offload.run_heavy(work, 1, 2, c=3)), (1, 2, 3))

    def test_exceptions_reach_the_caller(self):
        def boom():
            raise KeyError('missing column')
        with self.assertRaises(KeyError):
            asyncio.run(offload.run_heavy(boom))

    def test_context_variables_reach_the_worker_thread(self):
        var = contextvars.ContextVar('job', default='none')

        async def scenario():
            var.set('job-42')
            return await offload.run_heavy(var.get)
        self.assertEqual(asyncio.run(scenario()), 'job-42')

    def test_at_most_the_limit_run_at_once(self):
        os.environ['HEAVY_JOB_LIMIT'] = '2'
        state = {'now': 0, 'peak': 0}

        def job():
            state['now'] += 1
            state['peak'] = max(state['peak'], state['now'])
            time.sleep(0.1)
            state['now'] -= 1

        async def scenario():
            await asyncio.gather(*[offload.run_heavy(job) for _ in range(6)])
        asyncio.run(scenario())
        self.assertEqual(state['peak'], 2)

    def test_a_waiting_job_says_so_in_the_job_log(self):
        os.environ['HEAVY_JOB_LIMIT'] = '1'

        async def scenario():
            first = asyncio.create_task(offload.run_heavy(time.sleep, 0.2))
            await asyncio.sleep(0.05)
            await offload.run_heavy(lambda: None)
            await first
        with self.assertLogs(level='INFO') as logs:
            asyncio.run(scenario())
        self.assertTrue(any('already running' in line for line in logs.output))

    def test_limit_setting(self):
        self.assertEqual(offload.heavy_job_limit(), offload.DEFAULT_LIMIT)
        os.environ['HEAVY_JOB_LIMIT'] = '4'
        self.assertEqual(offload.heavy_job_limit(), 4)
        os.environ['HEAVY_JOB_LIMIT'] = '0'
        self.assertEqual(offload.heavy_job_limit(), 1)
        os.environ['HEAVY_JOB_LIMIT'] = 'many'
        self.assertEqual(offload.heavy_job_limit(), offload.DEFAULT_LIMIT)

    def test_works_across_event_loops(self):
        for _ in range(3):
            self.assertEqual(asyncio.run(offload.run_heavy(lambda: 'ok')), 'ok')


# ----------------------------------------------------------------------
def load_with_stubs(path, name, stub_names):
    """Import a repo module straight from its file with the named dependencies replaced by MagicMocks."""
    saved = {n: sys.modules.get(n) for n in stub_names}
    for n in stub_names:
        sys.modules[n] = mock.MagicMock(name=n)
    try:
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for n, previous in saved.items():
            if previous is None:
                sys.modules.pop(n, None)
            else:
                sys.modules[n] = previous


class ToolEntryPointsDoNotBlock(unittest.TestCase):
    """The two shared analysis functions are `async def` over synchronous pandas work; their
    public (awaited) function must hand that work to a thread."""

    def test_gts_device_team_analysis(self):
        module = load_with_stubs(
            SRC / 'campaign' / 'device_tracking.py', 'device_tracking_under_test',
            ['tqdm', 'geopandas', 'toolbox.campaign', 'toolbox.campaign.team_reviewer'])
        sentinel = object()

        def slow_analysis(tracks, code, vb):
            time.sleep(SLOW)
            return (tracks, code, vb, sentinel)

        async def scenario():
            with mock.patch.object(module, '_analyse_device_teams', slow_analysis):
                return await worst_stall(lambda: module.gts_device_team_analysis('t', 'IBRA', 'v'))
        result, stall = asyncio.run(scenario())
        self.assertEqual(result, ('t', 'IBRA', 'v', sentinel))
        self.assertLess(stall, MAX_STALL)

    def test_h2h_settlement_tracking(self):
        module = load_with_stubs(
            SRC / 'campaign' / 'tracker.py', 'tracker_under_test',
            ['fastapi', 'geopandas', 'toolbox.access', 'toolbox.access.read_mgr', 'toolbox.campaign',
             'toolbox.campaign.visitation_analysis', 'toolbox.campaign.campaign_tools', 'toolbox.campaign.grids',
             'toolbox.reporting', 'toolbox.models', 'toolbox.configs', 'toolbox.tracks_manager',
             'toolbox.tracks_manager.tr'])

        def slow_tracking(datasets, state, generate_report):
            time.sleep(SLOW)
            return ('done', datasets, state, generate_report)

        async def scenario():
            with mock.patch.object(module, '_track_settlements', slow_tracking):
                return await worst_stall(lambda: module.settlement_tracking('ds', 'Kano', True))
        result, stall = asyncio.run(scenario())
        self.assertEqual(result, ('done', 'ds', 'Kano', True))
        self.assertLess(stall, MAX_STALL)


if __name__ == '__main__':
    unittest.main()

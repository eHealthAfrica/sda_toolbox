"""Tests for scripts/canary.py and scripts/make_canary_fixture.py. Run: python3 -m unittest tests.test_canary -v"""
import email
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'scripts'))
import canary  # noqa: E402
import make_canary_fixture as maker  # noqa: E402

REAL_MANIFEST = HERE / 'fixtures' / 'canary' / 'manifest.json'
ENV_KEYS = ['CANARY_TOKEN', 'CANARY_BASE_URL', 'ALERT_WEBHOOK_URL', 'ALERT_WEBHOOK_FORMAT', 'PUBLIC_BASE_URL',
            'CANARY_ALERT_COOLDOWN_HOURS']


class FakeBackend:
    def __init__(self):
        self.requests = []
        self.ready_status, self.ready_body = 200, {'status': 'ready', 'checks': []}
        self.gts_body = b'statename,lganame,wardname,team_code,imei,analysis_date,track_count,duration_mins,' \
                        b'distance_meters,coverage_area_sqm,team_code_flag\nKano,A,B,T1,I1,2026-10-01,10,60,5,6,\n'
        self.gts_status, self.gts_type = 200, 'text/csv'
        self.zip_names = ['out.csv', 'tracks_day_1.gpkg']
        self.job_header = True
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def _reply(self, status, body, ctype='application/json', extra=None):
                self.send_response(status)
                self.send_header('Content-Type', ctype)
                for k, v in (extra or {}).items():
                    self.send_header(k, v)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _record(self):
                length = int(self.headers.get('Content-Length') or 0)
                body = self.rfile.read(length) if length else b''
                outer.requests.append({'method': self.command, 'path': self.path, 'headers': dict(self.headers),
                                       'body': body})

            def do_GET(self):
                self._record()
                if self.path == '/health':
                    self._reply(200, b'{"status":"ok"}')
                elif self.path == '/ready':
                    self._reply(outer.ready_status, json.dumps(outer.ready_body).encode())
                elif self.path.startswith('/uuid_check'):
                    self._reply(200, b'{"uuid":"x","exists":"NOT EXISTS"}')
                elif self.path.startswith('/tracking/gridded/archive/'):
                    buf = io.BytesIO()
                    with zipfile.ZipFile(buf, 'w') as z:
                        for n in outer.zip_names:
                            z.writestr(n, 'x')
                    self._reply(200, buf.getvalue(), 'application/x-zip-compressed')
                else:
                    self._reply(404, b'{}')

            def do_POST(self):
                self._record()
                if self.path.startswith('/tracking/devices'):
                    self._reply(outer.gts_status, outer.gts_body, outer.gts_type)
                elif self.path == '/tracking/gridded':
                    extra = {'X-Job-Id': 'job123'} if outer.job_header else {}
                    self._reply(200, b'a,b\n1,2\n', 'text/csv', extra)
                else:
                    self._reply(404, b'{}')

            def log_message(self, *a):
                pass

        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class Hook(FakeBackend):
    """Webhook receiver."""

    def __init__(self):
        self.bodies = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                outer.bodies.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(200)
                self.end_headers()

            def log_message(self, *a):
                pass

        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        self.url = f'http://127.0.0.1:{self.server.server_port}/secret-hook-token'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


class CanaryCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='canary-test-'))
        (self.tmp / 'fixtures' / 'gts').mkdir(parents=True)
        (self.tmp / 'fixtures' / 'gts' / 'tracks.csv').write_text('a,b\n1,2\n')
        (self.tmp / 'fixtures' / 'h2h').mkdir(parents=True)
        (self.tmp / 'fixtures' / 'h2h' / 'tracks.csv').write_text('a,b\n1,2\n')
        (self.tmp / 'fixtures' / 'h2h' / 'dip.xlsx').write_bytes(b'PK-not-really')
        for name, value in (('ROOT', self.tmp), ('FIXTURE_DIR', self.tmp / 'fixtures'),
                            ('STATE_DIR', self.tmp / 'logs' / 'canary')):
            patcher = mock.patch.object(canary, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        for k in ENV_KEYS:
            os.environ.pop(k, None)
        self.backend = FakeBackend()
        self.hook = Hook()
        self.addCleanup(self.backend.close)
        self.addCleanup(self.hook.close)
        os.environ['CANARY_TOKEN'] = 'tok-123'
        os.environ['CANARY_BASE_URL'] = self.backend.url
        os.environ['ALERT_WEBHOOK_URL'] = self.hook.url
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ENV_KEYS])
        self.manifest = {'checks': [
            {'name': 'platform_health', 'path': '/health', 'expect': {'json_equals': {'status': 'ok'}}},
            {'name': 'platform_ready', 'path': '/ready', 'expect': {'ready': True}},
            {'name': 'database_lookup', 'path': '/uuid_check?uuid=u', 'expect': {'json_has': ['uuid', 'exists']}},
            {'name': 'gts', 'enabled': False, 'method': 'POST', 'path': '/tracking/devices',
             'query': {'activity_code': 'NIPD'}, 'files': {'tracks_file': 'gts/tracks.csv'},
             'expect': {'content_type': 'text/csv', 'min_rows': 1,
                        'csv_columns': ['statename', 'team_code', 'team_code_flag']}},
            {'name': 'h2h', 'enabled': False, 'method': 'POST', 'path': '/tracking/gridded',
             'files': {'tracks_path': 'h2h/tracks.csv', 'dip_file': 'h2h/dip.xlsx'},
             'form': {'analysis_day': '1', 'is_mop_up': 'false'},
             'expect': {'content_type': 'text/csv', 'min_rows': 1, 'headers_present': ['X-Job-Id']},
             'followup': {'path': '/tracking/gridded/archive/{header:x-job-id}',
                          'expect': {'zip_contains': ['.csv', '.gpkg']}}},
        ]}

    def enable(self, *names):
        for c in self.manifest['checks']:
            if c['name'] in names:
                c['enabled'] = True

    def run_canary(self, *argv, manifest=None):
        path = self.tmp / 'manifest.json'
        path.write_text(json.dumps(manifest or self.manifest))
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = canary.main([*argv, '--manifest', str(path)])
        return code, out.getvalue(), err.getvalue()


class Platform(CanaryCase):
    def test_all_pass_and_every_request_is_marked_canary(self):
        code, out, _ = self.run_canary()
        self.assertEqual(code, 0, out)
        self.assertIn('3 passed, 0 failed, 2 skipped', out)
        self.assertTrue(self.backend.requests)
        for r in self.backend.requests:
            self.assertEqual(r['headers'].get('X-Canary'), 'tok-123')

    def test_no_token_is_a_configuration_error(self):
        os.environ.pop('CANARY_TOKEN')
        code, _, err = self.run_canary()
        self.assertEqual(code, 2)
        self.assertIn('CANARY_TOKEN', err)
        self.assertEqual(self.backend.requests, [])

    def test_token_can_come_from_the_env_file(self):
        os.environ.pop('CANARY_TOKEN')
        (self.tmp / '.env').write_text('# c\nPASSWORD=secret\nexport CANARY_TOKEN="from-file"\n')
        try:
            code, out, _ = self.run_canary()
        finally:
            os.environ.pop('CANARY_TOKEN', None)
            os.environ.pop('PASSWORD', None)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.backend.requests[0]['headers']['X-Canary'], 'from-file')
        self.assertNotIn('secret', out)

    def test_ready_not_ready_fails_and_names_the_critical_check(self):
        self.backend.ready_status = 503
        self.backend.ready_body = {'status': 'not_ready', 'checks': [
            {'name': 'disk_free', 'ok': False, 'critical': True}, {'name': 'postgis', 'ok': False, 'critical': False}]}
        code, out, _ = self.run_canary()
        self.assertEqual(code, 1)
        self.assertIn('expected HTTP 200, got 503', out)

    def test_ready_degraded_passes_with_a_note(self):
        self.backend.ready_body = {'status': 'degraded', 'checks': [
            {'name': 'postgis', 'ok': False, 'critical': False}, {'name': 'jobs_db', 'ok': True, 'critical': True}]}
        code, out, _ = self.run_canary()
        self.assertEqual(code, 0)
        self.assertIn('degraded: postgis', out)

    def test_critical_failure_inside_a_200_still_fails(self):
        self.backend.ready_body = {'status': 'ready', 'checks': [{'name': 'jobs_db', 'ok': False, 'critical': True}]}
        code, out, _ = self.run_canary()
        self.assertEqual(code, 1)
        self.assertIn('not ready: jobs_db', out)

    def test_backend_down_reports_one_failure_skips_the_rest_and_alerts_once(self):
        os.environ['CANARY_BASE_URL'] = 'http://127.0.0.1:1'
        self.enable('gts')
        code, out, _ = self.run_canary()
        self.assertEqual(code, 1)
        self.assertIn('backend not reachable', out)
        self.assertIn('1 failed', out)
        self.assertIn('skipped: backend unreachable', out)
        self.assertEqual(len(self.hook.bodies), 1)
        self.assertIn('Canary failed: platform_health', self.hook.bodies[0]['text'])


class ToolChecks(CanaryCase):
    def test_disabled_tool_checks_are_skipped_and_listed(self):
        code, out, _ = self.run_canary('--list')
        self.assertEqual(code, 0)
        self.assertIn('DISABLED  gts', out)
        self.assertIn('enabled   platform_health', out)

    def test_gts_request_is_a_correct_multipart_post(self):
        self.enable('gts')
        code, out, _ = self.run_canary()
        self.assertEqual(code, 0, out)
        post = [r for r in self.backend.requests if r['method'] == 'POST'][0]
        self.assertEqual(post['path'], '/tracking/devices?activity_code=NIPD')
        self.assertEqual(post['headers']['X-Canary'], 'tok-123')
        message = email.message_from_bytes(
            b'Content-Type: ' + post['headers']['Content-Type'].encode() + b'\r\n\r\n' + post['body'])
        parts = message.get_payload()
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].get_param('name', header='content-disposition'), 'tracks_file')
        self.assertEqual(parts[0].get_filename(), 'tracks.csv')
        self.assertEqual(parts[0].get_payload(decode=True), b'a,b\n1,2\n')

    def test_form_fields_and_followup_for_h2h(self):
        self.enable('h2h')
        code, out, _ = self.run_canary()
        self.assertEqual(code, 0, out)
        post = [r for r in self.backend.requests if r['method'] == 'POST'][0]
        message = email.message_from_bytes(
            b'Content-Type: ' + post['headers']['Content-Type'].encode() + b'\r\n\r\n' + post['body'])
        names = {p.get_param('name', header='content-disposition'): p for p in message.get_payload()}
        self.assertEqual(set(names), {'analysis_day', 'is_mop_up', 'tracks_path', 'dip_file'})
        self.assertEqual(names['analysis_day'].get_payload(decode=True), b'1')
        self.assertEqual(self.backend.requests[-1]['path'], '/tracking/gridded/archive/job123')

    def test_h2h_missing_job_header_and_missing_gpkg(self):
        self.enable('h2h')
        self.backend.job_header = False
        code, out, _ = self.run_canary()
        self.assertEqual(code, 1)
        self.assertIn('response header X-Job-Id is missing', out)
        self.backend.job_header = True
        self.backend.zip_names = ['out.csv']
        code, out, _ = self.run_canary()
        self.assertIn('follow-up: zip has no .gpkg file', out)

    def test_output_assertions(self):
        self.enable('gts')
        self.backend.gts_body = b'statename,team_code\nKano,T1\n'
        code, out, _ = self.run_canary()
        self.assertEqual(code, 1)
        self.assertIn('missing CSV columns: team_code_flag', out)
        self.backend.gts_body = b'statename,team_code,team_code_flag\n'
        _, out, _ = self.run_canary()
        self.assertIn('CSV has 0 rows, expected at least 1', out)
        self.backend.gts_body = b'{}'
        self.backend.gts_type = 'application/json'
        _, out, _ = self.run_canary()
        self.assertIn("is not 'text/csv'", out)

    def test_rejected_fixture_is_called_out(self):
        self.enable('gts')
        self.backend.gts_status = 422
        _, out, _ = self.run_canary()
        self.assertIn('expected HTTP 200, got 422 (the fixture may be out of date)', out)

    def test_server_error_is_a_failure(self):
        self.enable('gts')
        self.backend.gts_status = 500
        code, out, _ = self.run_canary()
        self.assertEqual(code, 1)
        self.assertIn('got 500', out)

    def test_missing_fixture_and_unset_manifest_values_fail_not_pass(self):
        self.enable('gts')
        (self.tmp / 'fixtures' / 'gts' / 'tracks.csv').unlink()
        code, out, _ = self.run_canary()
        self.assertEqual(code, 1)
        self.assertIn('fixture file missing: tests/fixtures/canary/gts/tracks.csv', out)
        (self.tmp / 'fixtures' / 'gts' / 'tracks.csv').write_text('a\n1\n')
        for c in self.manifest['checks']:
            if c['name'] == 'gts':
                c['query']['activity_code'] = 'REPLACE_ME'
        code, out, _ = self.run_canary()
        self.assertIn('manifest value not set: activity_code', out)
        self.assertEqual(code, 1)

    def test_a_bug_in_the_canary_is_a_failure_not_a_crash(self):
        with mock.patch.object(canary, 'call', side_effect=KeyError('boom')):
            code, out, _ = self.run_canary()
        self.assertEqual(code, 1)
        self.assertIn("canary error: KeyError", out)

    def test_single_tool_mode_runs_disabled_checks_without_alerts_or_state(self):
        self.backend.gts_status = 500
        code, out, _ = self.run_canary('--tool', 'gts')
        self.assertEqual(code, 1)
        self.assertIn('FAIL  gts', out)
        self.assertEqual(self.hook.bodies, [])
        self.assertFalse((self.tmp / 'logs' / 'canary' / 'state.json').exists())
        self.assertFalse((self.tmp / 'logs' / 'canary' / 'runs.jsonl').exists())
        code, _, err = self.run_canary('--tool', 'nope')
        self.assertEqual(code, 2)

    def test_the_shipped_manifest_is_valid_and_safe_by_default(self):
        data = json.loads(REAL_MANIFEST.read_text())
        names = [c['name'] for c in data['checks']]
        self.assertEqual(names, ['platform_health', 'platform_ready', 'database_lookup',
                                 'gts_device_tracking', 'reach', 'h2h'])
        for c in data['checks']:
            if c['name'] in ('gts_device_tracking', 'reach', 'h2h'):
                self.assertIs(c['enabled'], False, c['name'])
            self.assertTrue(c['path'].startswith('/'))
        # with the shipped manifest and no fixtures, only the three platform checks run
        code, out, _ = self.run_canary(manifest=data)
        self.assertEqual(code, 0, out)
        self.assertIn('3 passed, 0 failed, 3 skipped', out)


class Alerting(CanaryCase):
    def fail_health(self):
        self.backend.ready_status = 503
        self.backend.ready_body = {'status': 'not_ready', 'checks': [{'name': 'disk_free', 'ok': False, 'critical': True}]}

    def test_first_failure_is_sev2_with_the_expected_content(self):
        os.environ['PUBLIC_BASE_URL'] = 'http://localhost:3000'
        self.fail_health()
        code, out, _ = self.run_canary()
        self.assertEqual(code, 1)
        self.assertIn('alert posted', out)
        text = self.hook.bodies[0]['text']
        self.assertTrue(text.startswith('[SEV2] Canary failed: platform_ready'))
        self.assertIn('platform_ready: HTTP 503.', text)
        self.assertIn('Consecutive failed runs: 1', text)
        self.assertIn('http://localhost:3000', text)
        self.assertIn('Runbook: canary-failed', text)
        self.assertNotIn('secret-hook-token', out + text)

    def test_second_consecutive_failure_escalates_to_sev1_then_stays_quiet(self):
        self.fail_health()
        self.run_canary()
        self.run_canary()
        self.run_canary()
        self.assertEqual(len(self.hook.bodies), 2)
        self.assertTrue(self.hook.bodies[1]['text'].startswith('[SEV1]'))
        self.assertIn('Consecutive failed runs: 2', self.hook.bodies[1]['text'])

    def test_cooldown_expires_and_recovery_resets(self):
        self.fail_health()
        self.run_canary()
        state_file = self.tmp / 'logs' / 'canary' / 'state.json'
        state = json.loads(state_file.read_text())
        state['platform_ready']['last_alert_at'] = (datetime.now(timezone.utc) - timedelta(hours=7)).isoformat()
        state['platform_ready']['consecutive'] = 4
        state_file.write_text(json.dumps(state))
        self.run_canary()
        self.assertEqual(len(self.hook.bodies), 2)  # 7 h later: allowed again
        self.backend.ready_status, self.backend.ready_body = 200, {'status': 'ready', 'checks': []}
        self.run_canary()
        self.assertEqual(json.loads(state_file.read_text())['platform_ready']['consecutive'], 0)
        # A new failure right after recovery is a fresh first failure (counter restarts at 1) but it is
        # still inside the 6 h cooldown of the alert sent a moment ago, so a flapping check stays quiet.
        self.fail_health()
        self.run_canary()
        self.assertEqual(len(self.hook.bodies), 2)
        self.assertEqual(json.loads(state_file.read_text())['platform_ready']['consecutive'], 1)

    def test_no_alert_flag_and_missing_webhook(self):
        self.fail_health()
        code, out, _ = self.run_canary('--no-alert')
        self.assertEqual(self.hook.bodies, [])
        os.environ.pop('ALERT_WEBHOOK_URL')
        reset_state = self.tmp / 'logs' / 'canary' / 'state.json'
        reset_state.unlink(missing_ok=True)
        code, out, _ = self.run_canary()
        self.assertEqual(code, 1)
        self.assertIn('alert NOT posted', out)

    def test_run_history_is_logged(self):
        self.run_canary()
        line = (self.tmp / 'logs' / 'canary' / 'runs.jsonl').read_text().splitlines()[0]
        record = json.loads(line)
        self.assertEqual([r['name'] for r in record['results']][:3],
                         ['platform_health', 'platform_ready', 'database_lookup'])

    def test_webhook_formats(self):
        for fmt, check in (('discord', lambda b: self.assertIn('content', b)),
                           ('teams_workflow', lambda b: self.assertEqual(b['type'], 'message'))):
            with self.subTest(fmt):
                self.hook.bodies.clear()
                (self.tmp / 'logs' / 'canary' / 'state.json').unlink(missing_ok=True)
                os.environ['ALERT_WEBHOOK_FORMAT'] = fmt
                self.fail_health()
                self.run_canary()
                check(self.hook.bodies[0])


class Trimmer(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='trim-test-'))
        rows = []

        def add(team, day, n, hour=9, speed='0.2'):
            for i in range(n):
                rows.append({'IMEI': f'{team}-imei', 'Team Code': team, 'GPS Timestamp': f'10/{day:02d}/2026 {hour:02d}:{i % 60:02d}:00',
                             'Lat': '10.5', 'Lon': '8.5', 'Speed mps': speed, 'Track ID': f'{team}{day}{i}'})
        add('NG/KN1/AAA/NIPD/001', 5, 400)
        add('NG/KN1/AAA/NIPD/002', 5, 300)
        add('NG/KN1/BBB/NIPD/003', 5, 200)
        add('NG/KN1/BBB/NIPD/004', 5, 100)
        add('NG/KN1/AAA/NIPD/001', 6, 50)           # a quieter day
        add('NG/KN1/AAA/NIPD/001', 5, 500, hour=22)  # night rows the backend would drop
        add('NG/KN1/AAA/NIPD/001', 5, 500, speed='5')  # moving rows the backend would drop
        self.src = self.tmp / 'tracks.csv'
        pd.DataFrame(rows).to_csv(self.src, index=False)

    def run_tool(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = maker.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_tracks_keeps_busiest_day_top_teams_and_valid_rows_only(self):
        out_file = self.tmp / 'out' / 'tracks.csv'
        code, out, _ = self.run_tool('tracks', '--src', str(self.src), '--out', str(out_file), '--teams', '2',
                                     '--max-rows', '300')
        self.assertEqual(code, 0)
        result = pd.read_csv(out_file, dtype=str)
        self.assertEqual(set(result['Team Code']), {'NG/KN1/AAA/NIPD/001', 'NG/KN1/AAA/NIPD/002'})
        self.assertEqual(len(result), 300)
        self.assertTrue((result['GPS Timestamp'].str[:5] == '10/05').all())
        self.assertTrue((result['Speed mps'].astype(float) < 1).all())
        hours = pd.to_datetime(result['GPS Timestamp'], format='%m/%d/%Y %H:%M:%S').dt.hour
        self.assertTrue(hours.between(7, 16).all())
        self.assertIn('activity_code for the manifest: NIPD', out)
        self.assertEqual(list(result.columns), ['IMEI', 'Team Code', 'GPS Timestamp', 'Lat', 'Lon', 'Speed mps', 'Track ID'])

    def test_head_csv_and_xlsx(self):
        for name in ('dip.csv', 'dip.xlsx'):
            out_file = self.tmp / name
            code, _, _ = self.run_tool('head', '--src', str(self.src), '--out', str(out_file), '--max-rows', '25')
            self.assertEqual(code, 0)
            self.assertEqual(len(maker.read_table(out_file)), 25)

    def test_tracks_from_xlsx_source(self):
        xlsx = self.tmp / 'tracks.xlsx'
        pd.read_csv(self.src, dtype=str).head(3000).to_excel(xlsx, index=False)
        code, _, _ = self.run_tool('tracks', '--src', str(xlsx), '--out', str(self.tmp / 'o.csv'))
        self.assertEqual(code, 0)

    def test_errors_are_clear(self):
        code, _, err = self.run_tool('head', '--src', str(self.tmp / 'missing.csv'), '--out', str(self.tmp / 'o.csv'))
        self.assertEqual(code, 2)
        bad = self.tmp / 'x.csv'
        bad.write_text('a,b\n1,2\n')
        with self.assertRaises(SystemExit) as ctx:
            self.run_tool('tracks', '--src', str(bad), '--out', str(self.tmp / 'o.csv'))
        self.assertIn('team-code and a timestamp column', str(ctx.exception))

    def test_size_warning(self):
        big = self.tmp / 'big.csv'
        pd.DataFrame({'x': ['y' * 200] * 6000}).to_csv(big, index=False)
        code, _, err = self.run_tool('head', '--src', str(big), '--out', str(self.tmp / 'o.csv'), '--max-rows', '6000')
        self.assertEqual(code, 1)
        self.assertIn('larger than 1 MB', err)


if __name__ == '__main__':
    unittest.main()

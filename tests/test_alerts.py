"""Tests for the notifier (job_tracker/alerts.py). Run: python3 -m unittest tests.test_alerts -v"""
import io
import json
import os
import sys
import threading
import time
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

from tests import test_reliability as base  # sets up the throwaway DB and imports the package
from tests.test_reliability import add_job, finish, reset, rows, start, store
from toolbox.job_tracker import alerts, incidents

UTC = timezone.utc
ENV_KEYS = ['ALERT_WEBHOOK_URL', 'ALERT_WEBHOOK_FORMAT', 'ALERT_EMAIL_TO', 'ALERT_EMAIL_MIN_SEVERITY', 'SMTP_HOST',
            'ALERT_COOLDOWN_SCALE', 'PUBLIC_BASE_URL', 'ALERT_RUNBOOK_BASE_URL', 'STUCK_JOB_MINUTES',
            'STUCK_JOB_MINUTES_OVERRIDES', 'SLO_TARGET']


class Hook:
    """A local webhook endpoint that records what it receives."""

    def __init__(self, delay=0.0, status=200):
        self.bodies, outer = [], self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get('Content-Length', 0))
                outer.bodies.append(json.loads(self.rfile.read(length)))
                time.sleep(delay)
                self.send_response(status)
                self.end_headers()
                self.wfile.write(b'ok')

            def log_message(self, *a):
                pass

        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        self.url = f'http://127.0.0.1:{self.server.server_port}/secret-token-123'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def texts(self):
        return [b.get('text') or b.get('content') for b in self.bodies]

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class AlertTestCase(unittest.TestCase):
    def setUp(self):
        reset()
        with store.connect() as conn:
            conn.execute('DELETE FROM alerts_sent')
        for k in ENV_KEYS:
            os.environ.pop(k, None)
        alerts.RUN_INLINE = True
        self.hook = Hook()
        self.addCleanup(self.hook.close)
        os.environ['ALERT_WEBHOOK_URL'] = self.hook.url
        os.environ['PUBLIC_BASE_URL'] = 'http://localhost:3000'

    def tearDown(self):
        alerts.RUN_INLINE = False
        for k in ENV_KEYS:
            os.environ.pop(k, None)

    def fail(self, tool='reach', label='REACH', category='code_error', etype='ValueError', detail=None):
        jid = start(tool, label)
        store.finish_job(jid, 'failed', 500, 'err', error_category=category, error_type=etype, error_detail=detail)
        return jid

    def ok(self, tool='reach', label='REACH'):
        store.finish_job(start(tool, label), 'completed', 200)

    def sent_rules(self):
        return [r['rule'] for r in rows('SELECT rule FROM alerts_sent ORDER BY id')]


class A1_NewIncident(AlertTestCase):
    def test_no_channel_configured_does_nothing_and_does_not_raise(self):
        os.environ.pop('ALERT_WEBHOOK_URL')
        self.fail()
        self.assertEqual(rows('SELECT * FROM alerts_sent'), [])
        self.assertEqual(len(rows('SELECT * FROM incidents')), 1)

    def test_first_failure_sends_once_per_incident(self):
        self.fail()
        self.fail()
        self.assertEqual(self.sent_rules(), ['A1'])
        self.assertEqual(len(self.hook.bodies), 1)
        text = self.hook.texts()[0]
        self.assertTrue(text.startswith('[SEV3] New incident: REACH'))
        for expected in ('Tool: reach', 'Category: code_error | Type: ValueError', 'Failures: 1',
                         'http://localhost:3000', 'Runbook: high-failure-rate'):
            self.assertIn(expected, text)

    def test_a_new_incident_after_resolution_alerts_again(self):
        self.fail(); self.ok(); self.ok()
        self.fail()
        self.assertEqual(self.sent_rules().count('A1'), 2)

    def test_uncounted_failures_do_not_alert(self):
        self.fail(category='user_input', etype='HTTP 400')
        self.fail(category='data_contract', etype='missing_columns')
        self.assertEqual(self.hook.bodies, [])

    def test_runbook_follows_category_and_base_url(self):
        os.environ['ALERT_RUNBOOK_BASE_URL'] = 'https://wiki.example/runbooks/'
        self.fail(category='dependency', etype='OperationalError')
        self.assertIn('Runbook: postgis-unreachable (https://wiki.example/runbooks/postgis-unreachable.md)',
                      self.hook.texts()[0])

    def test_nothing_from_the_upload_or_the_webhook_secret_is_in_the_message(self):
        self.fail(detail='ValueError: row 12 of Kano_settlements.xlsx has phone 0803-SECRET-UPLOAD')
        text = self.hook.texts()[0]
        self.assertNotIn('SECRET-UPLOAD', text)
        self.assertNotIn('Kano_settlements', text)
        self.assertNotIn('secret-token-123', text)


class A2_RepeatedFailures(AlertTestCase):
    def test_three_in_an_hour_alerts_once_then_cooldown(self):
        self.fail(); self.fail()
        self.assertEqual(self.sent_rules(), ['A1'])
        self.fail()
        self.assertEqual(self.sent_rules(), ['A1', 'A2'])
        self.assertIn('[SEV2] Repeated failures: REACH', self.hook.texts()[1])
        self.assertIn('Failures: 3 in the last 60 minutes', self.hook.texts()[1])
        self.assertIn('Most common type: ValueError', self.hook.texts()[1])
        self.fail(); self.fail()
        self.assertEqual(self.sent_rules(), ['A1', 'A2'])  # inside the 2 h cooldown

    def test_old_failures_do_not_count(self):
        old = datetime.now(UTC) - timedelta(hours=3)
        for _ in range(3):
            add_job('reach', 'failed', 'code_error', started=old, ended=old)
        self.fail()
        self.assertEqual(self.sent_rules(), ['A1'])

    def test_other_tools_and_uncounted_failures_do_not_add_up(self):
        self.fail('reach'); self.fail('h2h', 'H2H'); self.fail('reach')
        self.fail('reach', category='user_input', etype='HTTP 400')
        self.assertNotIn('A2', self.sent_rules())

    def test_cooldown_scale_shortens_the_wait(self):
        os.environ['ALERT_COOLDOWN_SCALE'] = '0'
        for _ in range(3):
            self.fail()
        self.fail()
        self.assertEqual(self.sent_rules().count('A2'), 2)


class Resolved(AlertTestCase):
    def test_auto_resolve_posts_one_short_message(self):
        self.fail(); self.ok(); self.ok()
        self.assertEqual(self.sent_rules(), ['A1', 'RESOLVED'])
        text = self.hook.texts()[1]
        self.assertTrue(text.startswith('[SEV3] Resolved: REACH'))
        self.assertIn('Resolved after', text)
        self.assertIn('automatically', text)
        self.assertIn('Failures during the incident: 1', text)
        self.ok()
        self.assertEqual(self.sent_rules().count('RESOLVED'), 1)

    def test_manual_resolve_posts_once_and_names_who(self):
        self.fail()
        iid = rows('SELECT id FROM incidents')[0]['id']
        store.patch_incident(iid, {'status': 'acknowledged'})
        self.assertEqual(self.sent_rules(), ['A1'])
        store.patch_incident(iid, {'status': 'resolved', 'resolution': 'Fixed', 'resolved_by': 'Richard'})
        store.patch_incident(iid, {'status': 'resolved', 'resolution': 'Fixed, with a longer note'})
        self.assertEqual(self.sent_rules(), ['A1', 'RESOLVED'])
        self.assertIn('by Richard', self.hook.texts()[1])
        self.assertNotIn('Fixed', self.hook.texts()[1])  # free-text notes stay out of the channel


class A3_SuccessRate(AlertTestCase):
    def jobs(self, ok, bad):
        now = datetime.now(UTC) - timedelta(hours=1)
        for _ in range(ok):
            add_job(started=now)
        for _ in range(bad):
            add_job(status='failed', category='code_error', started=now, error_type='ValueError')

    def test_below_target_with_enough_jobs(self):
        self.jobs(17, 8)  # 68%
        self.assertEqual(alerts.run_periodic_checks(), ['A3'])
        text = self.hook.texts()[-1]
        self.assertIn('[SEV2] Success rate below target', text)
        self.assertIn('7-day success rate: 68.0% (target 95%)', text)
        self.assertIn('Most failures: reach (8)', text)
        self.assertEqual(alerts.run_periodic_checks(), [])  # 24 h cooldown

    def test_not_with_fewer_than_twenty_jobs(self):
        self.jobs(5, 10)
        self.assertEqual(alerts.run_periodic_checks(), [])

    def test_not_when_at_or_above_target(self):
        self.jobs(24, 1)  # 96%
        self.assertEqual(alerts.run_periodic_checks(), [])

    def test_uncounted_failures_do_not_trigger_it(self):
        self.jobs(20, 0)
        now = datetime.now(UTC)
        for _ in range(30):
            add_job(status='failed', category='user_input', started=now)
        self.assertEqual(alerts.run_periodic_checks(), [])

    def test_target_is_configurable(self):
        self.jobs(24, 1)
        os.environ['SLO_TARGET'] = '0.99'
        self.assertEqual(alerts.run_periodic_checks(), ['A3'])


class A4_StuckJobs(AlertTestCase):
    def active(self, tool, minutes_ago, label='REACH'):
        started = datetime.now(UTC) - timedelta(minutes=minutes_ago)
        with store.connect() as conn:
            conn.execute("INSERT INTO jobs (id,tool,label,method,path,status,started_at,stage) "
                         "VALUES (?,?,?,?,?,'active',?,?)",
                         (f'act-{tool}-{minutes_ago}', tool, label, 'POST', '/x', started.isoformat(),
                          'reading tracks'))

    def test_only_jobs_past_the_limit(self):
        self.active('reach', 10)
        self.active('h2h', 45, 'H2H')
        self.assertEqual(alerts.run_periodic_checks(), ['A4'])
        text = self.hook.texts()[-1]
        self.assertIn('[SEV2] Job may be stuck: H2H', text)
        self.assertIn('limit 30 min', text)
        self.assertIn('Last reported stage: reading tracks', text)
        self.assertIn('Runbook: job-stuck', text)

    def test_once_per_hour_per_job(self):
        self.active('h2h', 45, 'H2H')
        self.assertEqual(alerts.run_periodic_checks(), ['A4'])
        self.assertEqual(alerts.run_periodic_checks(), [])
        os.environ['ALERT_COOLDOWN_SCALE'] = '0'
        self.assertEqual(alerts.run_periodic_checks(), ['A4'])

    def test_limits_and_per_tool_overrides(self):
        self.active('reach', 45)
        os.environ['STUCK_JOB_MINUTES_OVERRIDES'] = 'reach=60, h2h=5'
        self.assertEqual(alerts.run_periodic_checks(), [])
        os.environ['STUCK_JOB_MINUTES'] = '10'
        self.active('other', 15, 'OTHER')
        self.assertEqual(alerts.run_periodic_checks(), ['A4'])


class A7_Unacknowledged(AlertTestCase):
    def incident(self, hours_ago, status='open'):
        opened = datetime.now(UTC) - timedelta(hours=hours_ago)
        with store.connect() as conn:
            conn.execute("INSERT INTO incidents (id,tool,title,status,error_category,opened_at,failure_count) "
                         "VALUES (?,?,?,?,?,?,4)", (f'inc-{hours_ago}-{status}', 'reach', 'REACH: ValueError',
                                                      status, 'code_error', opened.isoformat()))

    def test_reminder_for_old_unacknowledged_only(self):
        self.incident(30)
        self.incident(30, 'acknowledged')
        self.incident(2)
        self.assertEqual(alerts.run_periodic_checks(), ['A7'])
        text = self.hook.texts()[-1]
        self.assertIn('[REMINDER] Still open: REACH: ValueError', text)
        self.assertIn('Open for 1 d 6 h and not acknowledged', text)
        self.assertEqual(alerts.run_periodic_checks(), [])


class Delivery(AlertTestCase):
    def test_webhook_formats(self):
        for fmt, check in (
            ('text', lambda b: self.assertIn('[SEV3]', b['text'])),
            ('discord', lambda b: self.assertIn('[SEV3]', b['content'])),
            ('teams_workflow', lambda b: (
                self.assertEqual(b['type'], 'message'),
                self.assertEqual(b['attachments'][0]['contentType'], 'application/vnd.microsoft.card.adaptive'),
                self.assertIn('[SEV3]', b['attachments'][0]['content']['body'][0]['text']),
                self.assertGreater(len(b['attachments'][0]['content']['body']), 3))),
        ):
            with self.subTest(fmt):
                self.hook.bodies.clear()
                reset()
                with store.connect() as conn:
                    conn.execute('DELETE FROM alerts_sent')
                os.environ['ALERT_WEBHOOK_FORMAT'] = fmt
                self.fail()
                self.assertEqual(len(self.hook.bodies), 1)
                check(self.hook.bodies[0])

    def test_failed_delivery_is_swallowed_logged_without_the_url_and_retried_later(self):
        os.environ['ALERT_WEBHOOK_URL'] = 'http://127.0.0.1:1/secret-token-999'  # nothing listens here
        with self.assertLogs('toolbox.job_tracker.alerts', level='WARNING') as logs:
            self.fail()
        self.assertTrue(any('delivery failed' in line for line in logs.output))
        self.assertFalse(any('secret-token-999' in line for line in logs.output))
        self.assertEqual(rows('SELECT * FROM alerts_sent'), [])  # claim released
        os.environ['ALERT_WEBHOOK_URL'] = self.hook.url
        self.fail()  # extends the incident; A1 is not re-evaluated, but the periodic path would retry
        self.assertEqual(len(rows('SELECT * FROM incidents')), 1)

    def test_a_hung_webhook_gives_up_after_the_timeout(self):
        slow = Hook(delay=6)
        self.addCleanup(slow.close)
        os.environ['ALERT_WEBHOOK_URL'] = slow.url
        began = time.monotonic()
        self.fail()
        self.assertLess(time.monotonic() - began, 5.5)
        self.assertEqual(rows('SELECT * FROM alerts_sent'), [])

    def test_a_webhook_error_status_counts_as_failure(self):
        bad = Hook(status=500)
        self.addCleanup(bad.close)
        os.environ['ALERT_WEBHOOK_URL'] = bad.url
        with self.assertLogs('toolbox.job_tracker.alerts', level='WARNING'):
            self.fail()
        self.assertEqual(rows('SELECT * FROM alerts_sent'), [])

    def test_email_severity_gate(self):
        os.environ.update(ALERT_EMAIL_TO='a@x.org, b@x.org', SMTP_HOST='smtp.example')
        os.environ.pop('ALERT_WEBHOOK_URL')
        with mock.patch.object(alerts, '_send_email') as send:
            self.assertEqual(alerts.deliver('sev3', 's', 't'), {})            # below sev2 default
            self.assertEqual(alerts.deliver('sev2', 's', 't'), {'email': (True, 'sent')})
            self.assertEqual(alerts.deliver('sev1', 's', 't'), {'email': (True, 'sent')})
            self.assertEqual(alerts.deliver('reminder', 's', 't'), {'email': (True, 'sent')})
            os.environ['ALERT_EMAIL_MIN_SEVERITY'] = 'sev3'
            self.assertEqual(alerts.deliver('sev3', 's', 't'), {'email': (True, 'sent')})
            os.environ['ALERT_EMAIL_MIN_SEVERITY'] = 'sev1'
            self.assertEqual(alerts.deliver('sev2', 's', 't'), {})
        self.assertEqual(send.call_count, 4)

    def test_email_message_and_smtp_conversation(self):
        os.environ.update(ALERT_EMAIL_TO='a@x.org, b@x.org', SMTP_HOST='smtp.example', SMTP_PORT='587',
                          SMTP_USER='bot', SMTP_PASSWORD='pw', SMTP_FROM='toolbox@x.org')
        with mock.patch('smtplib.SMTP') as smtp:
            server = smtp.return_value
            server.__enter__.return_value = server
            alerts._send_email('[SEV2] Subject', 'body text')
        smtp.assert_called_once_with('smtp.example', 587, timeout=3)
        server.starttls.assert_called_once()
        server.login.assert_called_once_with('bot', 'pw')
        message = server.send_message.call_args[0][0]
        self.assertEqual(message['To'], 'a@x.org, b@x.org')
        self.assertEqual(message['From'], 'toolbox@x.org')
        self.assertEqual(message['Subject'], '[SDA Toolbox] [SEV2] Subject')
        self.assertIn('body text', message.get_content())

    def test_both_channels_and_failing_email_does_not_block_webhook(self):
        os.environ.update(ALERT_EMAIL_TO='a@x.org', SMTP_HOST='smtp.example', ALERT_EMAIL_MIN_SEVERITY='sev3')
        with mock.patch.object(alerts, '_send_email', side_effect=OSError('mail server down')):
            results = alerts.deliver('sev3', 's', 't')
        self.assertEqual(results['webhook'], (True, 'sent'))
        self.assertFalse(results['email'][0])

    def test_concurrent_senders_cannot_double_send(self):
        threads = [threading.Thread(target=alerts.send_alert,
                                    args=('A2', 'sev2', 'reach', 'Subject', ['d']),
                                    kwargs={'key': 'same'}) for _ in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(rows("SELECT * FROM alerts_sent WHERE rule = 'A2'")), 1)
        self.assertEqual(len(self.hook.bodies), 1)

    def test_background_send_does_not_block_the_caller(self):
        alerts.RUN_INLINE = False
        slow = Hook(delay=1.0)
        self.addCleanup(slow.close)
        os.environ['ALERT_WEBHOOK_URL'] = slow.url
        began = time.monotonic()
        self.fail()
        self.assertLess(time.monotonic() - began, 0.5)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not rows('SELECT channels FROM alerts_sent WHERE channels != ""'):
            time.sleep(0.05)
        self.assertEqual(rows('SELECT channels FROM alerts_sent')[0]['channels'], 'webhook')

    def test_old_rows_are_pruned(self):
        old = (datetime.now(UTC) - timedelta(days=45)).isoformat()
        with store.connect() as conn:
            conn.execute("INSERT INTO alerts_sent (rule,tool,key,severity,sent_at,channels) "
                         "VALUES ('A2','x','', 'sev2', ?, 'webhook')", (old,))
        alerts.run_periodic_checks()
        self.assertEqual(rows('SELECT * FROM alerts_sent'), [])

    def test_send_alert_is_the_entry_point_for_the_canary(self):
        self.assertTrue(alerts.send_alert('A5', 'sev1', 'reach', 'Canary failed: REACH', ['Tool: reach'], key=''))
        self.assertFalse(alerts.send_alert('A5', 'sev1', 'reach', 'Canary failed: REACH', ['Tool: reach'], key=''))
        self.assertEqual(self.sent_rules(), ['A5'])


class Cli(AlertTestCase):
    def run_cli(self, *argv):
        out = io.StringIO()
        with mock.patch.object(sys, 'argv', ['alerts', *argv]), redirect_stdout(out):
            code = alerts._cli()
        return code, out.getvalue()

    def test_status_and_test_send(self):
        code, out = self.run_cli()
        self.assertEqual(code, 0)
        self.assertIn('webhook configured: True', out)
        self.assertNotIn('secret-token-123', out)
        code, out = self.run_cli('--test')
        self.assertEqual(code, 0)
        self.assertIn('webhook: OK', out)
        self.assertIn('Test alert from SDA Toolbox', self.hook.texts()[0])
        self.assertEqual(rows('SELECT * FROM alerts_sent'), [])  # a test is not recorded

    def test_nothing_configured(self):
        os.environ.pop('ALERT_WEBHOOK_URL')
        code, out = self.run_cli('--test')
        self.assertEqual(code, 1)
        self.assertIn('Nothing to test', out)


class Lifecycle(AlertTestCase):
    def test_background_checker_runs_and_stops(self):
        calls = []
        with mock.patch.object(alerts, 'run_periodic_checks', side_effect=lambda: calls.append(1) or []):
            checker = alerts.BackgroundChecker(interval=0.05, first_delay=0.05).start()
            time.sleep(0.4)
            checker.stop()
            checker._thread.join(1)
        self.assertGreaterEqual(len(calls), 2)
        self.assertFalse(checker._thread.is_alive())
        self.assertTrue(checker._thread.daemon)

    def test_a_failing_check_does_not_kill_the_pass(self):
        def boom(now):
            raise RuntimeError('boom')
        with mock.patch.object(alerts, '_check_success_rate', new=boom):
            with self.assertLogs('toolbox.job_tracker.alerts', level='ERROR'):
                alerts.run_periodic_checks()

    def test_lifespan_starts_and_stops_the_checker(self):
        import asyncio

        async def run():
            async with alerts.lifespan(None):
                pass
        with mock.patch.object(alerts, 'BackgroundChecker') as cls:
            asyncio.run(run())
        cls.return_value.start.return_value.stop.assert_called_once()

    def test_alert_bookkeeping_errors_never_reach_finish_job(self):
        with mock.patch.object(alerts, 'send_alert', side_effect=RuntimeError('boom')):
            self.fail()  # must not raise
        self.assertEqual(rows('SELECT status FROM jobs')[0]['status'], 'failed')


if __name__ == '__main__':
    unittest.main()

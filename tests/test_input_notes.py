"""Malformed track rows that the tolerant CSV read drops must be reported, not silent.

Found with the real GTS file: Tracks_32.csv had 105 rows whose team code held stray commas
(`BO- ASU - WAG,- SNIDs - 075`), so they had more fields than the header and the fallback reader
skipped them. The tool's result was built on fewer rows than the user uploaded and nothing said so.

The chain tested here:
  reader drops rows -> toolbox.input_notes records a note for the request
  -> dataops Report turns it into a warning -> X-Data-Warning header -> middleware saves it on the job.

Run from the repo root:  python -m unittest tests.test_input_notes -v
"""
import asyncio
import io
import os
import tempfile
import unittest
from unittest import mock

import pandas as pd
from starlette.concurrency import run_in_threadpool
from starlette.responses import PlainTextResponse

from tests import test_reliability as base  # noqa: F401  (throwaway DB, puts the package on sys.path)
from tests.test_reliability import asgi_call, latest_job, make_app, store
from tests.test_h7_readers import readers, Upload, csv_upload, FRAME

from toolbox import input_notes
from toolbox.dataops.checks import Finding, Report, WARNING_HEADER, skipped_rows_finding, SKIPPED_ROWS_CODE

HEADER = 'IMEI,Team Code,Lat\n'
GOOD = '111,KN-ABC-DEF1-CMP-001,12.1\n'
# The real shape of the problem: a team code with a stray comma gives four fields for a three-field header.
BAD = '222,BO- ASU - WAG,- SNIDs - 075,12.2\n'


def csv_bytes(*lines):
    return ''.join(lines).encode()


class ScanCsv(unittest.TestCase):
    def test_counts_rows_and_overlong_rows_and_names_the_lines(self):
        data = csv_bytes(HEADER, GOOD, BAD, GOOD, BAD, GOOD)
        self.assertEqual(input_notes.scan_csv(io.BytesIO(data)), (5, 2, [3, 5]))

    def test_a_clean_file_has_no_overlong_rows(self):
        self.assertEqual(input_notes.scan_csv(io.BytesIO(csv_bytes(HEADER, GOOD, GOOD))), (2, 0, []))

    def test_blank_lines_are_not_rows(self):
        data = csv_bytes(HEADER, '\n', GOOD, '\r\n', BAD, '\n')
        self.assertEqual(input_notes.scan_csv(io.BytesIO(data)), (2, 1, [5]))

    def test_a_byte_order_mark_does_not_change_the_header(self):
        data = b'\xef\xbb\xbf' + csv_bytes(HEADER, GOOD, BAD)
        self.assertEqual(input_notes.scan_csv(io.BytesIO(data)), (2, 1, [3]))

    def test_a_quoted_field_with_a_newline_is_one_row(self):
        data = csv_bytes(HEADER, '333,"two\nlines",12.3\n', GOOD)
        self.assertEqual(input_notes.scan_csv(io.BytesIO(data)), (2, 0, []))

    def test_only_the_first_few_line_numbers_are_kept(self):
        data = csv_bytes(HEADER, *([BAD] * 10))
        rows, overlong, lines = input_notes.scan_csv(io.BytesIO(data))
        self.assertEqual((rows, overlong), (10, 10))
        self.assertEqual(lines, [2, 3, 4])

    def test_the_buffer_is_left_open_and_rewound(self):
        buffer = io.BytesIO(csv_bytes(HEADER, GOOD))
        input_notes.scan_csv(buffer)
        self.assertFalse(buffer.closed)
        self.assertEqual(buffer.tell(), 0)
        self.assertEqual(buffer.read(), csv_bytes(HEADER, GOOD))

    def test_a_path_is_scanned_too(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'tracks.csv')
            with open(path, 'wb') as handle:
                handle.write(csv_bytes(HEADER, GOOD, BAD))
            self.assertEqual(input_notes.scan_csv(path), (2, 1, [3]))

    def test_a_file_that_cannot_be_read_gives_zeros_and_never_raises(self):
        self.assertEqual(input_notes.scan_csv('/definitely/not/here.csv'), (0, 0, []))
        self.assertEqual(input_notes.scan_csv(io.BytesIO(b'')), (0, 0, []))


class Notes(unittest.TestCase):
    def test_outside_a_request_a_note_is_only_logged(self):
        input_notes.note_skipped_rows('a.csv', 3, [2])
        self.assertEqual(input_notes.notes(), [])

    def test_inside_a_request_notes_are_kept_and_the_end_clears_them(self):
        token = input_notes.begin()
        input_notes.note_skipped_rows('a.csv', 3, [2, 9, 11, 40])
        self.assertEqual(input_notes.notes(), [{'kind': 'skipped_rows', 'source': 'a.csv', 'skipped': 3,
                                                'lines': [2, 9, 11]}])
        input_notes.end(token)
        self.assertEqual(input_notes.notes(), [])

    def test_a_note_written_from_a_worker_thread_reaches_the_request(self):
        async def request():
            token = input_notes.begin()
            try:
                await run_in_threadpool(input_notes.note_skipped_rows, 'threaded.csv', 1, [5])
                return input_notes.notes()
            finally:
                input_notes.end(token)

        self.assertEqual([n['source'] for n in asyncio.run(request())], ['threaded.csv'])

    def test_requests_do_not_see_each_others_notes(self):
        async def request(name, later):
            token = input_notes.begin()
            try:
                await asyncio.sleep(later)
                input_notes.note_skipped_rows(name, 1, [2])
                await asyncio.sleep(0.02)
                return [n['source'] for n in input_notes.notes()]
            finally:
                input_notes.end(token)

        async def both():
            return await asyncio.gather(request('one.csv', 0.0), request('two.csv', 0.01))

        self.assertEqual(asyncio.run(both()), [['one.csv'], ['two.csv']])

    def test_display_name_never_shows_a_folder(self):
        self.assertEqual(input_notes.display_name(Upload('Tracks_32.csv', b'')), 'Tracks_32.csv')
        self.assertEqual(input_notes.display_name('C:\\data\\day1\\tracks.csv'), 'tracks.csv')
        self.assertEqual(input_notes.display_name('/tmp/x/tracks.csv'), 'tracks.csv')

    def test_report_skipped_rows_compares_the_file_with_what_was_kept(self):
        token = input_notes.begin()
        try:
            data = io.BytesIO(csv_bytes(HEADER, GOOD, BAD, GOOD, BAD))
            self.assertEqual(input_notes.report_skipped_rows(data, 2, 'Tracks_32.csv'), 2)
            self.assertEqual(input_notes.notes()[0]['skipped'], 2)
            self.assertEqual(input_notes.notes()[0]['lines'], [3, 5])
            # Nothing dropped, nothing noted.
            self.assertEqual(input_notes.report_skipped_rows(io.BytesIO(csv_bytes(HEADER, GOOD)), 1, 'ok.csv'), 0)
            self.assertEqual(len(input_notes.notes()), 1)
        finally:
            input_notes.end(token)


class ReaderNotesTheRowsItDrops(unittest.TestCase):
    def read(self, upload, **kwargs):
        return asyncio.run(readers.ReadTableData(upload, False).read_data(**kwargs))

    def test_the_fallback_reports_each_skipped_row_with_the_file_name(self):
        upload = Upload('Tracks_32.csv', csv_bytes(HEADER, GOOD, BAD, GOOD, BAD, BAD))

        async def request():
            token = input_notes.begin()
            try:
                data = await readers.ReadTableData(upload, False).read_data()
                return data, input_notes.notes()
            finally:
                input_notes.end(token)

        data, notes = asyncio.run(request())
        self.assertEqual(data['IMEI'].tolist(), [111, 111])  # the good rows are still read
        self.assertEqual(len(notes), 1)
        self.assertEqual((notes[0]['source'], notes[0]['skipped'], notes[0]['lines']), ('Tracks_32.csv', 3, [3, 5, 6]))

    def test_a_clean_file_adds_no_note(self):
        async def request():
            token = input_notes.begin()
            try:
                await readers.ReadTableData(csv_upload(), False).read_data()
                return input_notes.notes()
            finally:
                input_notes.end(token)

        self.assertEqual(asyncio.run(request()), [])

    def test_a_path_on_disk_is_noted_by_its_file_name(self):
        async def request(path):
            token = input_notes.begin()
            try:
                await readers.ReadTableData(path, False).read_data()
                return input_notes.notes()
            finally:
                input_notes.end(token)

        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'day_two.csv')
            with open(path, 'wb') as handle:
                handle.write(csv_bytes(HEADER, GOOD, BAD))
            notes = asyncio.run(request(path))
        self.assertEqual([(n['source'], n['skipped']) for n in notes], [('day_two.csv', 1)])

    def test_the_rows_are_still_skipped_as_before(self):
        # The warning is added; what the tool receives is unchanged.
        data = self.read(Upload('ragged.csv', b'a,b\n1,2\n3,4,5\n6,7\n'))
        self.assertEqual(data['a'].tolist(), [1, 6])


class ReportTurnsNotesIntoWarnings(unittest.TestCase):
    def setUp(self):
        self.token = input_notes.begin()
        self.addCleanup(input_notes.end, self.token)

    def test_no_notes_means_no_warning(self):
        report = Report('gts_device_tracking')
        self.assertEqual(report.warnings, [])
        self.assertEqual(report.headers(), {})

    def test_one_file_names_the_file_the_count_and_the_first_line(self):
        input_notes.note_skipped_rows('Tracks_32.csv', 105, [2043, 2100])
        finding = Report('t').warnings[0]
        self.assertEqual(finding.code, SKIPPED_ROWS_CODE)
        self.assertFalse(finding.fatal)
        self.assertEqual(
            finding.message,
            "105 malformed rows in 'Tracks_32.csv' had more fields than the header and were skipped (first at line 2043).")

    def test_one_row_reads_in_the_singular(self):
        input_notes.note_skipped_rows('a.csv', 1, [7])
        self.assertEqual(
            Report('t').warnings[0].message,
            "1 malformed row in 'a.csv' had more fields than the header and was skipped (first at line 7).")

    def test_many_files_are_one_warning(self):
        input_notes.note_skipped_rows('a.csv', 2, [4])
        input_notes.note_skipped_rows('b.csv', 3, [9])
        warnings = Report('t').warnings
        self.assertEqual(len(warnings), 1)
        self.assertEqual(
            warnings[0].message,
            "5 malformed rows across 2 files had more fields than the header and were skipped (first in 'a.csv', line 4).")
        self.assertEqual(len(warnings[0].details['files']), 2)

    def test_a_report_made_before_the_files_were_read_still_gets_the_warning(self):
        report = Report('h2h')  # the H2H route makes its Report first
        input_notes.note_skipped_rows('tracks.csv', 4, [12])
        self.assertIn(SKIPPED_ROWS_CODE, report.headers()[WARNING_HEADER])

    def test_asking_twice_does_not_repeat_it(self):
        input_notes.note_skipped_rows('tracks.csv', 4, [12])
        report = Report('t')
        report.headers()
        report.log()
        header = report.headers()[WARNING_HEADER]
        self.assertEqual(header.count(SKIPPED_ROWS_CODE), 1)
        self.assertEqual(len([f for f in report.findings if f.code == SKIPPED_ROWS_CODE]), 1)

    def test_it_sits_beside_the_tools_own_warnings_and_never_makes_a_run_fail(self):
        input_notes.note_skipped_rows('tracks.csv', 4, [12])
        report = Report('t').add(Finding('missing_team_codes', '12% of tracks have no Team Code.'))
        report.raise_if_fatal()  # a warning, so it does not raise
        header = report.headers()[WARNING_HEADER]
        self.assertIn('missing_team_codes', header)
        self.assertIn(SKIPPED_ROWS_CODE, header)

    def test_the_row_contents_are_never_quoted(self):
        input_notes.note_skipped_rows('tracks.csv', 4, [12])
        header = Report('t').headers()[WARNING_HEADER]
        self.assertNotIn('SNIDs', header)

    def test_skipped_rows_finding_ignores_other_kinds_and_zero_counts(self):
        self.assertIsNone(skipped_rows_finding([{'kind': 'something_else', 'skipped': 5}]))
        self.assertIsNone(skipped_rows_finding([{'kind': 'skipped_rows', 'source': 'a.csv', 'skipped': 0, 'lines': []}]))


class WholeRequest(unittest.TestCase):
    """Through the real job-tracking middleware: upload with bad rows -> data_warning on the job."""

    def run_app(self, handler):
        return asyncio.run(asgi_call(make_app(handler)))

    def test_a_tracks_file_with_bad_rows_leaves_a_warning_on_the_job(self):
        upload = Upload('Tracks_32.csv', csv_bytes(HEADER, GOOD, BAD, GOOD, BAD))

        async def handler(request):
            report = Report('gts_device_tracking')
            await readers.ReadTableData(upload, False).read_data()
            return PlainTextResponse('csv', headers=report.headers())

        sent, raised = self.run_app(handler)
        self.assertIsNone(raised)
        header = dict(sent[0]['headers'])[b'x-data-warning'].decode()
        self.assertIn("2 malformed rows in 'Tracks_32.csv'", header)
        job = latest_job()
        self.assertEqual(job['status'], 'completed')  # a warning, not a failure
        self.assertIn(SKIPPED_ROWS_CODE, job['data_warning'])

    def test_the_next_request_starts_clean(self):
        async def dirty(request):
            input_notes.note_skipped_rows('old.csv', 9, [3])
            return PlainTextResponse('csv', headers=Report('t').headers())

        async def clean(request):
            return PlainTextResponse('csv', headers=Report('t').headers())

        self.run_app(dirty)
        self.assertIn(SKIPPED_ROWS_CODE, latest_job()['data_warning'])
        self.run_app(clean)
        self.assertIsNone(latest_job()['data_warning'])
        self.assertEqual(input_notes.notes(), [])  # and nothing leaks outside the request


if __name__ == '__main__':
    unittest.main()

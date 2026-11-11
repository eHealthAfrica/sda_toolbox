"""Guard: no route may leave a result file behind on disk.

Before this check, 30 routes wrote their download with ``NamedTemporaryFile(delete=False)`` and never
deleted it, so the server's temp folder grew with every run. Results are now written through
``toolbox.utils.tempfiles`` (``file_response`` or ``new_result_file`` + ``delete_after_response``),
which removes the file once it has been sent. This test reads the route code and fails if someone
goes back to the old pattern.

Run from the repo root:  python -m unittest tests.test_no_leftover_result_files -v
"""
import ast
import os
import unittest
from pathlib import Path

from tests import test_reliability  # noqa: F401  (puts the package on sys.path)

PACKAGE = Path(os.environ.get('TOOLBOX_SRC_DIR', Path(__file__).resolve().parents[1] / 'src' / 'toolbox'))
ROUTES = PACKAGE / 'apps'


def route_files():
    return sorted(path for path in ROUTES.rglob('*.py') if '__pycache__' not in path.parts)


def call_name(node: ast.Call) -> str:
    func = node.func
    return func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else ''


class NoLeftoverResultFiles(unittest.TestCase):
    def test_routes_were_found(self):
        self.assertTrue(route_files(), f'no route files under {ROUTES}')

    def test_no_route_creates_an_undeleted_temp_file(self):
        offenders = []
        for path in route_files():
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
                if not isinstance(node, ast.Call):
                    continue
                name = call_name(node)
                keywords = {kw.arg: kw.value for kw in node.keywords}
                kept = keywords.get('delete')
                if name == 'NamedTemporaryFile' and isinstance(kept, ast.Constant) and kept.value is False:
                    offenders.append(f'{path.relative_to(ROUTES)}:{node.lineno} NamedTemporaryFile(delete=False)')
                if name in ('mkstemp', 'mktemp'):
                    offenders.append(f'{path.relative_to(ROUTES)}:{node.lineno} {name}()')
        self.assertEqual(offenders, [], 'use toolbox.utils.tempfiles.file_response instead:\n' + '\n'.join(offenders))

    def test_every_file_response_deletes_its_file(self):
        offenders = []
        for path in route_files():
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
                if isinstance(node, ast.Call) and call_name(node) == 'FileResponse':
                    if 'background' not in {kw.arg for kw in node.keywords}:
                        offenders.append(f'{path.relative_to(ROUTES)}:{node.lineno}')
        self.assertEqual(offenders, [], 'FileResponse without background=delete_after_response(...):\n' + '\n'.join(offenders))


if __name__ == '__main__':
    unittest.main()

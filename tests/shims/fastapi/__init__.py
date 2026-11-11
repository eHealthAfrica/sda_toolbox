"""Test-only stand-in for FastAPI (the sandbox cannot install it). Provides just enough of
APIRouter / Query / HTTPException for toolbox.job_tracker.router to import and for its
route functions to be called directly. NOT part of the repo."""
from starlette.exceptions import HTTPException  # same class FastAPI re-exports


def Query(default=None, **kwargs):
    return default


class APIRouter:
    def __init__(self):
        self.routes = []

    def _register(self, method, path, **kw):
        def deco(fn):
            self.routes.append((method, path, fn, kw))
            return fn
        return deco

    def get(self, path, **kw):
        return self._register('GET', path, **kw)

    def patch(self, path, **kw):
        return self._register('PATCH', path, **kw)

    def post(self, path, **kw):
        return self._register('POST', path, **kw)

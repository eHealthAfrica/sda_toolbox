import os

import uvicorn
from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from toolbox import SUMMARY, DESC
from toolbox.job_tracker import JobLoggingMiddleware
from toolbox.exceptions import ToolBoxExceptions
from toolbox.apps import (
    dip,
    dmp,
    jobs,
    fixer,
    tracks,
    qc_mlos,
    lga_data,
    checkout,
    splitter,
    timespent,
    target_area,
    standardizer,
    dip_template,
    uuid_checker,
    coord_review,
    reach_analysis,
    h2h_validation,
    contact_analysis,
    update_validation,
    duplicate_checker,
    hitnrun_validation,
    submission_reviewer,
    campaign_day_reporting,
    post_implementation_report
)


app = FastAPI(title='SDA Toolbox', summary=SUMMARY, description=DESC, version='0.4')

# CORS: added alongside src/frontend (a separate-origin Vite dev server that
# calls this API directly from the browser). Without this, every request
# from the frontend is blocked by the browser before it reaches FastAPI.
# Configurable via CORS_ALLOW_ORIGINS (comma-separated) so a deployed
# frontend's real origin can be added later without another code change;
# defaults cover Vite's default dev (5173) and preview (4173) ports, plus
# 3000 — the port the dockerized frontend (src/frontend/Dockerfile, served
# by nginx) is published on in docker-compose.yml — so a plain
# `docker compose up` works CORS-wise without also having to set this.
_DEFAULT_CORS_ORIGINS = (
    'http://localhost:5173,http://127.0.0.1:5173,'
    'http://localhost:4173,http://127.0.0.1:4173,'
    'http://localhost:3000,http://127.0.0.1:3000'
)
_cors_origins = [
    origin.strip()
    for origin in os.environ.get('CORS_ALLOW_ORIGINS', _DEFAULT_CORS_ORIGINS).split(',')
    if origin.strip()
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
    # 'allow_headers' only covers REQUEST headers the browser is permitted to
    # send; it does nothing for RESPONSE headers the frontend's JS wants to
    # read back off `fetch()`. Per the CORS spec, only a small "simple
    # response header" allowlist (Content-Type, Content-Length, etc.) is
    # readable cross-origin unless the server explicitly exposes more via
    # Access-Control-Expose-Headers — this is that. Without it,
    # `response.headers.get('X-Job-Id')` in the frontend's submitH2HTracking
    # (src/api/client.ts) would silently always return null, even though the
    # header is genuinely present on the wire.
    expose_headers=['X-Job-Id'],
)

# Automatically records a row (id, tool, status, timing) into a small
# SQLite job-history store for every request that hits a known tool
# endpoint — see toolbox/job_tracker/middleware.py for the full endpoint
# map and toolbox/job_tracker/store.py for the schema. This is what backs
# GET /jobs/summary below and, in turn, the frontend Dashboard's
# Active/Completed/Failed counts — replacing a React-only tracker that
# reset on every page reload and was invisible to any other user of this
# shared instance. Added after CORSMiddleware, which — because
# app.add_middleware() prepends to Starlette's middleware list — makes
# this the outermost of the two; the ordering between them doesn't matter
# for what this actually does (it never touches CORS headers), so this is
# just "wherever is simplest to read", not a load-bearing choice.
app.add_middleware(JobLoggingMiddleware)

# MLoS Endpoints
app.include_router(fixer.router)
app.include_router(qc_mlos.router)
app.include_router(coord_review.router)
app.include_router(standardizer.router)
app.include_router(h2h_validation.router)
app.include_router(duplicate_checker.router)
app.include_router(update_validation.router)

# DB Access
app.include_router(uuid_checker.router)

# Settlement Tracking Endpoints
# app.include_router(hitnrun_validation.router)
app.include_router(h2h_validation.router)
app.include_router(reach_analysis.router)

# Compiler Endpoints
app.include_router(tracks.router)
app.include_router(lga_data.router)
app.include_router(splitter.router)

# Microplan Endpoints
app.include_router(dmp.router)
app.include_router(dip.router)
app.include_router(checkout.router)
app.include_router(dip_template.router)

# Reporting Endpoints
app.include_router(post_implementation_report.router)
app.include_router(campaign_day_reporting.router)
app.include_router(timespent.router)

# Campaign Endpoints
app.include_router(contact_analysis.router)
app.include_router(submission_reviewer.router)
app.include_router(target_area.router)

# Job Tracking (Dashboard job-history API — see JobLoggingMiddleware above)
app.include_router(jobs.router)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content=jsonable_encoder(
            {
                'detail': exc.errors(),
                'issue': exc.args
            }
        ),
    )


@app.exception_handler(ToolBoxExceptions)
async def api_exception_handler(_, exc: ToolBoxExceptions):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            'msg': exc.msg,
            'detail': exc.details,
            'status_code': exc.status_code
        },
        headers={'error': exc.msg}
    )


# if __name__ == '__main__':
#     import logging
#     # Imported here rather than at module level: pyngrok is a dev-only tool
#     # (declared in pyproject.toml's [dependency-groups.dev], not the main
#     # dependency list) used only for this local public-tunnel workflow. A
#     # top-level import would force every real deployment — anything that
#     # imports `toolbox.sda_toolbox:app` to run under uvicorn/gunicorn, e.g.
#     # in Docker — to also install pyngrok just to satisfy the import, even
#     # though this __main__ block never runs there.
#     from pyngrok import ngrok
#     PORT = 5000
#     public_url = ngrok.connect(PORT)
#     print(f"Public URL: {public_url}")
#     uvicorn.run(
#         'sda_toolbox:app',
#         port=PORT,
#         log_level='info',
#         reload=True
#     )

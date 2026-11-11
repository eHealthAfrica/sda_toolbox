import os

import uvicorn
from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from toolbox import SUMMARY, DESC
from toolbox.job_tracker import JobLoggingMiddleware
from toolbox.job_tracker.alerts import lifespan
from toolbox.exceptions import ToolBoxExceptions
from toolbox.utils.upload_limit import UploadSizeLimitMiddleware
from toolbox.errors import DataContractError, data_contract_error_handler, category_headers
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
    tracks_analysis,
    contact_analysis,
    update_validation,
    duplicate_checker,
    hitnrun_validation,
    submission_reviewer,
    campaign_day_reporting,
    post_implementation_report
)


# `lifespan` starts the notifier's background checker with the app and stops it
# on shutdown (toolbox/job_tracker/alerts.py).
app = FastAPI(title='SDA Toolbox', summary=SUMMARY, description=DESC, version='0.4', lifespan=lifespan)

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


# Upload size check (toolbox/utils/upload_limit.py). It is OFF unless UPLOAD_LIMIT_ENABLED=1; when on, an
# upload over MAX_UPLOAD_MB (default 200) gets a readable HTTP 413 before the route reads it.
# Added FIRST so it is the innermost layer: the 413 then
# still passes through CORSMiddleware (the browser can read it) and JobLoggingMiddleware (it is
# recorded as a user_input failure, not a crash).
app.add_middleware(UploadSizeLimitMiddleware)

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
    # X-Data-Warning: a tool sets it when it finished but the data looked wrong
    # (toolbox/dataops); the frontend shows it next to the download.
    # X-Checkout-Summary: the counts the Checkout page shows (toolbox/apps/planfeld/checkout.py).
    # X-TA-Summary: the states a Target Area run did and did not cover (toolbox/target_area/run_summary.py).
    expose_headers=['X-Job-Id', 'X-Data-Warning', 'X-Checkout-Summary', 'X-TA-Summary'],
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
app.include_router(tracks_analysis.router)

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
app.include_router(submission_reviewer.router)
app.include_router(contact_analysis.router)
app.include_router(target_area.router)
app.include_router(checkout.router)

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
        # category_headers() tags the "your data was wrong" exceptions so the job
        # tracker does not count them as crashes (toolbox/errors.py).
        headers={'error': exc.msg, **category_headers(exc)}
    )


# A tool raises DataContractError when the user's data is the problem (see
# toolbox/errors.py). The handler answers 422 with a structured body and an
# X-Error-Category header, which the job tracker files as `data_contract` —
# reported on the Reliability page but not counted against the success rate.
app.add_exception_handler(DataContractError, data_contract_error_handler)


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

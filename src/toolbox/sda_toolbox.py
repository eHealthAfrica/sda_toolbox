import uvicorn
from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError

from toolbox import SUMMARY, DESC
from toolbox.exceptions import ToolBoxExceptions
from toolbox.apps import (
    dip,
    dmp,
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
    reach_analysis,
    h2h_validation,
    contact_analysis,
    update_validation,
    hitnrun_validation,
    submission_reviewer,
    campaign_day_reporting,
    post_implementation_report
)


app = FastAPI(title='SDA Toolbox', summary=SUMMARY, description=DESC, version='0.4')

# MLoS Endpoints
app.include_router(fixer.router)
app.include_router(qc_mlos.router)
app.include_router(standardizer.router)
app.include_router(h2h_validation.router)
app.include_router(update_validation.router)

# DB Access
app.include_router(uuid_checker.router)

# Settlement Tracking Endpoints
app.include_router(hitnrun_validation.router)
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


if __name__ == '__main__':
    uvicorn.run(
        'sda_toolbox:app',
        port=8080,
        log_level='info',
        reload=True
    )

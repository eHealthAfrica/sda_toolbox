from typing import Any, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse

from toolbox.exceptions import DataError, FileNotFound, InvalidInputError, NoRecordsFound, NotSupportedError

# What this is: the one error a tool raises when the USER'S DATA is the
# problem — a missing required column, an unreadable workbook, a coordinate
# column full of text — as opposed to a bug in the tool. The job tracker
# (toolbox/job_tracker/classify.py) files these under the `data_contract`
# failure category, which is reported on the Reliability page but does NOT
# count against the success-rate target (see SLO_EXCLUDED_CATEGORIES), so a
# user uploading the wrong file no longer looks like the platform failing.
#
# Raise it from a tool like this:
#
#     raise DataContractError(
#         code='missing_columns',
#         message='The upload is missing required columns.',
#         details={'missing': ['latitude', 'longitude']},
#     )
#
# It is deliberately NOT a subclass of ToolBoxExceptions
# (toolbox/exceptions/exc.py): that family has its own handler and response
# shape ({msg, detail, status_code} plus an `error` header) which existing
# callers depend on, and this one answers with a structured body the
# frontend can show field by field.

CATEGORY_HEADER = 'X-Error-Category'


class DataContractError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Any] = None):
        self.code = code
        self.message = message
        self.details = details
        self.status_code = 422
        super().__init__(message)


async def data_contract_error_handler(_: Request, exc: DataContractError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            'error': {
                'code': exc.code,
                'message': exc.message,
                'details': exc.details,
            }
        },
        headers={CATEGORY_HEADER: 'data_contract'},
    )


# The existing ToolBoxExceptions that mean "the data you gave me is the
# problem" rather than "the tool is broken". They default to HTTP 500, so
# without this they would be filed as code errors and pull the success rate
# down every time someone uploads the wrong file. TableNotFound is left out
# on purpose: a missing database table is a platform/config fault.
USER_DATA_EXCEPTIONS = (InvalidInputError, NoRecordsFound, FileNotFound, NotSupportedError, DataError)


def category_headers(exc: Exception) -> dict[str, str]:
    """Extra response headers for the ToolBoxExceptions handler: the
    data_contract tag for the exceptions above, nothing for the rest."""
    if isinstance(exc, USER_DATA_EXCEPTIONS):
        return {CATEGORY_HEADER: 'data_contract'}
    return {}

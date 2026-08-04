class ToolBoxExceptions(Exception):
    def __init__(self, msg: str, details: str, status_code: int=500):
        self.msg = msg
        self.details = details
        self.status_code = status_code
        super().__init__(self.msg)


class InvalidInputError(ToolBoxExceptions):
    def __init__(self, msg: str, details: str, status_code: int=500):
        self.msg = msg
        self.details = details
        self.status_code = status_code


class NoRecordsFound(ToolBoxExceptions):
    def __init__(self, msg: str, details: str, status_code: int=500):
        self.msg = msg
        self.details = details
        self.status_code = status_code


class TableNotFound(ToolBoxExceptions):
    def __init__(self, msg: str, details: str, status_code: int=500):
        self.msg = msg
        self.details = details
        self.status_code = status_code


class FileNotFound(ToolBoxExceptions):
    def __init__(self, msg: str, details: str, status_code: int=500):
        self.msg = msg
        self.details = details
        self.status_code = status_code


class NotSupportedError(ToolBoxExceptions):
    def __init__(self, msg: str, details: str, status_code: int=500):
        self.msg = msg
        self.details = details
        self.status_code = status_code


class MissingConfiguration(ToolBoxExceptions):
    def __init__(self, msg: str, details: str, status_code: int=422):
        self.msg = msg
        self.details = details
        self.status_code = status_code


class ResourcesError(ToolBoxExceptions):
    def __init__(self, msg: str, details: str, status_code: int=404):
        self.msg = msg
        self.details = details
        self.status_code = status_code


class InvalidCredentials(ToolBoxExceptions):
    def __init__(self, msg: str, details: str, status_code: int=401):
        self.msg = msg
        self.details = details
        self.status_code = status_code


class NotFoundError(ToolBoxExceptions):
    def __init__(self, msg: str, details: str, status_code: int=400):
        self.msg = msg
        self.details = details
        self.status_code = status_code


class DataError(ToolBoxExceptions):
    def __init__(self, msg: str, details: str, status_code: int=500):
        self.msg = msg
        self.details = details
        self.status_code = status_code

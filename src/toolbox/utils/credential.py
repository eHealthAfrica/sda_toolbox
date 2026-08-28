import os
from typing import Optional
from dataclasses import dataclass, field

from dotenv import load_dotenv

from toolbox.exceptions import InvalidCredentials


@dataclass
class Credential:
    host: Optional[str] = field(default=None)
    port: Optional[str | int] = field(default=None)
    database: Optional[str] = field(default=None)
    user: Optional[str] = field(default=None)
    password: Optional[str] = field(default=None, repr=False)

    def __post_init__(self):
        self._load_credentials()
        self._validate_params(self.__dict__)

    def _load_credentials(self):
        """Loads credentials from the environment.

        `load_dotenv()` merges a local `.env` file into `os.environ` when one
        is present and is a no-op otherwise, so `os.environ.get(...)` below
        picks up credentials the same way whether they came from a `.env`
        file (local/dev) or were injected directly (containers, CI, a real
        deployment) — there's no actual behavioral difference between those
        two cases once the process environment is populated, so this no
        longer branches on ENVIRONMENT. (Previously it did branch, and the
        non-development branch set self.db_name/self.user_name instead of
        the dataclass's real self.database/self.user fields, silently
        breaking DB access for any ENVIRONMENT value other than
        'development' — see git history / DOCKERIZATION_PLAN.md quirk #1.)
        """
        load_dotenv()
        self.password = os.environ.get('PASSWORD')
        self.host = os.environ.get('HOST')
        self.port = os.environ.get('PORT')
        self.database = os.environ.get('DB')
        self.user = os.environ.get('USER')

        # Attempt to convert port to integer if it's a string
        if isinstance(self.port, str) and self.port.isdigit():
            self.port = int(self.port)

    @staticmethod
    def _validate_params(params: dict) -> None:
        if checks := [key for key, value in params.items() if value is None]:
            raise InvalidCredentials(
                "Missing DB Connection details", f'Missing details for: {", ".join(checks)}')

    @property
    def connection_string(self):
        if not all([self.user, self.password, self.host, self.port, self.database]):
            raise InvalidCredentials(
                "Missing DB Config Details", "Connection details are not fully configured.")

        return f"postgresql+psycopg2://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"

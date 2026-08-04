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
        """Loads credentials based on the environment."""
        load_dotenv()
        if os.getenv('ENVIRONMENT') == 'development':
            self.password = os.getenv('PASSWORD')
            self.host = os.getenv('HOST')
            self.port = os.getenv('PORT')
            self.database = os.getenv('DB')
            self.user = os.getenv('USER')
        else:
            # In production, assume credentials are set directly as environment variables
            self.password = os.environ.get('PASSWORD')
            self.host = os.environ.get('HOST')
            self.port = os.environ.get('PORT')
            self.db_name = os.environ.get('DB')
            self.user_name = os.environ.get('USER')

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

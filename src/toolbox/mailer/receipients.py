from dataclasses import dataclass

from toolbox.configs import CONFIG
from toolbox.models import State


@dataclass
class RecipientList:
    analyst_state: State

    @property
    def recipient_email(self) -> list[str]:
        analyst_email = CONFIG['ANALYST_EMAILS'].get(self.analyst_state.name.lower())
        if not analyst_email:
            raise ValueError(f"No email found for state: {self.analyst_state.name}")

        return [analyst_email]

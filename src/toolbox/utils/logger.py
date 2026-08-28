from datetime import datetime
import logging
import os

from toolbox.utils import workspace


@workspace
def logger(folder: str = None, log_name: str = None):
    log_folder = os.path.join(folder, 'logs', str(datetime.today().date()))
    os.makedirs(log_folder, exist_ok=True)

    if isinstance(log_name, str):
        if log_name.endswith('.log'):
            log_file = log_name
        else:
            log_file = f"{log_name}.log"
    else:
        log_file = "sda_toolbox.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        # Was a hardcoded `f'{log_folder}\\{log_file}'` — a literal backslash
        # that only worked as a path separator on Windows. On Linux it still
        # "worked" (no crash), but the log file ended up flat inside
        # `logs/` with a name like `2026-08-20\sda_toolbox.log` (a literal
        # backslash character) instead of nested under the dated folder.
        # os.path.join is correct on every platform.
        filename=os.path.join(log_folder, log_file)
    )

    root_logger = logging.getLogger()
    root_logger.name = log_name
    # Note: logging.basicConfig() only takes effect on its first call per
    # process — every router module below calls logger(log_name=...) at
    # import time with a different name, but only the first one actually
    # configures a handler/file; the rest just rename the (shared) root
    # logger. That's a pre-existing, broader design characteristic (root
    # logger vs. per-module named loggers), not fixed here — untangling it
    # would mean touching every `logging.info(...)` call across the router
    # modules that currently rely on the root logger, which is a larger,
    # separate change from the path bug this function actually had.

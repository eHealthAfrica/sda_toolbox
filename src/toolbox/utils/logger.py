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
        filename=f'{log_folder}\\{log_file}'
    )

    root_logger = logging.getLogger()
    root_logger.name = log_name

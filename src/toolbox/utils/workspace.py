import os
import time
import json
import logging
from typing import Callable, Any
from functools import wraps, reduce

import yaml

from toolbox.exceptions import MissingConfiguration

type Composable = Callable[[Any], Any]


def workspace(func: Callable[..., str]):
    @wraps(workspace)
    def wrapper(folder: str = None, *args, **kwargs):
        base_path = os.path.dirname(os.path.dirname(__file__))
        if folder is None:
            kwargs['folder'] = base_path
        
        return func(*args, **kwargs)
    
    return wrapper


def timer(func: Callable[..., Any] = None, *, title: str = None, display: bool=False) -> Callable[..., Any]:
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        def wrapper(*args, **kwargs):
            start_time = time.perf_counter()
            result = func(*args, **kwargs)
            end_time = time.perf_counter()
            duration = end_time - start_time
            display_title = title if title else func.__name__.replace('_', ' ').title()
            if display:
                print(f'{display_title} Runtime: {duration:.2f} seconds')

            logging.info(f'{display_title} Runtime: {duration:.2f} seconds')
            return result

        return wrapper

    if func is None:
        return decorator
    return decorator(func)


def atimer(func: Callable[..., Any] = None, *, title: str = None, display: bool=False) -> Callable[..., Any]:
    def decorator(func: Callable[..., Any]) ->Callable[..., Any]:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            start_time = time.perf_counter()
            result = await func(*args, **kwargs)
            end_time = time.perf_counter()
            execution_time = end_time - start_time
            display_title = title if title else func.__name__.replace('_', ' ').title()
            if display:
                print(f'{display_title} Runtime: {execution_time:.2f} seconds')
            logging.info(f'{display_title} Runtime: {execution_time:.2f} seconds')
            return result
        return wrapper

    if func is None:
        return decorator
    return decorator(func)


@workspace
def read_config(file_name: str, folder: str=None) -> dict[str, Any]:
    file_name = file_name if file_name.endswith('.yaml') else f'{file_name}.yaml'
    config_file = os.path.join(folder,  'configs', file_name)
    if not os.path.exists(config_file):
        logging.error(FileNotFoundError(f'{file_name} does not exist in {folder}'))
        raise  MissingConfiguration('No Config File', f'{file_name} does not exist in {folder}')

    with open(config_file, 'r') as file:
        config: dict = yaml.safe_load(file)

    return config


def compose(*functions: Composable) -> Composable:
    def apply(value: Any, fn: Composable):
        return fn(value)

    return lambda x: reduce(apply, functions, x)


@workspace
def read_json(file_name: str, folder: str=None):
    file_name = file_name if file_name.endswith('.json') else f'{file_name}.json'
    json_file = os.path.join(folder, 'configs', file_name)
    with open(json_file, 'r') as file:
        json_config: dict = json.load(file)

    return json_config

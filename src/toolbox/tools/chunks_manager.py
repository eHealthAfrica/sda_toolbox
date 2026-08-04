from typing import Any

from toolbox import CPU_COUNT


def define_chunk_size(data: Any) -> int:
    if len(data) < CPU_COUNT:
        return len(data)

    if len(data) <= 2*CPU_COUNT:
        return len(data) // 2

    thread_count = min(CPU_COUNT, len(data))
    return len(data) // thread_count


def create_chunks(data: Any, chunk_size: int=None) -> list[Any]:
    chunk_size = chunk_size if chunk_size else define_chunk_size(data)
    data_chunks = [
        data[i: i + chunk_size]
        for i in range(0, len(data), chunk_size)
    ]

    return data_chunks
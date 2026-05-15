# Windows Runtime Compatibility

This backend must remain bootable on Windows local environments, including
Python 3.10 installs that do not expose `datetime.UTC`.

## Required conventions

### UTC imports

Never use:

```python
from datetime import UTC
```

Always use:

```python
from common.datetime_compat import UTC
```

Reason: `datetime.UTC` is only available on newer Python releases. Importing it
directly breaks module import during app startup on Python 3.10, which is a
common Windows dev setup.

### Async timeouts

When waiting with `asyncio.wait_for(...)`, catch:

```python
except asyncio.TimeoutError:
```

Do not rely on a bare `TimeoutError` catch for asyncio worker loops. The
explicit `asyncio.TimeoutError` form is the project standard for background
workers and websocket loops.

### Event-loop dependencies

`requirements.txt` intentionally uses platform markers:

- `uvloop` only on non-Windows
- `winloop` only on Windows
- `tzdata` on Windows

Do not remove those markers unless the startup path is revalidated on both
Windows and Linux.

## Where this matters most

- module import time in `app/main.py` and routed service imports
- long-running worker loops under `app/services/`
- any new datetime-heavy helper introduced in backend services, schemas, or
  tests

## Guardrails

The test suite includes compatibility guard checks to catch:

- reintroduced `from datetime import UTC`
- bare `except TimeoutError` in backend Python files

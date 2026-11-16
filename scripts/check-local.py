#!/usr/bin/env python3
"""Focused OSS backend gate; temporary SQLite, no service startup or credentials.

Pass explicit backend test paths. The enterprise release runner is separate.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
backend = root / 'backend'
if not sys.argv[1:] or any(not p.startswith('tests/') or '..' in p for p in sys.argv[1:]):
    raise SystemExit('Usage: python scripts/check-local.py tests/test_file.py [...]')
with tempfile.TemporaryDirectory(prefix='oss-local-check-') as tmp:
    snapshot = Path(tmp) / 'backend'
    shutil.copytree(backend, snapshot, ignore=shutil.ignore_patterns(
        '.env', '.env.*', '.venv', 'venv', 'data', '__pycache__', '.pytest_cache', '*.db', '*.db-*', '*.log'))
    env = {k: os.environ[k] for k in ('PATH', 'HOME', 'LANG') if k in os.environ}
    env.update(PYTHONPATH=str(snapshot), DATABASE_URL='sqlite:///' + tmp + '/test.db',
               REDIS_HOST='127.0.0.1', REDIS_PORT='1', LOG_TO_FILE='false',
               OPENAI_AGENTS_DISABLE_TRACING='1', PYTHONPYCACHEPREFIX=tmp + '/pycache')
    for command in (
        [sys.executable, '-m', 'py_compile', 'app/main.py'],
        [sys.executable, '-m', 'alembic', 'current'],
        [sys.executable, '-m', 'pytest', '-q', *sys.argv[1:]],
    ):
        subprocess.run(command, cwd=snapshot, env=env, check=True)

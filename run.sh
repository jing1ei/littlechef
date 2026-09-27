#!/usr/bin/env bash
# littlechef — Python 3.11+, macOS/Linux; paths containing spaces are supported.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  if [ -e .venv ]; then
    echo '现有 .venv 不可用。请先将它移到备份位置，再重新运行。' >&2
    exit 1
  fi
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else "需要 Python 3.11 或更新版本")'
  python3 -m venv .venv
fi
./.venv/bin/python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else "虚拟环境需要 Python 3.11 或更新版本")'

# Install on first run or dependency changes; ordinary restarts do not need PyPI.
if ! cmp -s requirements.txt .venv/.littlechef-requirements; then
  ./.venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt
  cp requirements.txt .venv/.littlechef-requirements
fi
exec ./.venv/bin/python scripts/launch.py

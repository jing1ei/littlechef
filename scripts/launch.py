"""Launch littlechef without executing .env contents as shell code."""
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def load_environment(path):
    from dotenv import dotenv_values
    # Disallow interpolation: API keys and values containing '$' remain literal.
    for key, value in dotenv_values(path, interpolate=False).items():
        if value is not None:
            os.environ.setdefault(key, value)
    from app.environment import apply_legacy_aliases
    apply_legacy_aliases()


def main():
    load_environment(ROOT / '.env')
    try:
        port = int(os.environ.get('LITTLE_CHEF_PORT', '8848'))
        if not 1 <= port <= 65535: raise ValueError()
    except ValueError:
        raise SystemExit('LITTLE_CHEF_PORT 必须是 1 到 65535 的整数')
    os.chdir(ROOT)
    os.execv(sys.executable, [sys.executable, '-m', 'uvicorn', 'app.main:app', '--host',
                            os.environ.get('LITTLE_CHEF_HOST', '0.0.0.0'), '--port', str(port)])


if __name__ == '__main__':
    main()

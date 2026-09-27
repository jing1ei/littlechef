"""Create a deterministic source-only ZIP and SHA-256 sidecar outside the checkout."""
import argparse
import hashlib
from pathlib import Path
import re
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = {'.env.example', '.gitignore', '.dockerignore', 'VERSION', 'README.md',
              'requirements.txt', 'Dockerfile', 'docker-compose.yml', 'run.sh'}
SOURCE_DIRS = {'app', 'web', 'seed', 'skill', 'scripts', 'docs'}
EXCLUDED = {'__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.venv',
            'node_modules', '.git', 'dist', 'build', 'data', 'releases', 'htmlcov'}
EXTENSIONS = {'.py', '.js', '.css', '.html', '.json', '.md', '.jpg', '.jpeg', '.png', '.svg', '.woff2'}


def source_files(root=ROOT):
    files = []
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if any(part in EXCLUDED for part in rel.parts):
            continue
        if path.is_symlink():
            raise ValueError('Source package cannot contain symlinks: ' + str(rel))
        if not path.is_file():
            continue
        if any(part.startswith('._') or part == '.DS_Store' for part in rel.parts):
            continue
        if str(rel) in ROOT_FILES:
            files.append(path)
        elif rel.parts[0] in SOURCE_DIRS and path.suffix.lower() in EXTENSIONS:
            if any(part.startswith('.') for part in rel.parts):
                continue
            if rel.parts[:3] == ('web', 'vendor', 'fonts') and path.suffix == '.woff2':
                continue  # optional downloaded fonts are not maintained sources
            files.append(path)
    for name in ROOT_FILES:
        if not (root / name).is_file():
            raise ValueError('Missing source file: ' + name)
    return files


def package(out):
    version = (ROOT / 'VERSION').read_text().strip()
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?', version):
        raise ValueError('Invalid VERSION')
    out = out.resolve()
    if out == ROOT or ROOT in out.parents:
        raise ValueError('Choose an output directory outside the source checkout')
    out.mkdir(parents=True, exist_ok=True)
    name = 'littlechef-' + version
    target = out / (name + '-source.zip')
    sidecar = target.with_suffix('.zip.sha256')
    if target.exists() or sidecar.exists():
        raise ValueError('Release already exists; use a new output directory or version')
    files = source_files()
    manifest = []
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            rel = path.relative_to(ROOT).as_posix()
            raw = path.read_bytes()
            manifest.append(hashlib.sha256(raw).hexdigest() + '  ' + rel)
            info = zipfile.ZipInfo(name + '/' + rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | (0o755 if rel == 'run.sh' else 0o644)) << 16
            archive.writestr(info, raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        info = zipfile.ZipInfo(name + '/SOURCE-MANIFEST.sha256', date_time=(2026, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | 0o644) << 16
        archive.writestr(info, '\n'.join(manifest) + '\n', compress_type=zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP verification failed')
        for line in manifest:
            digest, rel = line.split('  ', 1)
            assert hashlib.sha256(archive.read(name + '/' + rel)).hexdigest() == digest
    sidecar.write_text(hashlib.sha256(target.read_bytes()).hexdigest() + '  ' + target.name + '\n')
    print(f'{target}\n{len(files)} source files; {target.stat().st_size:,} bytes\n{sidecar}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    package(args.out)

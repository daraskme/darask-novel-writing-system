"""Install bundled writing skills without overwriting local edits."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import sys
from project import inside

SYSTEM = Path(__file__).resolve().parents[1]


def inventory(root):
    result = {}
    for p in root.rglob('*'):
        if p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction()):
            raise ValueError(f'リンクはコピーしません: {p}')
        if p.is_file() and p.name != '.darask-install.json' and '__pycache__' not in p.parts:
            result[p.relative_to(root).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    return result


def install(project):
    project = Path(project).resolve()
    destination = inside(project, '.agents/skills')
    for path in (project / '.agents', destination):
        if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()):
            raise ValueError(f'リンクへの導入はできません: {path}')
    sources = [p for p in (SYSTEM / 'skills').iterdir() if p.is_dir() and (p / 'SKILL.md').is_file()]
    # Preflight every destination before making any update.
    for src in sources:
        dest = inside(project, '.agents/skills/' + src.name)
        if dest.exists():
            current = inventory(dest)
            if current == inventory(src):
                continue
            marker = dest / '.darask-install.json'
            if not marker.is_file() or current != json.loads(marker.read_text(encoding='utf-8')):
                raise ValueError(f'独自変更を保護しました。退避・統合後に再実行: {dest}')
    for src in sources:
        dest = inside(project, '.agents/skills/' + src.name)
        if dest.exists() and inventory(dest) == inventory(src):
            continue
        if dest.exists():
            if not dest.resolve().is_relative_to(project) or dest.is_symlink() or (hasattr(dest, 'is_junction') and dest.is_junction()):
                raise ValueError(f'作品外の削除はできません: {dest}')
            shutil.rmtree(dest)
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        (dest / '.darask-install.json').write_text(json.dumps(inventory(src), sort_keys=True, indent=2), encoding='utf-8')
    print(f'{len(sources)}スキル: {destination}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--project', required=True, type=Path)
    try:
        install(ap.parse_args().project)
    except (OSError, ValueError) as e:
        sys.exit(str(e))

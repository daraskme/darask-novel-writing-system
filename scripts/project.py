"""Shared project paths and validation; Python 3.11+, no dependencies."""
from pathlib import Path, PurePosixPath
import json
import re
import tomllib


def inside(root, relative):
    root = Path(root).resolve()
    raw = PurePosixPath(relative)
    if raw.is_absolute() or '..' in raw.parts or '\\' in relative or ':' in relative:
        raise ValueError(f'プロジェクト外のパス: {relative}')
    path = root.joinpath(*raw.parts)
    for parent in [path, *path.parents]:
        if parent == root:
            break
        if parent.is_symlink() or (hasattr(parent, 'is_junction') and parent.is_junction()):
            raise ValueError(f'リンクは対象外: {relative}')
    if not path.resolve().is_relative_to(root):
        raise ValueError(f'プロジェクト外のパス: {relative}')
    return path


def config(root):
    return tomllib.loads(inside(root, 'novel.toml').read_text(encoding='utf-8-sig'))


def episodes(root):
    rows = json.loads(inside(root, 'plot/episodes.json').read_text(encoding='utf-8-sig'))
    if not isinstance(rows, list):
        raise ValueError('episodes.json は配列です')
    seen = set()
    for row in rows:
        n = row['number']
        if type(n) is not int or n < 1 or n in seen:
            raise ValueError('話番号は重複しない正の整数です')
        seen.add(n)
        if not isinstance(row['title'], str) or not row['title'].strip():
            raise ValueError(f'第{n}話の題名が空です')
        if row['manuscript'] != f'main/{n:03}.txt' or row['plot'] != f'plot/episodes/{n:03}.md':
            raise ValueError(f'第{n}話の保存先が命名規則と不一致です')
        inside(root, row['manuscript'])
        inside(root, row['plot'])
    return sorted(rows, key=lambda x: x['number'])


def repository(value):
    if value and not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', value):
        raise ValueError('リポジトリは owner/name の形式です')
    return value


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')

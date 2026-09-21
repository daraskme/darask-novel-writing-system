"""Build the review site using only indexed manuscripts and the reader."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import uuid
from project import config, episodes, inside, repository, write


def build(root):
    root = Path(root).resolve()
    cfg = config(root)
    rows = episodes(root)
    repo = repository(cfg.get('github', {}).get('repository', ''))
    branch = cfg.get('github', {}).get('branch', 'main')
    source = inside(root, 'reader')
    if not (source / 'index.html').is_file():
        raise ValueError('reader/index.html がありません')
    # Validate the full input before replacing our own generated directory.
    published = []
    data = {}
    for row in rows:
        p = inside(root, row['manuscript'])
        if p.is_file():
            blob = p.read_bytes()
            if not blob.decode('utf-8-sig').strip():
                raise ValueError(f'空の採用原稿: {p}')
            published.append({k: row[k] for k in ('number', 'title', 'manuscript')} | {'kind': row.get('kind', '本編')})
            data[row['manuscript']] = blob
    reader = {p.name: p.read_bytes() for p in source.iterdir() if p.name in ('index.html', 'app.js', 'style.css') and inside(root, 'reader/' + p.name).is_file()}
    commit = ''
    try:
        commit = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True, stderr=subprocess.DEVNULL).strip()
        tracked = ['reader', 'main', 'plot/episodes.json', 'novel.toml']
        if subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain', '--', *tracked], text=True).strip():
            commit = ''  # Never label edited working-copy text as the saved commit.
    except (OSError, subprocess.CalledProcessError):
        pass
    output = inside(root, '_site')
    if output.exists():
        if not (output / '.darask-generated').is_file():
            raise ValueError('_site はこのツールの生成物ではありません。別の場所へ退避してください')
    destination = output
    # Build fully before touching the previous site. A locked Windows directory
    # then fails at rename without partially deleting the working preview.
    output = inside(root, Path(tempfile.mkdtemp(prefix='.darask-build-', dir=root)).name)
    write(output / '.darask-generated', 'darask-novel-writing-system\n')
    for name, blob in reader.items():
        p = output / 'reader' / name
        p.parent.mkdir(exist_ok=True)
        p.write_bytes(blob)
    for name, blob in data.items():
        p = inside(output, name)
        p.parent.mkdir(exist_ok=True)
        p.write_bytes(blob)
    write(output / 'plot/episodes.json', json.dumps(published, ensure_ascii=False, indent=2) + '\n')
    meta = {'title': cfg['work']['title'], 'repo': repo, 'branch': branch, 'commit': commit,
            'hashes': {k: hashlib.sha256(v).hexdigest() for k, v in data.items()}}
    write(output / 'reader/project.json', json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    write(output / 'index.html', '<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=reader/"><a href="reader/">校閲リーダー</a></html>\n')
    write(output / '_headers', '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Cache-Control: no-store\n')
    backup = inside(root, '.darask-build-backup-' + uuid.uuid4().hex)
    try:
        if destination.exists():
            destination.rename(backup)
        try:
            output.rename(destination)
        except OSError:
            if backup.exists():
                backup.rename(destination)
            raise
    finally:
        if output.exists():
            shutil.rmtree(inside(root, output.name))
    if backup.exists():
        try:
            shutil.rmtree(inside(root, backup.name))
        except OSError:
            print(f'旧ビルドの一時コピーを残しました: {backup}', file=sys.stderr)
    print(f'{destination}: {len(published)}話（wiki・プロット本文・feedback・認証情報は配信しません）')
    return destination


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--project', type=Path, default=Path(__file__).resolve().parents[1])
    try:
        build(ap.parse_args().project)
    except (OSError, ValueError, KeyError) as e:
        sys.exit(str(e))

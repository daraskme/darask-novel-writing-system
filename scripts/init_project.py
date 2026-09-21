"""Create a separate novel repository scaffold. Existing directories are protected."""
from pathlib import Path
import argparse
import json
import shutil
import sys
from install_skills import install, SYSTEM
from project import repository, write


def create(destination, title, repo, minimum=0):
    repository(repo)
    if minimum < 0:
        raise ValueError('最低字数は0以上です')
    destination = Path(destination).absolute()
    if destination.exists():
        raise ValueError(f'既存フォルダは上書きしません: {destination}')
    shutil.copytree(SYSTEM / 'template', destination)
    shutil.copytree(SYSTEM / 'reader', destination / 'reader')
    for name in ('project.py', 'novel.py', 'build_site.py'):
        shutil.copy2(SYSTEM / 'scripts' / name, destination / 'scripts' / name)
    q = lambda value: json.dumps(value, ensure_ascii=False)
    write(destination / 'novel.toml', f'''[work]
title = {q(title)}
profile = "web"
length = "long"
medium = "kakuyomu"

[production]
minimum_body_chars = {minimum}

[github]
repository = {q(repo)}
branch = "main"
''')
    install(destination)
    print(f'作成: {destination}\n次に git init -b main を実行してください。外部送信はしていません。')
    return destination


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('destination', type=Path)
    ap.add_argument('--title', required=True)
    ap.add_argument('--repo', default='')
    ap.add_argument('--minimum-chars', type=int, default=0)
    a = ap.parse_args()
    try:
        create(a.destination, a.title, a.repo, a.minimum_chars)
    except (OSError, ValueError) as e:
        sys.exit(str(e))

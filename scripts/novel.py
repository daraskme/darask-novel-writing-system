"""Episode management, assembly and Kakuyomu export. No external writes."""
from pathlib import Path
import argparse
import json
import subprocess
import sys
import tempfile
import tomllib
from project import config, episodes, inside, write

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / '.agents/skills/ja-novel-write/scripts'
if not LIB.is_dir():
    LIB = ROOT / 'skills/ja-novel-write/scripts'
sys.path.insert(0, str(LIB))
from count_chars import count_body
from assemble_scenes import AssembleError, join_segments, scene_ids


def data(root, n):
    row = next((r for r in episodes(root) if r['number'] == n), None)
    if row is None:
        raise ValueError(f'第{n}話が索引にありません')
    beat = tomllib.loads(inside(root, f'plot/beats/ch{n:03}.toml').read_text(encoding='utf-8'))
    if beat['chapter'] != n or beat['title'] != row['title']:
        raise ValueError(f'第{n}話のビートと索引が不一致です')
    ids = scene_ids(beat['scenes'])
    return row, beat, ids


def joined(root, n):
    _, _, ids = data(root, n)
    parts = [inside(root, f'work/scenes/ch{n:03}-{sid}.md').read_bytes() for sid in ids]
    if not all(p.decode('utf-8-sig').strip() for p in parts):
        raise ValueError('空の小場面があります')
    return join_segments(parts)


def valid(root, payload):
    text = payload.decode('utf-8-sig')
    length = count_body(text)
    minimum = config(root).get('production', {}).get('minimum_body_chars', 0)
    if not length or length < minimum:
        raise ValueError(f'本文{length}字、最低{minimum}字を満たしていません')
    return length


def save(path, payload, overwrite):
    if path.exists() and path.read_bytes() != payload and not overwrite:
        raise ValueError(f'既存稿を保護しました。小場面との差分を確認して --overwrite: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def add(root, n, title):
    if n < 1 or not title.strip():
        raise ValueError('正の話番号と題名が必要です')
    rows = episodes(root)
    paths = [inside(root, f'plot/episodes/{n:03}.md'), inside(root, f'plot/beats/ch{n:03}.toml'), inside(root, f'main/{n:03}.txt')]
    if any(p.exists() for p in paths) or any(r['number'] == n for r in rows):
        raise ValueError('既存の話は上書きしません')
    row = {'number': n, 'title': title, 'kind': '本編', 'plot': f'plot/episodes/{n:03}.md', 'manuscript': f'main/{n:03}.txt'}
    rows.append(row)
    write(paths[0], f'# 第{n}話「{title}」\n\n## この話で起こすこと\n\n## 前後の状態\n\n## 小場面\n')
    write(paths[1], f'chapter = {n}\ntitle = {json.dumps(title, ensure_ascii=False)}\n\n[[scenes]]\nid = "s01"\ntarget_chars = 1500\ngoal = ""\nentry_state = ""\nexit_state = ""\nhandoff = ""\n')
    write(inside(root, 'plot/episodes.json'), json.dumps(sorted(rows, key=lambda r: r['number']), ensure_ascii=False, indent=2) + '\n')
    print(f'第{n}話を登録。plotスキルで具体化してから小場面を書いてください。')


def check(root):
    rows = episodes(root)
    complete = 0
    for row in rows:
        n = row['number']
        if not inside(root, row['plot']).is_file():
            raise ValueError(f'詳細プロットがありません: {row["plot"]}')
        data(root, n)
        main = inside(root, row['manuscript'])
        if main.exists():
            length = valid(root, main.read_bytes())
            draft = inside(root, f'work/drafts/{n:03}.txt')
            source = joined(root, n).decode('utf-8-sig').replace('\r\n', '\n').rstrip()
            # Export may normalize manuscript notation; verify the assembled draft first.
            if not draft.exists() or draft.read_text(encoding='utf-8-sig').rstrip() != source:
                raise ValueError(f'第{n}話の小場面と結合稿が不一致です')
            with tempfile.TemporaryDirectory(prefix='novel-check-') as tmp:
                converted = Path(tmp) / 'adopted.txt'
                subprocess.run([sys.executable, str(LIB / 'export.py'), str(draft), '--to', 'kakuyomu', '--indent', 'keep', '--verify', '-o', str(converted)], check=True, capture_output=True)
                if converted.read_text(encoding='utf-8-sig').rstrip() != main.read_text(encoding='utf-8-sig').rstrip():
                    raise ValueError(f'第{n}話の採用稿と結合稿が不一致です。直接修正を小場面へ戻してください')
            complete += 1
            print(f'{n:03}: {length}字')
    print(f'索引{len(rows)}話、採用稿{complete}話。構成・同期検査OK。内容の校閲は別に行ってください。')


def run(a):
    root = a.project.resolve()
    if a.command == 'check':
        return check(root)
    if a.command == 'new':
        return add(root, a.number, a.title)
    row, _, _ = data(root, a.number)
    draft = inside(root, f'work/drafts/{a.number:03}.txt')
    main = inside(root, row['manuscript'])
    if a.command == 'assemble':
        payload = joined(root, a.number)
        save(draft, payload, a.overwrite)
        print(f'{draft}: {count_body(payload.decode("utf-8-sig"))}字')
    elif a.command == 'count':
        src = main if a.main or not draft.exists() else draft
        print(f'{src}: {count_body(src.read_text(encoding="utf-8-sig"))}字')
    elif a.command == 'lint':
        src = main if a.main or not draft.exists() else draft
        valid(root, src.read_bytes())
        subprocess.run([sys.executable, str(LIB / 'novel_lint.py'), str(src), '--project', str(root), '--only', 'NCM'], check=True)
    else:
        src = draft if a.command == 'adopt' else main
        valid(root, src.read_bytes())
        dest = main if a.command == 'adopt' else inside(root, f'work/export/kakuyomu/{a.number:03}.txt')
        with tempfile.TemporaryDirectory(prefix='novel-export-') as tmp:
            converted = Path(tmp) / 'body.txt'
            subprocess.run([sys.executable, str(LIB / 'export.py'), str(src), '--to', 'kakuyomu', '--indent', 'keep', '--verify', '-o', str(converted)], check=True)
            valid(root, converted.read_bytes())
            save(dest, converted.read_bytes(), a.overwrite)
        print(f'保存: {dest}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--project', type=Path, default=ROOT)
    sub = ap.add_subparsers(dest='command', required=True)
    sub.add_parser('check')
    for cmd in ('new', 'assemble', 'adopt', 'count', 'lint', 'export'):
        p = sub.add_parser(cmd)
        p.add_argument('number', type=int)
        p.add_argument('--overwrite', action='store_true')
        p.add_argument('--main', action='store_true')
        if cmd == 'new':
            p.add_argument('--title', required=True)
    try:
        run(ap.parse_args())
    except (OSError, ValueError, KeyError, AssembleError, subprocess.CalledProcessError) as e:
        sys.exit(str(e))

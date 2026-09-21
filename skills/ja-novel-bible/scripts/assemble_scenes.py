#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小場面ファイルをビートの順序で章本文へ結合する（本文の再生成・変換はしない）。

python scripts/assemble_scenes.py --project DIR --chapter N [--overwrite]
入力: plot/beats/chNNN.toml の scenes 順に work/scenes/chNNN-<id>.md。
id を省略した旧ビートは位置から s01、s02…を使う。出力: manuscript/chNNN.md。
旧ビートの並べ替え・挿入・削除前には、現在の代替 ID を id 欄へ明記して固定する。
双方に改行がない境界へ LF を 1 つ補う以外は、入力の UTF-8 バイト列を保持する。
既存章と同じ内容なら何もしない。異なる既存章の置換には --overwrite が必要。
章側の手直しは先に小場面へ反映し、直近の採用版で再結合すること。
終了コード: 0 = 結合成功 / 同内容、2 = 入力・出力の問題（既存章は保持）。
"""
from __future__ import annotations

import argparse
import os
import re
import stat
import sys
import tempfile
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None

from count_chars import count_body

SCENE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*")
DEVICE_ID = re.compile(r"(?:con|prn|aux|nul|com[1-9]|lpt[1-9])", re.I)


class AssembleError(Exception):
    """本文を変更せずに呼出し元へ返す入力・出力エラー。"""


def no_links(path: Path) -> None:
    """symlink と Windows junction / reparse point を、祖先も含めて拒否する。"""
    for part in (path, *path.parents):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise AssembleError(f"リンク / reparse point を経由するパスは使えません: {part}")


def scene_ids(scenes) -> list[str]:
    """明示 ID と位置による旧 ID を一緒に検査し、元の配列順で返す。"""
    if not isinstance(scenes, list) or not scenes:
        raise AssembleError("章ビートに 1 件以上の [[scenes]] が必要です。")
    result, seen = [], set()
    for index, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict):
            raise AssembleError(f"scenes の {index} 件目が表ではありません。")
        value = scene.get("id", f"s{index:02d}")
        if not isinstance(value, str) or not SCENE_ID.fullmatch(value) or DEVICE_ID.fullmatch(value):
            raise AssembleError(f"scenes の {index} 件目の id が不正です: {value!r}。英数字で始まる英数字・_・- を使い、デバイス名は避けてください。")
        if value.casefold() in seen:
            raise AssembleError(f"小場面の id が重複しています（大文字小文字を区別しません）: {value}")
        seen.add(value.casefold())
        result.append(value)
    return result


def join_segments(segments: list[bytes]) -> bytes:
    """見出しや転換記号を足さず、元の空行・字下げ・改行コードも保つ。"""
    pieces = []
    for segment in segments:
        if pieces and not pieces[-1].endswith((b"\n", b"\r")) and not segment.startswith((b"\n", b"\r")):
            pieces.append(b"\n")
        pieces.append(segment)
    return b"".join(pieces)


def read_existing(output: Path) -> bytes | None:
    no_links(output)
    if not output.exists():
        return None
    if not output.is_file():
        raise AssembleError(f"章の出力先が通常ファイルではありません: {output}")
    return output.read_bytes()


def atomic_write(output: Path, data: bytes, previous: bytes | None) -> None:
    no_links(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{output.stem}-", suffix=".tmp", dir=output.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        # 組み立て中に章が変更されたら、その版を上書きしない。
        if read_existing(output) != previous:
            raise AssembleError(f"結合処理中に章が変更されました。採用版を確認して再実行してください: {output}")
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def assemble(project: Path, chapter: int, *, overwrite=False) -> dict:
    if type(chapter) is not int or chapter < 1:
        raise AssembleError("--chapter には 1 以上の整数を指定してください。")
    root = Path(os.path.abspath(project))
    no_links(root)
    if not root.is_dir():
        raise AssembleError(f"作品ディレクトリがありません: {root}")
    if tomllib is None:
        raise AssembleError("TOML の読み込みには Python 3.11 以降が必要です。")
    chapter_name = f"ch{chapter:03d}"
    beat = root / "plot" / "beats" / f"{chapter_name}.toml"
    no_links(beat)
    if not beat.is_file():
        raise AssembleError(f"章ビートがありません: {beat}")
    try:
        data = tomllib.loads(beat.read_text(encoding="utf-8-sig"))
    except (ValueError, UnicodeError) as exc:
        raise AssembleError(f"章ビートを読めません: {beat}: {exc}") from exc
    if "chapter" in data and (type(data["chapter"]) is not int or data["chapter"] != chapter):
        raise AssembleError(f"章ビートの chapter が --chapter {chapter} と一致しません: {beat}")
    ids = scene_ids(data.get("scenes"))
    segments, sources = [], []
    for scene_id in ids:
        source = root / "work" / "scenes" / f"{chapter_name}-{scene_id}.md"
        no_links(source)
        if not source.is_file():
            raise AssembleError(f"小場面の本文がありません: {source}")
        raw = source.read_bytes()
        try:
            text = raw.decode("utf-8")
        except UnicodeError as exc:
            raise AssembleError(f"小場面を UTF-8 として読めません: {source}") from exc
        if count_body(text) == 0:
            raise AssembleError(f"小場面の本文が空です（空白・見出し・飾り行だけ）: {source}")
        segments.append(raw)
        sources.append(source)
    combined = join_segments(segments)
    output = root / "manuscript" / f"{chapter_name}.md"
    previous = read_existing(output)
    unchanged = previous == combined
    if previous is not None and not unchanged and not overwrite:
        raise AssembleError(f"既存の章と内容が異なります。章側の手直しを小場面へ反映し、採用版を確認して --overwrite で再結合してください: {output}")
    if not unchanged:
        atomic_write(output, combined, previous)
    return {"output": output, "sources": sources, "ids": ids,
            "chars": count_body(combined.decode("utf-8")), "unchanged": unchanged}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True, help="作品のルートディレクトリ")
    parser.add_argument("--chapter", type=int, required=True, help="1 以上の章番号")
    parser.add_argument("--overwrite", action="store_true", help="採用版の小場面から、内容の異なる既存章を再結合する")
    args = parser.parse_args(argv)
    try:
        result = assemble(args.project, args.chapter, overwrite=args.overwrite)
    except (AssembleError, OSError) as exc:
        print(f"assemble_scenes: {exc}", file=sys.stderr)
        return 2
    print(f"{'同内容（変更なし）' if result['unchanged'] else '結合'}: {' → '.join(result['ids'])}")
    print(f"出力: {result['output']}（本文 {result['chars']} 字、{len(result['sources'])} 区間）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

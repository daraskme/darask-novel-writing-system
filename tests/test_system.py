from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from init_project import create
from install_skills import install
from build_site import build
from project import inside, write


class SystemTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='darask-test-')
        self.root = create(Path(self.tmp.name) / 'novel', '校閲テストの物語', 'example/novel', 20)

    def tearDown(self):
        self.tmp.cleanup()

    def command(self, *args, ok=True):
        result = subprocess.run([sys.executable, str(self.root / 'scripts/novel.py'), *args], text=True, capture_output=True, encoding='utf-8')
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def story(self):
        self.command('new', '1', '--title', '返された傘')
        write(self.root / 'work/scenes/ch001-s01.md', '　閉店前の店に、青い傘が一本戻ってきた。\n\n「借りたままで、すみません」\n\n　店主は首を振り、まだ濡れた傘を入口の箱へ戻した。\n')
        self.command('assemble', '1')
        self.command('adopt', '1')

    def test_create_assemble_adopt_export_and_protect_changes(self):
        self.story()
        self.command('check')
        self.command('export', '1')
        self.assertEqual((self.root / 'main/001.txt').read_bytes(), (self.root / 'work/export/kakuyomu/001.txt').read_bytes())
        write(self.root / 'main/001.txt', '　作者が直接修正した本文。ここを失ってはいけない。\n')
        self.command('check', ok=False)
        self.command('adopt', '1', ok=False)
        self.assertIn('作者が直接', (self.root / 'main/001.txt').read_text(encoding='utf-8'))

    def test_minimum_and_duplicate_episode(self):
        self.command('new', '1', '--title', '短い原稿')
        self.command('new', '1', '--title', '上書き', ok=False)
        write(self.root / 'work/scenes/ch001-s01.md', '短い。\n')
        self.command('assemble', '1')
        self.command('adopt', '1', ok=False)
        self.assertFalse((self.root / 'main/001.txt').exists())

    def test_build_whitelist_and_hash_match(self):
        self.story()
        write(self.root / 'wiki/secret.md', '未出の設定')
        write(self.root / 'feedback/private.md', '校閲メモ')
        write(self.root / '.env', 'EXAMPLE_ONLY=yes')
        write(self.root / 'main/999.txt', '索引にない原稿')
        output = build(self.root)
        self.assertFalse((output / 'wiki').exists())
        self.assertFalse((output / 'feedback').exists())
        self.assertFalse((output / '.env').exists())
        self.assertFalse((output / 'main/999.txt').exists())
        self.assertFalse((output / 'plot/episodes/001.md').exists())
        expected = hashlib.sha256((self.root / 'main/001.txt').read_bytes()).hexdigest()
        metadata = json.loads((output / 'reader/project.json').read_text(encoding='utf-8'))
        self.assertEqual(metadata['hashes']['main/001.txt'], expected)
        self.assertEqual(metadata['repo'], 'example/novel')
        self.assertEqual(metadata['commit'], '')
        self.assertEqual(build(self.root), output)

    def test_site_and_index_protect_unrelated_files(self):
        write(self.root / '_site/keep.txt', 'existing')
        with self.assertRaises(ValueError):
            build(self.root)
        self.assertEqual((self.root / '_site/keep.txt').read_text(), 'existing')
        with self.assertRaises(ValueError):
            inside(self.root, '../outside.txt')
        with self.assertRaises(ValueError):
            inside(self.root, 'C:/outside.txt')

    def test_install_preserves_local_skill_edits(self):
        p = self.root / '.agents/skills/ja-novel-write/SKILL.md'
        p.write_text(p.read_text(encoding='utf-8') + '\n作者の追記。\n', encoding='utf-8')
        with self.assertRaises(ValueError):
            install(self.root)
        self.assertTrue(p.read_text(encoding='utf-8').endswith('作者の追記。\n'))
        with self.assertRaises(ValueError):
            create(self.root, '上書き', '', 0)

    def test_empty_project_is_valid_but_has_no_manuscript(self):
        self.command('check')
        output = build(self.root)
        self.assertEqual(json.loads((output / 'plot/episodes.json').read_text()), [])

    def test_locked_site_does_not_lose_previous_build(self):
        self.story()
        output = build(self.root)
        original = (output / 'main/001.txt').read_bytes()
        rename = Path.rename
        def locked(path, target):
            if path == output:
                raise PermissionError('simulated locked preview directory')
            return rename(path, target)
        with patch.object(Path, 'rename', locked):
            with self.assertRaises(PermissionError):
                build(self.root)
        self.assertEqual((output / 'main/001.txt').read_bytes(), original)
        self.assertTrue((output / '.darask-generated').exists())


if __name__ == '__main__':
    unittest.main()

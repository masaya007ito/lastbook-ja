#!/usr/bin/env python3
"""The Japanese interface: search words, translated guides that cite exactly what the English ones cite, and every
interface text marked for translation having a Japanese entry. No library, no server, no port.

  python3 -B -m unittest app.tests.test_ja

The two Node checks are skipped where Node is not installed.
"""
import json, shutil, subprocess, sys, unittest
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
from engine import ja_terms  # noqa: E402
import check_ja_topics  # noqa: E402

NODE = shutil.which('node')


class SearchWords(unittest.TestCase):
    def test_japanese_becomes_library_words(self):
        self.assertEqual(ja_terms.to_english('水を煮沸する方法'), 'water boil')
        self.assertEqual(ja_terms.to_english('停電したときの冷蔵庫'), 'blackout fridge')
        self.assertEqual(ja_terms.to_english('やけどの応急手当'), 'burn first aid')

    def test_longest_word_wins(self):
        self.assertEqual(ja_terms.to_english('熱中症'), 'heat stroke')   # not 熱 (fever)
        self.assertEqual(ja_terms.to_english('洪水'), 'flood')          # not 水 (water)

    def test_english_is_untouched_and_kept_alongside(self):
        self.assertEqual(ja_terms.to_english('water filter'), 'water filter')
        self.assertEqual(ja_terms.to_english('AED の使い方'), 'defibrillator')
        self.assertEqual(ja_terms.to_english('generator 一酸化炭素'), 'generator carbon monoxide')

    def test_unknown_japanese_gives_nothing(self):
        self.assertEqual(ja_terms.to_english('こんにちは'), '')

    def test_search_and_assistant_use_it(self):
        self.assertIn('query_groups(ja_terms.to_english(q))', (ROOT / 'server.py').read_text(encoding='utf-8'))
        self.assertIn('ja_terms.to_english(q) or q', (ROOT / 'assistant.py').read_text(encoding='utf-8'))


class Guides(unittest.TestCase):
    def test_translations_cite_what_the_english_cites(self):
        probs = check_ja_topics.check()
        self.assertEqual(probs, {}, '\n'.join(f'{k}: {v[:5]}' for k, v in probs.items()))

    def test_checker_catches_a_changed_page(self):
        en = {'id': 'x', 'title': 'Water', 'choices': [{'id': 'a', 'label': 'Boil', 'read': [{'doc': 'd1', 'page': 3, 'note': 'n'}]}]}
        ja = json.loads(json.dumps(en))
        ja['title'], ja['choices'][0]['label'], ja['choices'][0]['read'][0]['note'] = '水', '煮沸', '説明'
        self.assertEqual(check_ja_topics.compare(en, ja, 'x', []), [])
        ja['choices'][0]['read'][0]['page'] = 4
        self.assertTrue(check_ja_topics.compare(en, ja, 'x', []))
        ja['choices'][0]['read'][0]['page'], ja['title'] = 3, 'Water'
        self.assertTrue(check_ja_topics.compare(en, ja, 'x', []))   # left in English

    def test_server_reads_the_translation_and_falls_back(self):
        src = (ROOT / 'server.py').read_text(encoding='utf-8')
        self.assertIn("f'topics-{lang}'", src)
        self.assertIn("f'gaps-{lang}.json'", src)
        self.assertIn("lang = req.get('lang') if req.get('lang') in LANGS else 'en'", src)


@unittest.skipUnless(NODE, 'needs Node')
class Interface(unittest.TestCase):
    def test_tr_falls_back_and_fills(self):
        js = """
        global.window = {localStorage: {getItem: () => '"ja"'}, navigator: {language: 'en-US'}};
        require(process.argv[1]);
        const w = global.window;
        w.lbWords('ja', {'{n} pages': '{n}ページ'});
        console.log(JSON.stringify([w.LB_LANG, w.tr('{n} pages', {n: 3}), w.tr('Not translated'), w.tr('Hi {who}', {})]));
        """
        out = subprocess.run([NODE, '-e', js, str(ROOT / 'web' / 'i18n.js')], capture_output=True, text=True, check=True).stdout
        self.assertEqual(json.loads(out), ['ja', '3ページ', 'Not translated', 'Hi {who}'])

    def test_every_marked_text_has_japanese(self):
        r = subprocess.run([NODE, str(ROOT / 'tools' / 'check_ja_words.js')], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout[-3000:])


if __name__ == '__main__':
    unittest.main()

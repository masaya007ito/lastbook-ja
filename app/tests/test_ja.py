#!/usr/bin/env python3
"""The Japanese interface: search words, translated guides that cite exactly what the English ones cite, and every
interface text marked for translation having a Japanese entry. No library, no server, no port.

  python3 -B -m unittest app.tests.test_ja

The two Node checks are skipped where Node is not installed.
"""
import json, shutil, sqlite3, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
from engine import ja_terms, ja_search  # noqa: E402
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


PAGES = 'CREATE VIRTUAL TABLE pages USING fts5(doc_id UNINDEXED,title,collection,category,path UNINDEXED,page UNINDEXED,body,tokenize="unicode61")'
ROWS = [('ja-manual', '市民防災マニュアル', '防災', 'disaster-response', 'documents/ja/m.pdf', 3, '飲料水は煮沸してから使います。断水に備えて水を3日分ためておきましょう。'),
        ('ja-manual', '市民防災マニュアル', '防災', 'disaster-response', 'documents/ja/m.pdf', 4, 'やけどをしたら、すぐに流水で15分以上冷やします。'),
        ('ja-aid', '応急手当の手引き', '防災', 'first-aid', 'documents/ja/a.pdf', 1, '止血の方法：傷口を清潔な布で強く押さえます。ＡＥＤの使い方も覚えましょう。'),
        ('en-water', 'Safe water', 'Water', 'water', 'documents/w.pdf', 1, 'boil water for one minute before drinking')]


def search_db(path=':memory:', japanese=True):
    con = sqlite3.connect(path)
    con.execute(PAGES)
    con.executemany('INSERT INTO pages VALUES (?,?,?,?,?,?,?)', ROWS)
    if japanese:
        ja_search.build(con)
    con.commit()
    return con


class JapaneseSearch(unittest.TestCase):
    def test_question_becomes_words(self):
        self.assertEqual(ja_search.words('水を煮沸する方法'), ['煮沸', '水'])
        self.assertEqual(ja_search.words('流水'), ['流水'])                 # a one-character word never cuts a longer one
        self.assertEqual(ja_search.words('やけどの応急手当'), ['やけど', '応急手当'])   # known words across scripts
        self.assertEqual(ja_search.words('ＡＥＤの使い方'), ['aed'])          # full-width to ASCII; 使い方 says nothing
        self.assertEqual(ja_search.words('おむつ'), ['おむつ'])              # all hiragana: kept when nothing else is left
        self.assertEqual(ja_search.words('water filter'), [])               # English is left to the English search
        self.assertEqual(ja_search.words('ハチに刺された'), ['ハチ', '刺された'])

    def test_text_is_stored_in_two_character_pieces(self):
        self.assertEqual(ja_search.grams('応急手当').split(), ['応急', '急手', '手当', '当'])
        self.assertEqual(ja_search.grams('ﾊﾟﾝ and AED').split(), ['パン', 'ン', 'and', 'aed'])

    def test_words_inside_sentences_are_found(self):
        con = search_db()
        hits = lambda q: [(d, p) for d, p, _, _ in ja_search.search(con, q)]
        self.assertEqual(hits('煮沸'), [('ja-manual', 3)])
        self.assertEqual(hits('止血'), [('ja-aid', 1)])
        self.assertEqual(hits('流水')[0], ('ja-manual', 4))
        self.assertIn(('ja-manual', 3), hits('水'))                         # one character: anywhere in a word
        self.assertEqual(hits('aedの使い方'), [('ja-aid', 1)])
        self.assertEqual(hits('こんにちは'), [])

    def test_the_old_index_still_cannot_and_english_is_untouched(self):
        con = search_db()
        self.assertEqual(con.execute("SELECT count(*) FROM pages WHERE pages MATCH '\"煮沸\"'").fetchone()[0], 0)
        self.assertEqual(con.execute("SELECT count(*) FROM pages WHERE pages MATCH 'boil'").fetchone()[0], 1)
        self.assertEqual(con.execute('SELECT count(*) FROM pages_ja').fetchone()[0], 3)   # only rows with Japanese

    def test_several_words_relax_to_any(self):
        con = search_db()
        found = {d for d, _, _, _ in ja_search.search(con, '止血と煮沸')}   # no page has both
        self.assertEqual(found, {'ja-aid', 'ja-manual'})

    def test_snippet_is_the_original_text_marked(self):
        (_, _, snip, _), = ja_search.search(search_db(), '煮沸', mark=('[', ']'))
        self.assertIn('飲料水は[煮沸]してから', snip)
        cut = ja_search.snippet('一つ目の文です。二つ目の文で煮沸します。', ['煮沸'], before=8)
        self.assertTrue(cut.startswith('… 二つ目'), cut)                     # starts at a sentence, not mid-word

    def test_no_japanese_table_means_no_japanese_results(self):
        self.assertEqual(ja_search.search(search_db(japanese=False), '煮沸'), [])


class ServerFindsJapanese(unittest.TestCase):
    def test_library_search_and_assistant_find_japanese_pages(self):
        import server, assistant
        with tempfile.TemporaryDirectory() as tmp:
            lib = Path(tmp)
            search_db(str(lib / 'search.sqlite')).close()
            cat = [{'id': d, 'kind': 'pdf', 'path': p, 'title': t, 'category': k, 'collection': c, 'publisher': 'Test', 'bytes': 1}
                   for d, t, c, k, p in dict.fromkeys((r[0], r[1], r[2], r[3], r[4]) for r in ROWS)]
            (lib / 'catalog.json').write_text(json.dumps(cat), encoding='utf-8')
            server.find.cache_clear()
            with patch.object(server, 'LIB', lib), patch.object(server.library, 'DB', lib / 'search.sqlite'), \
                    patch.dict(server._cat, {'mtime': None}), patch.object(assistant, 'INDEX', None), patch.object(assistant, 'S', server):
                found = server.find('水を煮沸する方法')
                ids = [r['id'] for r in found['results']]
                self.assertEqual(ids[0], 'ja-manual')                     # the Japanese page first
                self.assertIn('en-water', ids)                            # and the English one through the glossary
                self.assertIn('<mark>煮沸</mark>', found['results'][0]['hits'][0]['snippet'])
                self.assertEqual([r['id'] for r in server.find('止血')['results']], ['ja-aid'])   # not in the glossary path
                passages = assistant.hybrid('流水で冷やす')
                self.assertIn('ja-manual', [p['doc_id'] for p in passages])
                self.assertEqual(assistant.hybrid('煮沸')[0]['doc_id'], 'ja-manual')   # Japanese source first, as in find()
            server.find.cache_clear()


class Entry:
    def __init__(self, path, title, to=None):
        self.path, self.title, self.to = path, title, to
        self.is_redirect = to is not None

    def get_redirect_entry(self):
        return self.to


class EncyclopediaSearch(unittest.TestCase):
    def test_japanese_question_searches_words_and_puts_the_titled_article_first(self):
        from engine import library
        burn = Entry('A/熱傷', '熱傷')
        entries = {e.path: e for e in [burn, Entry('A/やけど', 'やけど', burn), Entry('A/止血', '止血'), Entry('A/低温やけど', '低温やけど')]}
        asked = []

        class Arc:
            def get_entry_by_path(self, p):
                return entries[p]

        class Query:
            def set_query(self, q):
                asked.append(q)
                return self

        class Results:
            def __init__(self, paths):
                self.paths = paths

            def getResults(self, start, n):
                return self.paths[start:start + n]

        class Searcher:
            def __init__(self, arc):
                pass

            def search(self, query):
                return Results(['A/止血', 'A/熱傷'])

        class Suggest:
            def __init__(self, arc):
                pass

            def suggest(self, w):
                return Results(['A/やけど', 'A/低温やけど'] if w == 'やけど' else [])

        with patch('libzim.suggestion.SuggestionSearcher', Suggest):
            got = [e.title for e in library.zim_hits(Arc(), 'やけどの手当て', Searcher, Query)]
            self.assertEqual(got, ['熱傷', '止血'])          # やけど is a redirect to 熱傷: first, and listed once
            self.assertEqual(asked, ['やけど 手当'])           # the words, not the sentence
            asked.clear()
            library.zim_hits(Arc(), 'burn first aid', Searcher, Query)
            self.assertEqual(asked, ['burn first aid'])        # English goes to the encyclopedia as it was typed


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

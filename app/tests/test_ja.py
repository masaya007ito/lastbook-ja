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
        self.assertIn('とり', ja_search.grams('ひ\nとりで').split())          # a line the PDF wrapped is joined again
        self.assertEqual(ja_search.grams('水\nwater').split(), ['水', 'water'])

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

    def test_an_article_titled_as_the_whole_question_beats_its_fragments(self):
        from engine import library, ja_search
        self.assertEqual(ja_search.words('関ヶ原の戦い'), ['関ヶ原', '戦'])   # ヶ does not cut the place name
        titles = ['関ヶ原の戦い', '関ヶ原', '戦', '南海', 'トラフ', '地震', '全文の記事']
        entries = {'A/' + t: Entry('A/' + t, t) for t in titles}

        class Arc:
            def get_entry_by_path(self, p):
                return entries[p]

        class Query:
            def set_query(self, q):
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
                return Results(['A/全文の記事'])

        class Suggest:
            def __init__(self, arc):
                pass

            def suggest(self, w):
                return Results(['A/' + t for t in titles if t.startswith(w)])

        with patch('libzim.suggestion.SuggestionSearcher', Suggest):
            got = [e.title for e in library.zim_hits(Arc(), '関ヶ原の戦い', Searcher, Query)]
            self.assertEqual(got, ['関ヶ原の戦い', '全文の記事'])        # the fragments 関ヶ原 and 戦 are not listed
            got = [e.title for e in library.zim_hits(Arc(), '南海トラフ地震', Searcher, Query)]
            self.assertEqual(got, ['トラフ', '地震', '南海', '全文の記事'])  # no whole title: words, longest first


def tiny_pdf(text):
    """A one-page PDF whose text layer is text (ASCII)."""
    content = f'BT /F1 12 Tf 72 720 Td ({text}) Tj ET'.encode()
    objs = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
            b'<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream',
            b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    out, offsets = bytearray(b'%PDF-1.4\n'), []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f'{i} 0 obj\n'.encode() + o + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode() + b''.join(f'{o:010d} 00000 n \n'.encode() for o in offsets)
    out += f'trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return bytes(out)


class JapaneseLibraryTool(unittest.TestCase):
    """tools/ja_library.py build and install, offline, with files standing in for downloads."""

    def test_build_and_install(self):
        import ja_library as J
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            entries = [
                {'id': 'ja-book-1', 'group': 'ja-book', 'part': 1, 'title': '手引き 1', 'document_title': '防災の手引き', 'publisher': '某市',
                 'url': 'https://example.invalid/a/p1.pdf', 'kind': 'pdf', 'category': 'disaster-response', 'licence': 'CC BY 4.0'},
                {'id': 'ja-book-2', 'group': 'ja-book', 'part': 2, 'title': '手引き 2', 'publisher': '某市',
                 'url': 'https://example.invalid/a/p2.pdf', 'kind': 'pdf'},
                {'id': 'ja-web', 'title': '応急手当のページ', 'publisher': '某庁', 'url': 'https://example.invalid/b/aid', 'kind': 'html',
                 'category': 'first-aid', 'licence': '個人利用のみ'}]
            dl = tmp / 'dl'
            for e, body in [(entries[0], tiny_pdf('first chapter')), (entries[1], tiny_pdf('second chapter'))]:
                J.local_path(dl, e).parent.mkdir(parents=True, exist_ok=True)
                J.local_path(dl, e).write_bytes(body)
            J.local_path(dl, entries[2]).parent.mkdir(parents=True, exist_ok=True)
            J.local_path(dl, entries[2]).write_text('<html><body><nav>メニュー</nav><main><h2>止血</h2><p>傷口を清潔な布で強く押さえます。</p>'
                                                    '<script>alert(1)</script></main></body></html>', encoding='utf-8')
            records, missing = J.build(entries, dl, tmp / 'addon')
            self.assertEqual(missing, [])
            by = {r['id']: r for r in records}
            self.assertEqual(by['ja-book']['pages'], 2)                          # two chapter files, one book
            self.assertEqual(by['ja-book']['title'], '防災の手引き')
            page = (tmp / 'addon' / 'library-data' / by['ja-web']['path']).read_text(encoding='utf-8')
            self.assertIn('傷口を清潔な布で', page)
            self.assertNotIn('script', page)
            self.assertNotIn('メニュー', page)
            self.assertIn('ja-sources', by)

            data = tmp / 'LastbookData'
            J.install(tmp / 'addon', data)                                      # a new library
            J.install(tmp / 'addon', data)                                      # again: replaces, never doubles
            lib = data / 'library-data'
            cat = json.loads((lib / 'catalog.json').read_text(encoding='utf-8'))
            self.assertEqual(sorted(r['id'] for r in cat), ['ja-book', 'ja-sources', 'ja-web'])
            con = sqlite3.connect(lib / 'search.sqlite')
            self.assertEqual(con.execute("SELECT count(*) FROM pages WHERE doc_id='ja-book'").fetchone()[0], 2)
            self.assertEqual([d for d, _, _, _ in ja_search.search(con, '止血')], ['ja-web'])
            con.close()

            other = tmp / 'English'                                             # an existing library keeps its own records
            (other / 'library-data').mkdir(parents=True)
            (other / 'library-data' / 'catalog.json').write_text(json.dumps([{'id': 'en-water', 'kind': 'pdf', 'path': 'documents/w.pdf', 'title': 'Water'}]))
            search_db(str(other / 'library-data' / 'search.sqlite'), japanese=False).close()
            J.install(tmp / 'addon', other)
            cat = json.loads((other / 'library-data' / 'catalog.json').read_text(encoding='utf-8'))
            self.assertIn('en-water', [r['id'] for r in cat])
            con = sqlite3.connect(other / 'library-data' / 'search.sqlite')
            self.assertEqual(con.execute("SELECT count(*) FROM pages WHERE pages MATCH 'boil'").fetchone()[0], 1)
            self.assertIn('ja-web', [d for d, _, _, _ in ja_search.search(con, '止血')])
            con.close()


def chars(spec):
    """Characters of a PDF page for ja_library.mend: (text, left, bottom, height) laid out one character 10 wide,
    each piece followed by the reader's own line break unless it is the last."""
    out = []
    for n, (s, left, bottom, height) in enumerate(spec):
        out += [[ch, False, left + 10 * i, bottom, height] for i, ch in enumerate(s)]
        if n < len(spec) - 1:
            out += [['\r', True, 0, 0, 0], ['\n', True, 0, 0, 0]]
    return out, ''.join(c[0] for c in out)


class PdfText(unittest.TestCase):
    """Ruby printed inline and lines read right to left are mended before the text is indexed."""

    def test_ruby_is_dropped_and_the_word_joined(self):
        import ja_library as J
        # 心肺 with the small reading しんぱい over each kanji, read in between, as a PDF reader gives it.
        got = J.mend(*chars([('心', 0, 0, 14), ('しん', 0, 10, 7), ('肺', 30, 0, 14), ('ぱい', 30, 10, 7), ('蘇生', 60, 0, 14)]))
        self.assertEqual(got, '心肺蘇生')
        self.assertIn('心肺蘇生', ja_search.unwrap(got))

    def test_small_text_throughout_is_kept(self):
        import ja_library as J
        page = chars([('注意：火の元を確かめる', 0, 0, 7)])
        self.assertEqual(J.mend(*page), '注意：火の元を確かめる')
        # A large heading, then smaller text beside it and on the line below: neither is ruby.
        page = chars([('注意', 0, 40, 20), ('ケガに', 45, 40, 10), ('あわてて飛びださない', 0, 0, 10)])
        self.assertEqual(J.mend(*page), '注意\nケガに\nあわてて飛びださない')
        # A headline: a small line set above a large one runs past its kanji.
        page = chars([('あなたとペットは', 0, 30, 10), ('大丈夫？', 0, 0, 20)])
        self.assertEqual(J.mend(*page), 'あなたとペットは\n大丈夫？')
        # A page turned on its side: the next character reads as higher up, but it is not ruby.
        side = [[ch, False, 0, 10 * i, 10 if ch in '水害' else 6] for i, ch in enumerate('水害リスク')]
        self.assertEqual(J.mend(side, '水害リスク'), '水害リスク')

    def test_a_line_read_right_to_left_is_put_back_in_page_order(self):
        import ja_library as J
        # 「最新の情報を確認しましょう。（代表）」 read in two pieces, the second first, with the bracket turned around.
        out = [[ch, False, 70 + 10 * i, 0, 10] for i, ch in enumerate('確認しましょう。')]
        out += [[ch, False, 10 * i, 0, 10] for i, ch in enumerate('最新の情報を(')]
        text = ''.join(c[0] for c in out)
        self.assertEqual(J.mend(out, text), '最新の情報を)確認しましょう。')

    def test_a_page_in_order_is_returned_as_read(self):
        import ja_library as J
        page = chars([('止血の方法', 0, 20, 10), ('傷口を押さえる', 0, 0, 10)])
        self.assertEqual(J.mend(*page), '止血の方法\n傷口を押さえる')
        vertical = [[ch, False, 0, 100 - 10 * i, 10] for i, ch in enumerate('縦書きの文')]
        self.assertEqual(J.mend(vertical, '縦書きの文'), '縦書きの文')   # one column: not a line read backwards


class JapanesePagesInGuides(unittest.TestCase):
    def test_japanese_pages_come_first_and_only_when_held(self):
        import server
        item = {'doc': 'ja-manual', 'page': 4, 'label': 'やけどは流水で冷やす', 'note': '流水で冷やす手順です。'}
        gone = {'doc': 'ja-not-here', 'page': 1, 'label': 'ない資料', 'note': 'この書庫にはありません。'}
        with tempfile.TemporaryDirectory() as tmp:
            lib = Path(tmp)
            (lib / 'catalog.json').write_text(json.dumps([{'id': 'ja-manual', 'kind': 'pdf', 'path': 'documents/ja/m.pdf', 'title': '市民防災マニュアル'}]), encoding='utf-8')
            with patch.object(server, 'LIB', lib), patch.dict(server._cat, {'mtime': None}), \
                    patch.object(server, 'local_reads', lambda lang: {'hurt': {'choices': {'burn': [item, gone]}}} if lang == 'ja' else {}):
                burn = lambda lang: next((c for t in server.topics_resolved(lang) if t['id'] == 'hurt' for c in t['choices'] if c['id'] == 'burn'), {'read': []})
                self.assertEqual([i.get('doc') for i in burn('ja')['read']][:1], ['ja-manual'])     # first, and the absent one dropped
                self.assertNotIn('ja-not-here', [i.get('doc') for i in burn('ja')['read']])
                self.assertNotIn('ja-manual', [i.get('doc') for i in burn('en')['read']])          # English guides as they were

    def test_a_translated_page_comes_just_before_its_original(self):
        import server
        burn = json.loads((ROOT / 'content' / 'topics' / 'hurt.json').read_text(encoding='utf-8'))
        first = next(c for c in burn['choices'] if c['id'] == 'burn')['read'][0]
        tid = f"ja-tr-{first['doc']}-p{first.get('page') or 0}"
        with tempfile.TemporaryDirectory() as tmp:
            lib = Path(tmp)
            (lib / 'catalog.json').write_text(json.dumps([{'id': first['doc'], 'kind': 'pdf', 'path': 'documents/x.pdf', 'title': 'Burns'},
                                                          {'id': tid, 'kind': 'html', 'path': 'pages/ja/tr/x.html', 'title': '【日本語訳】Burns'}]), encoding='utf-8')
            with patch.object(server, 'LIB', lib), patch.dict(server._cat, {'mtime': None}), patch.object(server, 'local_reads', lambda lang: {}):
                pick = lambda lang: next(c for t in server.topics_resolved(lang) if t['id'] == 'hurt' for c in t['choices'] if c['id'] == 'burn')['read']
                ja = pick('ja')
                self.assertEqual([i['doc'] for i in ja[:2]], [tid, first['doc']])
                self.assertTrue(ja[0]['translated'])
                self.assertEqual(server.trust({'translation_of': {'doc': 'x'}, 'publisher': 'FEMA'})[0], 'AI translation (not checked by an expert)')
                self.assertIn('AI', ja[0]['note'])
                self.assertNotIn(tid, [i['doc'] for i in pick('en')])                  # English: no translation

    def test_translations_become_records(self):
        import ja_library as J
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            (t / 'ja').mkdir()
            (t / 'src').mkdir()
            (t / 'src' / 'doc1__p5.txt').write_text('SOURCE: Water Manual\nPUBLISHER: Agency\nPAGE: 5\n========\nBoil water.', encoding='utf-8')
            (t / 'ja' / 'doc1__p5.md').write_text('## 煮沸\n\n水を煮沸します。\n\n- 1分間\n⚠ 飲まないでください。', encoding='utf-8')
            (t / 'lib' / 'pages').mkdir(parents=True)
            recs, rows = J.translated(t, t / 'lib')
            self.assertEqual(recs[0]['id'], 'ja-tr-doc1-p5')
            self.assertEqual(recs[0]['translation_of'], {'doc': 'doc1', 'page': 5})
            page = (t / 'lib' / recs[0]['path']).read_text(encoding='utf-8')
            self.assertIn('<h3>煮沸</h3>', page)
            self.assertIn('<li>1分間</li>', page)
            self.assertIn('class="warn"', page)
            self.assertIn('Water Manual', page)
            self.assertIn('煮沸', rows[0][6])

    def test_the_page_list_points_at_real_places(self):
        import check_ja_local
        f = ROOT / 'content' / 'local-ja.json'
        if not f.exists():
            self.skipTest('no content/local-ja.json yet')
        probs, _ = check_ja_local.check(json.loads(f.read_text(encoding='utf-8')))
        self.assertEqual(probs, [])

    def test_checker_catches_a_wrong_place(self):
        import check_ja_local
        bad = {'topics': {'hurt': {'choices': {'nope': [{'doc': 'x', 'page': 1, 'label': 'ラベル', 'note': 'ノート'}],
                                               'burn': [{'doc': 'x', 'page': 0, 'label': 'ラベル', 'note': 'ノート'}]}},
                          'nowhere': {}}}
        probs, _ = check_ja_local.check(bad)
        self.assertEqual(len(probs), 3)


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

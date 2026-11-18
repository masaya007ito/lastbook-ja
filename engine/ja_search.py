"""Keyword search inside Japanese text.

The library's search table (`pages`, FTS5 unicode61) reads a run of Japanese characters as one long word, because Japanese
has no spaces: 「飲料水は煮沸してから使います」 is a single token, so 煮沸 finds nothing. This module keeps a second table,
`pages_ja`, in the same search.sqlite. It holds only the rows that contain Japanese, with each Japanese run cut into
overlapping two-character pieces (応急手当 -> 応急 急手 手当 当) and the run's last character on its own, so a word of any
length is a phrase of consecutive pieces and a single character is a prefix. Its rowid is the rowid of the same row in
`pages`, so the text shown in results is read from `pages` and is never stored twice.

The English table is never changed. A search.sqlite without `pages_ja` simply has no Japanese results.

    python -m engine.ja_search path/to/search.sqlite    # add or rebuild pages_ja in an existing search file
"""
import re, sqlite3, sys, unicodedata

from engine import ja_terms

TABLE = 'pages_ja'
# Hiragana, katakana (not the middle dot ・), the prolonged sound mark, 々 〆, CJK ideographs and compatibility ideographs.
RUN = re.compile(r'[ぁ-ゟ゠-ヺー-ヿ々〆㐀-䶿一-鿿豈-﫿]+')
# The small ヵ ヶ count as kanji, as in place names (関ヶ原, 霞ヶ浦), so they never cut a kanji word in two.
SCRIPT = re.compile(r'[ぁ-ゟ]+|[゠-ヴヷ-ヺー-ヿ]+|[ヵヶ々〆㐀-䶿一-鿿豈-﫿]+')
HIRAGANA = re.compile(r'[ぁ-ゟ]+')
LATIN = re.compile(r'[0-9a-z]+(?:[.-][0-9a-z]+)*')
# Words a question is built from that say nothing about the subject.
STOP = {'方法', '仕方', 'やり方', '使い方', '作り方', '場合', '時', 'とき', '時間', 'こと', 'もの', 'ため', '何', 'なに', 'どう',
        'どうやって', 'どうすれば', 'について', 'ください', 'したい', 'できる', '教えて', 'おしえて', 'いい', 'よい', 'する',
        'した', 'して', 'ない', 'です', 'ます', 'から', 'まで', 'など', 'それ', 'これ', '何を', '大丈夫', '必要', '注意',
        '気をつける', '方', '的'}
# Known words of two or more characters, taken whole even when they mix scripts (やけど, 喉に詰まった). One-character words
# (水, 血) are left to the script split, so they never cut a longer kanji word (流水 stays 流水).
KNOWN = sorted({k for k in ja_terms.TERMS if RUN.fullmatch(k) and len(k) > 1} | {s for s in STOP if len(s) > 1},
               key=len, reverse=True)
SCHEMA = f'CREATE VIRTUAL TABLE {TABLE} USING fts5(doc_id UNINDEXED,page UNINDEXED,title,body,tokenize="unicode61 remove_diacritics 0")'


def norm(text):
    """Full-width letters and digits to ASCII, half-width katakana to full-width, lower case."""
    return unicodedata.normalize('NFKC', text or '').lower()


# A line break between two Japanese characters is where a PDF wrapped a line, not a word boundary (ひ/とり is ひとり).
WRAP = re.compile(r'(?<=[ぁ-ゟ゠-ヺー-ヿ々〆㐀-䶿一-鿿豈-﫿])[ \t\u3000]*\n[ \t\u3000]*(?=[ぁ-ゟ゠-ヺー-ヿ々〆㐀-䶿一-鿿豈-﫿])')


def unwrap(text):
    return WRAP.sub('', text)


def has_japanese(text):
    return bool(RUN.search(norm(text)))


def _pieces(run):
    return [run] if len(run) == 1 else [run[i:i + 2] for i in range(len(run) - 1)] + [run[-1]]


def grams(text):
    """Text as the pages_ja table stores it: Japanese runs as two-character pieces, everything else as it was."""
    text = unwrap(norm(text))
    out, at = [], 0
    for m in RUN.finditer(text):
        out.append(text[at:m.start()])
        out.append(' ' + ' '.join(_pieces(m.group())) + ' ')
        at = m.end()
    out.append(text[at:])
    return ''.join(out)


def words(q):
    """The search words in a question: known survival words first (longest match), then runs of kanji or katakana.
    Hiragana is kept only when nothing else is left (a question written all in hiragana). Latin words are kept
    when the question has Japanese in it; a question with none is left to the English search."""
    q = norm(q)
    if not RUN.search(q):
        return []
    found, rest = [], []
    for m in RUN.finditer(q):
        run, i, chunk = m.group(), 0, ''
        while i < len(run):
            hit = next((t for t in KNOWN if run.startswith(t, i)), None)
            if hit:
                if chunk:
                    rest.append(chunk)
                    chunk = ''
                found.append(hit)
                i += len(hit)
            else:
                chunk += run[i]
                i += 1
        if chunk:
            rest.append(chunk)
    strong, soft = [], []
    for chunk in rest:
        for s in SCRIPT.findall(chunk):
            (soft if HIRAGANA.fullmatch(s) else strong).append(s)
    out = [w for w in found + strong if w not in STOP]
    if not out:
        out = [w for w in soft if len(w) >= 2 and w not in STOP]
    out += [w for w in LATIN.findall(q) if len(w) > 1]
    seen = set()
    return [w for w in out if not (w in seen or seen.add(w))]


def _phrase(word):
    if RUN.fullmatch(word):
        p = _pieces(word)
        if len(word) == 1:
            return '"' + word + '"*'
        return '"' + ' '.join(p[:-1]) + '"'
    return '"' + word.replace('"', '""') + '"'


def expression(ws, every=True):
    return (' AND ' if every else ' OR ').join(_phrase(w) for w in ws)


def present(con):
    return bool(con.execute("SELECT 1 FROM sqlite_master WHERE name=?", (TABLE,)).fetchone())


def snippet(body, ws, mark=('', ''), before=30, after=70):
    """A window of the original text around the first search word, with the words marked."""
    body = re.sub(r'\s+', ' ', unwrap(norm(body))).strip()
    spots = [body.find(w) for w in ws if body.find(w) >= 0]
    at = min(spots) if spots else 0
    lo, hi = max(0, at - before), min(len(body), at + after)
    if lo:   # start at the beginning of a sentence when one begins inside the window
        cut = max(body.rfind(c, lo, at) for c in '。！？ ')
        if cut >= 0:
            lo = cut + 1
    piece = body[lo:hi]
    if mark != ('', ''):
        for w in sorted(set(ws), key=len, reverse=True):
            piece = piece.replace(w, '\u0000' + w + '\u0003')
        piece = piece.replace('\u0000', mark[0]).replace('\u0003', mark[1])
    return ('… ' if lo else '') + piece + (' …' if hi < len(body) else '')


def search(con, q, limit=200, mark=('', '')):
    """Rows (doc_id, page, snippet, score) for the Japanese words in q, best first; score is bm25 (lower is better).
    All words must match; when that finds fewer than 8 rows and there are several words, any word may match."""
    ws = words(q)
    if not ws or not present(con):
        return []
    sql = (f'SELECT j.doc_id,j.page,p.body,bm25({TABLE},0,0,5,1) FROM {TABLE} j JOIN pages p ON p.rowid=j.rowid '
           f'WHERE {TABLE} MATCH ? ORDER BY bm25({TABLE},0,0,5,1) LIMIT ?')
    try:
        rows = con.execute(sql, (expression(ws), limit)).fetchall()
        if len(rows) < 8 and len(ws) > 1:
            got = {(d, p) for d, p, _, _ in rows}
            rows += [r for r in con.execute(sql, (expression(ws, False), limit)).fetchall() if (r[0], r[1]) not in got]
    except sqlite3.OperationalError:
        return []
    return [(d, p, snippet(body, ws, mark), score) for d, p, body, score in rows]


def build(con):
    """(Re)make pages_ja from the Japanese rows of pages. Returns the number of rows indexed."""
    con.execute(f'DROP TABLE IF EXISTS {TABLE}')
    con.execute(SCHEMA)
    n = 0
    batch = []
    for rowid, doc_id, page, title, body in con.execute('SELECT rowid,doc_id,page,title,body FROM pages'):
        if RUN.search(title or '') or RUN.search(body or ''):
            batch.append((rowid, doc_id, page, grams(title), grams(body)))
            n += 1
    con.executemany(f'INSERT INTO {TABLE}(rowid,doc_id,page,title,body) VALUES(?,?,?,?,?)', batch)
    con.execute(f"INSERT INTO {TABLE}({TABLE}) VALUES('optimize')")
    return n


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__.split('\n\n')[-1].strip())
    c = sqlite3.connect(sys.argv[1])
    print(f'{build(c)} Japanese rows indexed in {TABLE}')
    c.commit()
    c.close()

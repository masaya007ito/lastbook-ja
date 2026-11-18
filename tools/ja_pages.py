#!/usr/bin/env python3
"""Find and read pages of the Japanese sources in a library, for choosing guide citations.

    python3 tools/ja_pages.py --data DATA find 止血 [--doc DOC_ID] [-n 15]   # pages with these words, best first
    python3 tools/ja_pages.py --data DATA show DOC_ID PAGE [PAGE ...]      # the full text of pages
    python3 tools/ja_pages.py --data DATA docs                             # the Japanese documents: id, pages, title

Reads library-data/search.sqlite and catalog.json read-only. No server, no network.
"""
import argparse, json, sqlite3, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import ja_search  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('command', choices=['find', 'show', 'docs'])
    ap.add_argument('args', nargs='*')
    ap.add_argument('--doc')
    ap.add_argument('-n', type=int, default=15)
    a = ap.parse_args(argv)
    lib = Path(a.data) / 'library-data'
    con = sqlite3.connect((lib / 'search.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    cat = {r['id']: r for r in json.loads((lib / 'catalog.json').read_text(encoding='utf-8'))}
    if a.command == 'docs':
        for r in cat.values():
            if r.get('language') == 'ja' and r['kind'] != 'zim':
                print(f'{r["id"]}\t{r.get("pages") or "-"}p\t{r["title"]}\t{r["publisher"]}')
    elif a.command == 'find':
        rows = ja_search.search(con, ' '.join(a.args), 400, ('【', '】'))
        if a.doc:
            rows = [r for r in rows if r[0] == a.doc]
        rows = [r for r in rows if cat.get(r[0], {}).get('language') == 'ja']
        for d, p, snip, score in rows[:a.n]:
            print(f'{d}\tp.{p}\t{cat[d]["title"][:30]}\t{snip}')
    else:
        doc, pages = a.args[0], a.args[1:]
        for p in pages:
            row = con.execute('SELECT body FROM pages WHERE doc_id=? AND page=?', (doc, int(p))).fetchone()
            print(f'===== {doc} p.{p} ({cat.get(doc, {}).get("title")}) =====')
            print(ja_search.unwrap(row[0]) if row else '(no text on this page)')


if __name__ == '__main__':
    main()

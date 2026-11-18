#!/usr/bin/env python3
"""content/local-ja.json: Japanese pages read first in the guides. Every entry must point at a real place in a guide and,
with --data, at a real page of a Japanese source in that library whose text says what the label says.

    python3 tools/check_ja_local.py                       # structure only (no library needed)
    python3 tools/check_ja_local.py --data DATA           # also each page, in the library at DATA
    python3 tools/check_ja_local.py --file other.json --data DATA

Exit 1 on any problem. "weak" lines are warnings: none of the label's words were found on the page; read it again.
"""
import argparse, json, re, sqlite3, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import ja_search  # noqa: E402

JA = re.compile(r'[ぁ-んァ-ヶ一-龯]')


def check(local, data=None):
    probs, weak = [], []
    topics = {f.stem: json.loads(f.read_text(encoding='utf-8')) for f in (ROOT / 'content' / 'topics').glob('*.json')}
    con = cat = None
    if data:
        lib = Path(data) / 'library-data'
        con = sqlite3.connect((lib / 'search.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
        cat = {r['id']: r for r in json.loads((lib / 'catalog.json').read_text(encoding='utf-8'))}
    seen = set()
    for tid, parts in local.get('topics', {}).items():
        if tid not in topics:
            probs.append(f'{tid}: no such guide')
            continue
        t = topics[tid]
        for k, v in parts.items():
            if k in ('choices', 'route'):
                ids = {c.get('id') for c in t.get(k, [])}
                groups = v.items()
                for cid, _ in groups:
                    if cid not in ids:
                        probs.append(f'{tid}/{k}/{cid}: no such {k[:-1] if k == "choices" else "step"} in the guide')
            elif k in ('prepare', 'learn'):
                groups = [(k, v)]
            else:
                probs.append(f'{tid}: unknown part {k}')
                continue
            for cid, items in groups:
                for n, i in enumerate(items):
                    where = f'{tid}/{k}/{cid}#{n}'
                    if not isinstance(i.get('doc'), str) or not isinstance(i.get('page'), int) or i['page'] < 1:
                        probs.append(f'{where}: needs doc and a page number')
                        continue
                    for f in ('label', 'note'):
                        if not JA.search(i.get(f) or ''):
                            probs.append(f'{where}: {f} missing or not Japanese')
                    key = (tid, k, cid, i['doc'], i['page'])
                    if key in seen:
                        probs.append(f'{where}: the same page twice')
                    seen.add(key)
                    if not cat:
                        continue
                    r = cat.get(i['doc'])
                    if not r:
                        probs.append(f'{where}: {i["doc"]} is not in this library')
                        continue
                    if r.get('language') != 'ja':
                        probs.append(f'{where}: {i["doc"]} is not a Japanese source')
                    if r.get('pages') and i['page'] > r['pages']:
                        probs.append(f'{where}: {i["doc"]} has {r["pages"]} pages, not {i["page"]}')
                        continue
                    row = con.execute('SELECT body FROM pages WHERE doc_id=? AND page=?', (i['doc'], i['page'])).fetchone()
                    if not row:
                        probs.append(f'{where}: {i["doc"]} p.{i["page"]} has no text')
                        continue
                    text = ja_search.norm(ja_search.unwrap(row[0]))
                    ws = [w for w in ja_search.words(i['label']) if len(w) > 1]
                    if ws and not any(w in text for w in ws):
                        weak.append(f'{where}: {i["doc"]} p.{i["page"]}: none of {ws} on the page')
    return probs, weak


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', default=str(ROOT / 'content' / 'local-ja.json'))
    ap.add_argument('--data')
    a = ap.parse_args(argv)
    local = json.loads(Path(a.file).read_text(encoding='utf-8'))
    probs, weak = check(local, a.data)
    for p in probs:
        print('PROBLEM', p)
    for w in weak:
        print('weak', w)
    n = sum(len(x) for t in local.get('topics', {}).values() for v in t.values() for x in (v.values() if isinstance(v, dict) else [v]))
    print(f'{n} pages cited, {len(probs)} problems, {len(weak)} weak')
    sys.exit(1 if probs else 0)


if __name__ == '__main__':
    main()

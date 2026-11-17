#!/usr/bin/env python3
"""Check that each Japanese guide (content/topics-ja/<id>.json) matches its English original in everything but words.

A translation must keep every id, doc, page, zim path, mode, related list and the order and number of items, so that it
cites exactly the pages the English guide cites. Only the reader-facing text fields may differ, and `keywords`
may be any list. When the English guide changes upstream, this check names what the translation is missing.

    python3 tools/check_ja_topics.py            # all guides; exit 1 on any problem
    python3 tools/check_ja_topics.py water      # one guide
Also checks content/gaps-ja.json against content/gaps.json (same ids, same number of lines in each list).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN, JA = ROOT / 'content' / 'topics', ROOT / 'content' / 'topics-ja'
TEXT = {'title', 'short', 'intro', 'label', 'hint', 'note', 'text', 'goal'}   # words a reader sees
FREE = {'keywords'}
JA_CHARS = re.compile(r'[぀-ヿ㐀-鿿]')


def compare(en, ja, path, out):
    if isinstance(en, dict):
        if not isinstance(ja, dict):
            return out.append(f'{path}: should be an object')
        for k in en.keys() - ja.keys():
            out.append(f'{path}.{k}: missing')
        for k in ja.keys() - en.keys():
            out.append(f'{path}.{k}: not in the English guide')
        for k in en.keys() & ja.keys():
            p = f'{path}.{k}'
            if k in FREE:
                if not isinstance(ja[k], list) or not all(isinstance(x, str) for x in ja[k]):
                    out.append(f'{p}: should be a list of words')
            elif k in TEXT and isinstance(en[k], str):
                if not isinstance(ja[k], str) or not ja[k].strip():
                    out.append(f'{p}: should be text')
                elif k != 'title' or 'zim' not in en:   # an encyclopedia article keeps its own (English) title
                    if not JA_CHARS.search(ja[k]):
                        out.append(f'{p}: not translated ({ja[k][:40]!r})')
            else:
                compare(en[k], ja[k], p, out)
    elif isinstance(en, list):
        if not isinstance(ja, list) or len(en) != len(ja):
            return out.append(f'{path}: should have {len(en)} items, has {len(ja) if isinstance(ja, list) else "none"}')
        for i, (a, b) in enumerate(zip(en, ja)):
            compare(a, b, f'{path}[{i}]', out)
    elif en != ja:
        out.append(f'{path}: {ja!r} differs from the English {en!r}')
    return out


def check(names=None):
    problems = {}
    for f in sorted(EN.glob('*.json')):
        if names and f.stem not in names:
            continue
        j = JA / f.name
        if not j.is_file():
            problems[f.stem] = ['no Japanese file yet']
            continue
        try:
            out = compare(json.loads(f.read_text(encoding='utf-8')), json.loads(j.read_text(encoding='utf-8')), f.stem, [])
        except ValueError as e:
            out = [f'not valid JSON: {e}']
        if out:
            problems[f.stem] = out
    if not names:
        g_en, g_ja = ROOT / 'content' / 'gaps.json', ROOT / 'content' / 'gaps-ja.json'
        if not g_ja.is_file():
            problems['gaps'] = ['no gaps-ja.json yet']
        else:
            en, ja, out = json.loads(g_en.read_text(encoding='utf-8')), json.loads(g_ja.read_text(encoding='utf-8')), []
            for k, v in en.items():
                for kind, lines in v.items():
                    got = (ja.get(k) or {}).get(kind)
                    if not isinstance(got, list) or len(got) != len(lines):
                        out.append(f'{k}.{kind}: should have {len(lines)} lines')
                    elif not all(isinstance(x, str) and JA_CHARS.search(x) for x in got):
                        out.append(f'{k}.{kind}: a line is not translated')
            for k in ja.keys() - en.keys():
                out.append(f'{k}: not in gaps.json')
            if out:
                problems['gaps'] = out
    return problems


if __name__ == '__main__':
    probs = check(set(sys.argv[1:]) or None)
    for name, lines in probs.items():
        print(f'{name}:')
        for line in lines[:40]:
            print('  ' + line)
        if len(lines) > 40:
            print(f'  … {len(lines) - 40} more')
    print('OK' if not probs else f'{len(probs)} file(s) with problems')
    sys.exit(1 if probs else 0)

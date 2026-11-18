#!/usr/bin/env python3
"""Japanese sources for a personal library: fetch them, build them into an add-on, install the add-on into a data folder.

    python3 tools/ja_library.py fetch   --downloads DIR                 # official files, kept as they came
    python3 tools/ja_library.py build   --downloads DIR --out ADDON     # one PDF per document, text, search, catalog
    python3 tools/ja_library.py install --addon ADDON --data DATA       # into a LastbookData folder (made if absent)
    python3 tools/ja_library.py ocr     --addon ADDON --downloads DIR   # Mac: read pages that have no text (then build again)
    build --translations TDIR --data DATA                               # also Japanese translations of English pages

The list is content/ja-sources.json. Each entry is one file, or one chapter of a document split into several files
(entries with the same "group", in "part" order, become one PDF so page numbers run through the whole book).
Encyclopedias (kind "zim") are copied as they are.

This is for a library on one's own computer. Several sources allow no redistribution ("licence" says so in each record):
never publish an add-on built from this list.

fetch is the only command that uses the network, and only for the addresses in the list. build and install work offline.
install replaces earlier copies of the same records, so running it again after a new build is safe.
"""
import argparse, datetime, hashlib, html, json, os, re, shutil, sqlite3, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import ja_search  # noqa: E402

SOURCES = ROOT / 'content' / 'ja-sources.json'
COLLECTION = '日本語の資料'
PAGES = 'CREATE VIRTUAL TABLE pages USING fts5(doc_id UNINDEXED,title,collection,category,path UNINDEXED,page UNINDEXED,body,tokenize="unicode61")'
AGENT = 'Mozilla/5.0 (personal offline library)'


def load(path=SOURCES):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    return data['sources'] if isinstance(data, dict) else data


def documents(entries):
    """Entries grouped into documents: [(doc_id, [entries in part order])], in list order."""
    docs = {}
    for e in entries:
        docs.setdefault(e.get('group') or e['id'], []).append(e)
    return [(k, sorted(v, key=lambda e: e.get('part') or 0)) for k, v in docs.items()]


def local_name(e):
    name = urllib.parse.unquote(Path(urllib.parse.urlsplit(e['url']).path).name) or 'index.html'
    if e.get('kind') == 'html' and not name.endswith(('.html', '.htm')):
        name += '.html'
    return name


def local_path(downloads, e):
    if e.get('kind') == 'zim':
        return Path(downloads) / 'zim' / local_name(e)
    return Path(downloads) / 'docs' / (e.get('group') or e['id']) / local_name(e)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


# ------------------------------------------------------------------- fetch --
def fetch(entries, downloads, only=None, zim=True):
    downloads = Path(downloads)
    manifest_path = downloads / 'fetched.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
    failed = []
    for e in entries:
        if (only and e['id'] not in only and e.get('group') not in only) or (not zim and e.get('kind') == 'zim'):
            continue
        dest = local_path(downloads, e)
        if dest.exists() and e['id'] in manifest and manifest[e['id']]['bytes'] == dest.stat().st_size:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + '.part')
        try:
            req = urllib.request.Request(e['url'], headers={'User-Agent': AGENT})
            with urllib.request.urlopen(req, timeout=60) as r, open(part, 'wb') as f:
                final = r.geturl()
                kind = r.headers.get('Content-Type', '')
                shutil.copyfileobj(r, f, 1 << 20)
            if e.get('kind') == 'pdf' and not part.read_bytes()[:5].startswith(b'%PDF'):
                raise ValueError(f'not a PDF ({kind})')
            part.replace(dest)
        except Exception as ex:  # one dead address must not stop the rest
            part.unlink(missing_ok=True)
            failed.append(e['id'])
            print(f'FAILED {e["id"]}: {type(ex).__name__}: {ex}', flush=True)
            continue
        manifest[e['id']] = {'url': e['url'], 'final_url': final, 'bytes': dest.stat().st_size, 'sha256': sha256(dest),
                             'retrieved_at': datetime.date.today().isoformat(), 'file': str(dest.relative_to(downloads))}
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'ok {e["id"]}  {dest.stat().st_size / 1e6:.1f} MB', flush=True)
    return failed


# --------------------------------------------------------------------- ocr --
def recognize(png):
    """Japanese and English text on one page image, by macOS Vision, in reading order (top to bottom)."""
    import Vision
    from Foundation import NSURL
    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    req.setRecognitionLanguages_(['ja-JP', 'en-US'])
    req.setUsesLanguageCorrection_(True)
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(NSURL.fileURLWithPath_(str(png)), None)
    ok, err = handler.performRequests_error_([req], None)
    if not ok:
        raise RuntimeError(str(err))
    lines = []
    for o in req.results() or []:
        c = o.topCandidates_(1)
        if c:
            box = o.boundingBox()
            lines.append((-round(box.origin.y, 2), box.origin.x, c[0].string()))
    return '\n'.join(t for _, _, t in sorted(lines))


def ocr(addon, downloads):
    """Text for the pages of the add-on's PDFs that have none, kept in DIR/ocr/<id>.json for build to use."""
    import tempfile
    import pypdfium2 as pdfium
    lib = Path(addon) / 'library-data'
    out_dir = Path(downloads) / 'ocr'
    out_dir.mkdir(parents=True, exist_ok=True)
    for r in json.loads((lib / 'catalog.json').read_text(encoding='utf-8')):
        if r['kind'] != 'pdf':
            continue
        cache = out_dir / f'{r["id"]}.json'
        done = json.loads(cache.read_text(encoding='utf-8')) if cache.exists() else {}
        pdf = pdfium.PdfDocument(str(lib / r['path']))
        empty = [i for i in range(len(pdf)) if not pdf[i].get_textpage().get_text_range().strip() and str(i + 1) not in done]
        if not empty:
            continue
        with tempfile.TemporaryDirectory() as tmp:
            for i in empty:
                png = Path(tmp) / f'{i}.png'
                pdf[i].render(scale=2.5).to_pil().save(png)
                done[str(i + 1)] = recognize(png)
        cache.write_text(json.dumps(done, ensure_ascii=False, indent=0), encoding='utf-8')
        print(f'ocr {r["id"]}: {len(empty)} pages', flush=True)


# ------------------------------------------------------------------- build --
def pdf_text(path):
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(path))
    out = []
    for i in range(len(pdf)):
        tp = pdf[i].get_textpage()
        out.append(tp.get_text_range().replace('\r\n', '\n').replace('\r', '\n'))
    return out


def merge_pdfs(paths, dest):
    import pypdfium2 as pdfium
    new = pdfium.PdfDocument.new()
    for p in paths:
        new.import_pages(pdfium.PdfDocument(str(p)))
    new.save(str(dest))


KEEP = ('h1', 'h2', 'h3', 'h4', 'p', 'li', 'dt', 'dd', 'th', 'td', 'caption', 'figcaption')


def html_page(raw, title, source_url):
    """The readable text of a web page as a plain local page: headings, paragraphs and lists, nothing that loads."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(raw, 'html.parser')
    for t in soup(['script', 'style', 'noscript', 'nav', 'header', 'footer', 'form', 'iframe', 'svg', 'button', 'aside']):
        t.decompose()
    body = soup.find('main') or soup.find(id=re.compile('main|contents?', re.I)) or soup.find('article') or soup.body or soup
    blocks, seen = [], set()
    for el in body.find_all(KEEP):
        if el.find(KEEP):   # a block holding blocks: its children are taken one by one
            continue
        text = re.sub(r'\s+', ' ', el.get_text(' ', strip=True))
        if not text or text in seen:
            continue
        seen.add(text)
        tag = el.name if el.name in ('h1', 'h2', 'h3', 'h4', 'li') else 'p'
        blocks.append(f'<{tag}>{html.escape(text)}</{tag}>')
    page = ('<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>' + html.escape(title) + '</title></head><body>'
            f'<h1>{html.escape(title)}</h1>' + '\n'.join(b for b in blocks if b != f'<h1>{html.escape(title)}</h1>')
            + f'<p><small>出典：{html.escape(source_url)}（文字だけを抜き出して保存）</small></p></body></html>')
    text = '\n'.join(re.sub(r'<[^>]+>', '', html.unescape(b)) for b in blocks)
    return page, text


def build(entries, downloads, out, translations=None, data=None):
    downloads, out = Path(downloads), Path(out)
    manifest = json.loads((downloads / 'fetched.json').read_text(encoding='utf-8')) if (downloads / 'fetched.json').exists() else {}
    lib = out / 'library-data'
    if lib.exists():
        shutil.rmtree(lib)
    (lib / 'documents' / 'ja').mkdir(parents=True)
    (lib / 'pages' / 'ja').mkdir(parents=True)
    (lib / 'collections').mkdir(parents=True)
    records, rows, missing = [], [], []
    for doc_id, parts in documents(entries):
        files = [local_path(downloads, e) for e in parts]
        if not all(f.exists() for f in files):
            missing.append(doc_id)
            continue
        first = parts[0]
        kind = first.get('kind', 'pdf')
        rec = {'id': doc_id, 'kind': kind, 'title': first.get('document_title') or first['title'], 'publisher': first['publisher'],
               'collection': COLLECTION, 'category': first.get('category') or 'disaster-response',
               'source_url': first.get('page_url') or first['url'], 'license': first.get('licence', ''),
               'retrieved_at': (manifest.get(first['id']) or {}).get('retrieved_at'), 'language': 'ja'}
        if first.get('date'):
            rec['edition'] = first['date']
        note = first.get('note')
        if note:
            rec['notes'] = note
        if kind == 'zim':
            dest = lib / 'collections' / files[0].name
            clone(files[0], dest)
            rec['path'] = f'collections/{dest.name}'
        elif kind == 'pdf':
            dest = lib / 'documents' / 'ja' / f'{doc_id}.pdf'
            if len(files) == 1:
                clone(files[0], dest)
            else:
                merge_pdfs(files, dest)
            texts = pdf_text(dest)
            rec['path'] = f'documents/ja/{dest.name}'
            rec['pages'] = len(texts)
            read = Path(downloads) / 'ocr' / f'{doc_id}.json'
            read = json.loads(read.read_text(encoding='utf-8')) if read.exists() else {}
            if not any(t.strip() for t in texts):
                rec['searchability'] = 'image-only: text read by macOS text recognition' if read else 'image-only: no text layer'
            texts = [t if t.strip() else read.get(str(n), '') for n, t in enumerate(texts, 1)]
            rows += [(doc_id, rec['title'], COLLECTION, rec['category'], rec['path'], n, t) for n, t in enumerate(texts, 1) if t.strip()]
        else:
            raw = files[0].read_bytes().decode('utf-8', errors='replace')
            page, text = html_page(raw, rec['title'], first['url'])
            dest = lib / 'pages' / 'ja' / f'{doc_id}.html'
            dest.write_text(page, encoding='utf-8')
            rec['kind'] = 'html'
            rec['path'] = f'pages/ja/{dest.name}'
            if text.strip():
                rows.append((doc_id, rec['title'], COLLECTION, rec['category'], rec['path'], 1, text))
        rec['bytes'] = dest.stat().st_size
        rec['sha256'] = sha256(dest)
        records.append(rec)
    if translations:
        r2, rows2 = translated(Path(translations), lib, data)
        records += r2
        rows += rows2
    src_page, src_text = sources_page(records)
    (lib / 'pages' / 'ja' / 'ja-sources.html').write_text(src_page, encoding='utf-8')
    records.append({'id': 'ja-sources', 'kind': 'html', 'title': '日本語の資料の出典と利用条件', 'publisher': 'Lastbook 日本語版',
                    'collection': COLLECTION, 'category': 'about', 'path': 'pages/ja/ja-sources.html', 'language': 'ja',
                    'bytes': (lib / 'pages' / 'ja' / 'ja-sources.html').stat().st_size})
    rows.append(('ja-sources', '日本語の資料の出典と利用条件', COLLECTION, 'about', 'pages/ja/ja-sources.html', 1, src_text))
    (lib / 'catalog.json').write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding='utf-8')
    con = sqlite3.connect(lib / 'search.sqlite')
    con.execute(PAGES)
    con.executemany('INSERT INTO pages VALUES (?,?,?,?,?,?,?)', rows)
    n = ja_search.build(con)
    con.commit()
    con.close()
    (lib / 'summary.json').write_text(json.dumps(summary(records), indent=1), encoding='utf-8')
    print(f'{len(records)} records, {len(rows)} pages of text, {n} rows in the Japanese index' + (f'; not downloaded: {", ".join(missing)}' if missing else ''))
    return records, missing


TR_NOTE = 'Claude（AI）による日本語訳です。専門家の確認は受けていません。数値・手順・警告は、必ず原文のページで確かめてください。'


def tr_id(doc, page):
    """The record id of the Japanese translation of one page of an English source (page 0: a web page)."""
    return f'ja-tr-{doc}-p{page or 0}'


def md_html(md):
    """The small Markdown the translators write (## headings, - lists, ⚠ warnings, paragraphs) as HTML."""
    out, para, inlist = [], [], False

    def flush():
        nonlocal para
        if para:
            out.append('<p>' + html.escape(' '.join(para)) + '</p>')
            para = []
    for line in md.splitlines():
        t = line.strip()
        if not t:
            flush()
            if inlist:
                out.append('</ul>')
                inlist = False
            continue
        m = re.match(r'^(#{1,4})\s+(.*)$', t)
        if m:
            flush()
            if inlist:
                out.append('</ul>')
                inlist = False
            n = min(len(m.group(1)) + 1, 4)
            out.append(f'<h{n}>{html.escape(m.group(2))}</h{n}>')
        elif re.match(r'^[-*・]\s+', t):
            flush()
            if not inlist:
                out.append('<ul>')
                inlist = True
            out.append('<li>' + html.escape(re.sub(r'^[-*・]\s+', '', t)) + '</li>')
        elif t.startswith('⚠'):
            flush()
            out.append('<p class="warn"><strong>' + html.escape(t) + '</strong></p>')
        else:
            para.append(t)
    flush()
    if inlist:
        out.append('</ul>')
    return '\n'.join(out)


def translated(tdir, lib, data=None):
    """Records and search rows for tdir/ja/<doc>__p<page>.md, the Japanese translations of English pages."""
    orig = {}
    if data:
        orig = {r['id']: r for r in json.loads((Path(data) / 'library-data' / 'catalog.json').read_text(encoding='utf-8'))}
    (lib / 'pages' / 'ja' / 'tr').mkdir(parents=True, exist_ok=True)
    records, rows = [], []
    for f in sorted((tdir / 'ja').glob('*.md')):
        doc, _, page = f.stem.rpartition('__p')
        if not doc or not page.isdigit():
            continue
        page = int(page)
        md = f.read_text(encoding='utf-8').strip()
        if not md:
            continue
        head = {}
        src = tdir / 'src' / (f.stem + '.txt')
        if src.exists():
            for line in src.read_text(encoding='utf-8').split('========', 1)[0].splitlines():
                k, _, v = line.partition(': ')
                head[k] = v.strip()
        o = orig.get(doc, {})
        title_en = o.get('title') or head.get('SOURCE') or doc
        where = f'{page}ページ' if page else 'Webページ'
        title = f'【日本語訳】{title_en}（{where}）'
        rid = tr_id(doc, page)
        page_html = ('<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>' + html.escape(title) + '</title>'
                     '<style>.warn{border-left:4px solid #b4442c;padding-left:8px}.tr-note{background:#f3efe4;padding:8px;border-radius:6px}</style></head><body>'
                     f'<h1>{html.escape(title)}</h1><p class="tr-note">原文：{html.escape(title_en)}（{html.escape(o.get("publisher") or head.get("PUBLISHER") or "")}）{where}、英語。{TR_NOTE}</p>'
                     + md_html(md) + '</body></html>')
        dest = lib / 'pages' / 'ja' / 'tr' / f'{rid}.html'
        dest.write_text(page_html, encoding='utf-8')
        text = re.sub(r'^[#\-*・⚠\s]+', '', md, flags=re.M)
        rec = {'id': rid, 'kind': 'html', 'title': title, 'publisher': o.get('publisher') or head.get('PUBLISHER') or '',
               'collection': '日本語訳（AI）', 'category': o.get('category') or 'reference', 'path': f'pages/ja/tr/{dest.name}',
               'language': 'ja', 'translation_of': {'doc': doc, 'page': page or None},
               'license': 'AIによる翻訳・個人利用のみ（原文の権利は発行元）', 'notes': TR_NOTE,
               'bytes': dest.stat().st_size, 'sha256': sha256(dest)}
        records.append(rec)
        rows.append((rid, title, rec['collection'], rec['category'], rec['path'], 1, text))
    print(f'{len(records)} translated pages', flush=True)
    return records, rows


def sources_page(records):
    rows = ''.join(f'<tr><td>{html.escape(r["title"])}</td><td>{html.escape(r["publisher"])}</td><td>{html.escape(r.get("license") or "")}</td>'
                   f'<td>{html.escape(r.get("source_url") or "")}</td><td>{html.escape(r.get("retrieved_at") or "")}</td></tr>' for r in records)
    lead = ('この日本語の資料は、この端末で個人として使うために集めたものです。各資料の権利はそれぞれの発行元にあります。'
            '再配布できない資料が含まれているため、この資料集を他の人に配ったり公開したりしないでください。'
            'PDFは発行元の配布したファイルそのままです（分冊のものは1冊にまとめています）。Webページは文字だけを抜き出して保存しています。'
            '内容は発行時点のものです。医療・救急については、最新の情報と専門家の判断を優先してください。')
    page = ('<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>日本語の資料の出典と利用条件</title></head><body>'
            f'<h1>日本語の資料の出典と利用条件</h1><p>{lead}</p><table><tr><th>資料</th><th>発行</th><th>利用条件</th><th>出典</th><th>取得日</th></tr>'
            f'{rows}</table></body></html>')
    text = lead + '\n' + '\n'.join(f'{r["title"]} {r["publisher"]} {r.get("license") or ""}' for r in records)
    return page, text


def summary(records):
    return {'resources': len(records), 'pdfs': sum(r['kind'] == 'pdf' for r in records),
            'pdf_pages': sum(r.get('pages') or 0 for r in records if r['kind'] == 'pdf'),
            'web_pages': sum(r['kind'] in ('html', 'htm') for r in records), 'videos': sum(r['kind'] == 'video' for r in records),
            'collections': sum(r['kind'] == 'zim' for r in records), 'document_bytes': sum(r.get('bytes') or 0 for r in records)}


def clone(src, dest):
    """A copy that is never a link (the library refuses hard links and symbolic links); an APFS clone where possible."""
    dest.unlink(missing_ok=True)
    try:
        import subprocess
        subprocess.run(['cp', '-c', str(src), str(dest)], check=True, capture_output=True)
    except Exception:
        shutil.copyfile(src, dest)


# ----------------------------------------------------------------- install --
def install(addon, data):
    addon_lib, data = Path(addon) / 'library-data', Path(data)
    lib = data / 'library-data'
    new_records = json.loads((addon_lib / 'catalog.json').read_text(encoding='utf-8'))
    ids = {r['id'] for r in new_records}
    fresh = not (lib / 'catalog.json').exists()
    lib.mkdir(parents=True, exist_ok=True)
    (data / 'derived').mkdir(exist_ok=True)
    for r in new_records:
        dest = lib / r['path']
        dest.parent.mkdir(parents=True, exist_ok=True)
        same = dest.exists() and dest.stat().st_size == r['bytes'] and (r['kind'] == 'zim' or 'sha256' not in r or sha256(dest) == r['sha256'])
        if not same:
            clone(addon_lib / r['path'], dest)
    old = [] if fresh else json.loads((lib / 'catalog.json').read_text(encoding='utf-8'))
    kept = [r for r in old if r['id'] not in ids]
    records = kept + new_records
    tmp = lib / 'catalog.json.new'
    tmp.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding='utf-8')
    con = sqlite3.connect(lib / 'search.sqlite')
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='pages'").fetchone():
        con.execute(PAGES)
    con.execute('ATTACH DATABASE ? AS addon', (str(addon_lib / 'search.sqlite'),))
    con.executemany('DELETE FROM pages WHERE doc_id=?', [(i,) for i in ids])
    con.execute('INSERT INTO pages(doc_id,title,collection,category,path,page,body) SELECT doc_id,title,collection,category,path,page,body FROM addon.pages')
    con.commit()
    con.execute('DETACH DATABASE addon')
    n = ja_search.build(con)
    con.commit()
    con.close()
    tmp.replace(lib / 'catalog.json')
    if fresh or not (lib / 'summary.json').exists():
        s = summary(records)
    else:
        s = json.loads((lib / 'summary.json').read_text(encoding='utf-8'))
        s.update({k: v for k, v in summary(records).items()})
    (lib / 'summary.json').write_text(json.dumps(s, indent=1), encoding='utf-8')
    print(f'{"made" if fresh else "updated"} {lib}: {len(new_records)} Japanese records ({len(kept)} others kept), {n} rows in the Japanese index')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('command', choices=['fetch', 'build', 'install', 'ocr'])
    ap.add_argument('--sources', default=str(SOURCES))
    ap.add_argument('--downloads')
    ap.add_argument('--out')
    ap.add_argument('--addon')
    ap.add_argument('--data')
    ap.add_argument('--translations', help='build: a folder with ja/<doc>__p<page>.md translations (and src/ beside them)')
    ap.add_argument('--only', nargs='*', help='fetch only these ids or groups')
    ap.add_argument('--no-zim', action='store_true', help='fetch no encyclopedias (they are large; fetch them on their own)')
    a = ap.parse_args(argv)
    if a.command == 'fetch':
        failed = fetch(load(a.sources), a.downloads, set(a.only or []), zim=not a.no_zim)
        sys.exit(1 if failed else 0)
    if a.command == 'build':
        build(load(a.sources), a.downloads, a.out, a.translations, a.data)
    if a.command == 'install':
        install(a.addon, a.data)
    if a.command == 'ocr':
        ocr(a.addon, a.downloads)


if __name__ == '__main__':
    main()

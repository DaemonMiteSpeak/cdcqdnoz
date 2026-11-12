import sys, os, collections
from psd_tools import PSDImage


def style_of(l):
    try:
        ed = l.engine_dict
        run = ed['StyleRun']['RunArray'][0]['StyleSheet']['StyleSheetData']
        rs = l.resource_dict
        fonts = rs['FontSet']
        fname = fonts[run.get('Font', 0)]['Name']
        fill = run.get('FillColor', {}).get('Values', [])
        col = '#' + ''.join('%02X' % round(float(v) * 255) for v in fill[1:4]) if len(fill) >= 4 else '?'
        alpha = fill[0] if fill else 1
        ls = run.get('Leading')
        tr = run.get('Tracking', 0)
        just = ed.get('ParagraphRun', {}).get('RunArray', [{}])[0].get('ParagraphSheet', {}).get('Properties', {}).get('Justification', 0)
        # transform scale applied to font size
        sz = run.get('FontSize')
        try:
            sz = round(sz * l.transform[0], 1) if hasattr(l, 'transform') else sz
        except Exception:
            pass
        return f"font={fname} sz={sz} col={col} a={alpha:.2f} lead={ls} track={tr} just={just}"
    except Exception as e:
        return f"style-err:{e}"


def pix(l):
    try:
        im = l.composite() if l.kind != 'pixel' else l.topil()
        if im is None:
            return ''
        im = im.convert('RGBA')
        w, h = im.size
        px = im.load()
        cnt = collections.Counter()
        for y in range(0, h, max(1, h // 24)):
            for x in range(0, w, max(1, w // 40)):
                r, g, b, a = px[x, y]
                if a > 10:
                    cnt[(r, g, b, a)] += 1
        if not cnt:
            return 'empty'
        top = cnt.most_common(3)
        s = ' '.join('#%02X%02X%02X/%d' % (c[0], c[1], c[2], c[3]) + f'x{n}' for c, n in top)
        # corner radius estimate: first opaque pixel in row 0
        rad = 0
        for x in range(w):
            if px[x, 0][3] > 128:
                rad = x
                break
        edge = px[min(1, w - 1), h // 2]
        return f"{w}x{h} {s} ncol={len(cnt)} r~{rad} leftedge=#%02X%02X%02X/%d" % edge
    except Exception as e:
        return f'pix-err:{e}'


def walk(l, d=0, out=None):
    b = l.bbox
    info = f"{'  ' * d}{l.kind} {l.name!r} [{b[0]},{b[1]},{b[2]-b[0]}x{b[3]-b[1]}]"
    if l.kind == 'type':
        info += f" text={l.text.strip()!r} {style_of(l)}"
    elif l.kind == 'pixel' and l.name != 'Background':
        info += ' ' + pix(l)
    if l.opacity != 255:
        info += f" op={l.opacity}"
    out.append(info)
    if l.is_group():
        for c in l:
            walk(c, d + 1, out)


for src in sys.argv[1:]:
    p = PSDImage.open(src)
    out = [f"# {os.path.basename(src)} {p.width}x{p.height}"]
    for l in p:
        walk(l, 0, out)
    dst = src.replace('psd/', 'dump/').replace('.psd', '.txt')
    os.makedirs('dump', exist_ok=True)
    open(dst, 'w').write('\n'.join(out) + '\n')

import sys, os
from psd_tools import PSDImage

# usage: extract_layers.py file.psd outdir [minY maxY]  -> saves every pixel layer (non-group) as png, names listed
src, outdir = sys.argv[1], sys.argv[2]
miny = int(sys.argv[3]) if len(sys.argv) > 3 else -1
maxy = int(sys.argv[4]) if len(sys.argv) > 4 else 10**9
os.makedirs(outdir, exist_ok=True)
p = PSDImage.open(src)
n = 0


def walk(l, path=''):
    global n
    if l.is_group():
        for c in l:
            walk(c, path + '/' + l.name)
        return
    b = l.bbox
    if l.kind != 'pixel' or not (miny <= b[1] <= maxy) or l.name == 'Background':
        return
    im = l.topil()
    if im is None:
        return
    n += 1
    fn = f"{n:03d}.png"
    im.save(os.path.join(outdir, fn))
    print(fn, repr(l.name), b, path[-40:])


for l in p:
    walk(l)

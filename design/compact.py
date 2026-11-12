import re, sys, glob, os

def comp(line):
    ind = len(line) - len(line.lstrip())
    s = line.strip()
    m = re.match(r"(\w+) '(.*?)' \[(\d+),(\d+),(\d+)x(\d+)\](.*)", s)
    if not m:
        return line
    kind, name, x, y, w, h, rest = m.groups()
    box = f"{x},{y} {w}x{h}"
    if kind == 'type':
        t = re.search(r"text=(.*?) font='([^']*)' sz=([\d.]+) col=(#\w+) a=([\d.]+) lead=(\S+) track=(\S+) just=(\d)", rest)
        if not t:
            return ' ' * ind + f"T {box} {rest}"
        txt, font, sz, col, a, lead, tr, just = t.groups()
        wt = {'Inter': '4', 'Inter-Medium': '5', 'Inter-Semibold': '6', 'Inter-Bold': '7'}.get(font, font)
        extra = ''
        if tr not in ('0',): extra += f' tr{tr}'
        if just != '0': extra += f' j{just}'
        if a != '1.00': extra += f' a{a}'
        return ' ' * ind + f"T {box} {txt} |{sz}/{lead} w{wt} {col}{extra}"
    if kind == 'pixel':
        c = re.search(r"(#\w{6})/(\d+)x\d+", rest)
        r = re.search(r"r~(\d+)", rest)
        nc = re.search(r"ncol=(\d+)", rest)
        return ' ' * ind + f"P {name} {box} {c.group(1) if c else ''}{'/'+c.group(2) if c and c.group(2)!='255' else ''} r{r.group(1) if r else ''} n{nc.group(1) if nc else ''}"
    return ' ' * ind + f"G {name} {box}{rest}"

for f in glob.glob('dump/*.txt'):
    if f.endswith('.c.txt'): continue
    out = [comp(l) for l in open(f, encoding='utf-8').read().splitlines()]
    open(f.replace('.txt', '.c.txt'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')

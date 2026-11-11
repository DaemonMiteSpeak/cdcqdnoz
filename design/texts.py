import re
names = dict(l.rstrip('\n').split('\t') for l in open('manifest.tsv', encoding='utf-8') if l.strip())
import os
out = []
for i, n in names.items():
    f = f'dump/{i}.c.txt'
    if not os.path.exists(f) or i in ('8RfnGUMnO2', 'rS-U-U2i2c', 'DtaZov8UzK'): continue
    out.append(f'## {i} {n}')
    for l in open(f, encoding='utf-8'):
        m = re.match(r"\s*T (\d+),(\d+) \S+ '(.*)' \|([\d.]+)/\S+ w(\S+) (#\w+)", l.strip() and l)
        if m:
            out.append(f"  {m.group(1)},{m.group(2)} {m.group(3)} |{m.group(4)} w{m.group(5)} {m.group(6)}")
open('texts.txt', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print(len(out))

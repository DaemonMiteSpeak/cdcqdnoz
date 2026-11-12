import sys
from PIL import Image

ims = [Image.open(f) for f in sys.argv[2:]]
h = max(i.height for i in ims)
o = Image.new('RGB', (sum(i.width for i in ims) + 10 * (len(ims) - 1), h), (40, 40, 40))
x = 0
for i in ims:
    o.paste(i, (x, 0))
    x += i.width + 10
o = o.resize((o.width // 2, o.height // 2))
o.save(sys.argv[1])

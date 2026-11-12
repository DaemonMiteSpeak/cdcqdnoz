import os
from PIL import Image

os.makedirs('assets/img', exist_ok=True)
im = Image.open('design/png/rS-U-U2i2c.png')
s = im.size[0] / 760
tiles = {'sbp': (28, 1424), 'cryptobot': (183, 1424), 'funpay': (370, 1424), 'stars': (524, 1424),
         'mir': (28, 1491), 'usdt': (178, 1491), 'tiktok': (273, 1491), 'youtube': (334, 1491), 'telegram': (402, 1491)}
for n, (x, y) in tiles.items():
    im.crop((round(x * s), round(y * s), round((x + 40) * s), round((y + 28) * s))).save(f'assets/img/{n}.png')
print('ok')

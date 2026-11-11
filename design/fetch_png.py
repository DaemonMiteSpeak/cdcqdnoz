import os, time, urllib.request

os.chdir(os.path.dirname(os.path.abspath(__file__)))
os.makedirs('png1', exist_ok=True)
ids = [l.split('\t')[0] for l in open('manifest.tsv', encoding='utf-8') if l.strip()]
for i in ids:
    dst = f'png1/{i}.png'
    if os.path.exists(dst) and os.path.getsize(dst) > 500:
        continue
    for attempt in range(6):
        try:
            data = urllib.request.urlopen(f'https://doop.design/i/{i}.png?scale=1', timeout=60).read()
            if data[:4] == b'\x89PNG':
                open(dst, 'wb').write(data)
                break
        except Exception as e:
            time.sleep(2 * (attempt + 1))
    time.sleep(0.4)
print('done', len(os.listdir('png1')), flush=True)

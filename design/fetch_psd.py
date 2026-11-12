import os, time, urllib.request

os.chdir(os.path.dirname(os.path.abspath(__file__)))
os.makedirs('psd', exist_ok=True)
SKIP = {'8RfnGUMnO2', 'rS-U-U2i2c', 'DtaZov8UzK'}
ids = [l.split('\t')[0] for l in open('manifest.tsv', encoding='utf-8') if l.strip()]
ids = [i for i in ids if i not in SKIP] + [i for i in ids if i in SKIP]

for i in ids:
    dst = f'psd/{i}.psd'
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        continue
    for attempt in range(8):
        try:
            data = urllib.request.urlopen(f'https://doop.design/i/{i}.psd', timeout=60).read()
            if len(data) > 1000:
                open(dst, 'wb').write(data)
                print('ok', i, len(data), flush=True)
                break
        except Exception as e:
            print('retry', i, attempt, e, flush=True)
            time.sleep(3 * (attempt + 1))
    time.sleep(1)
print('done', len(os.listdir('psd')), flush=True)

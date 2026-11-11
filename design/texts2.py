import re
seen=set(); out=[]
cur=None
for l in open('texts.txt',encoding='utf-8'):
    l=l.rstrip('\n')
    if l.startswith('##'):
        cur=[l.split(' ',2)[2]+' ['+l.split(' ')[1]+']']; out.append(cur); continue
    m=re.match(r"\s+\d+,\d+ (.*) \|([\d.]+) w(\S+) (#\w+)",l)
    t=m.group(1)
    if t in seen: continue
    seen.add(t)
    cur.append(f"  {t[:150]} |{m.group(2)}w{m.group(3)}{m.group(4)}")
res=[]
for c in out:
    if len(c)>1: res+=c
open('texts2.txt','w',encoding='utf-8').write('\n'.join(res)+'\n')
print(len(res))

# After scenario transp: mean abs diff % between preview PNGs and exported frames (320x180); export frame picked by index.
import json,subprocess,re,sys
D='/mnt/d/ove-test/cache/transp'
tot=[]
for n,f in enumerate(json.load(open(D+'/frames.json'))):
    fl=f"[0:v]select=eq(n\\,{f['k']}),scale=320:180[a];[1:v]scale=320:180[b];[a][b]blend=all_mode=difference,signalstats,metadata=print:file=-"
    r=subprocess.run(['ffmpeg','-v','error','-i',D+'/out.mp4','-i',f'{D}/p{n}.png','-frames:v','1','-filter_complex',fl,'-f','null','-'],capture_output=True,text=True)
    m=re.search(r'YAVG=([\d.]+)',r.stdout)
    v=float(m.group(1))/255*100 if m else -1; tot.append(v)
    print(f"{f['type']:14s} {int(f['q']*100):3d}%  diff {v:5.2f}%"+('  OVER' if v>=3 else ''))
print('over 3%:',sum(v>=3 for v in tot),'of',len(tot))

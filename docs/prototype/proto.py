# Черновой прототип боя «Рубежа» (Python). Иллюстрация правил §2 и §3 ТЗ со стартовыми числами §2.7 и GD-12.
# Упрощения: нет уровней карт и игрока, звёзды и эффекты — как в ТЗ, урон применяется сразу (в ТЗ — одновременно, SIM-13),
# дробный порох — числа с плавающей точкой (в ТЗ — тысячные, SIM-04). Источник истины — docs/TZ.md.
# Запуск: python3 proto.py 200 — турнир ботов на 200 боёв случайных колод.
# Прототип боя «Рубежа»: поле 7x10, порох, рубеж, стрельба, звёзды, бот. Время в тиках по 50 мс.
import random, math, sys, collections
TPS=20; W,H=7,10
CARDS={
 # id: cost, hp, dmg, interval(s), range, kind, extra
 'wall':   dict(cost=1,hp=550),
 'watch':  dict(cost=2,hp=250,dmg=25,iv=1.0,rng=2.5),
 'banner': dict(cost=2,hp=300,buff=0.25),
 'repair': dict(cost=2,spell=True,heal=250),
 'archers':dict(cost=3,hp=350,dmg=34,iv=0.7,rng=3.5),
 'cannon': dict(cost=4,hp=500,dmg=90,iv=1.2,rng=2.5),
 'workshop':dict(cost=3,hp=350,gen=10.0),
 'healer': dict(cost=3,hp=300,hps=14),
 'outpost':dict(cost=2,hp=300,zone=2),
 'fireball':dict(cost=4,spell=True,dmg=300,tower=0.35),
 'ballista':dict(cost=5,hp=400,dmg=110,iv=2.0,line=6),
 'mortar': dict(cost=5,hp=400,dmg=120,iv=3.0,rng=5.0,minr=2.0,splash=0.5),
 'ice':    dict(cost=3,hp=450,dmg=20,iv=1.0,rng=3.0,slow=0.4),
 'dome':   dict(cost=4,hp=450,dr=0.4),
 'quake':  dict(cost=2,spell=True,dmg=250,other=80,tower=40),
 'catapult':dict(cost=7,hp=600,dmg=400,iv=4.0,rng=7.0,minr=3.0),
}
TOWER=dict(hp=600,dmg=30,iv=0.9,rng=3.5); KEEP=dict(hp=1000,dmg=40,iv=1.0,rng=3.5)
class B:
    __slots__=('id','side','kind','c','r','hp','maxhp','stars','cd','slow','tower')
class Game:
    def __init__(s,decks,seed=0,elx_iv=2.8,start_el=5.0):
        s.t=0; s.nid=1; s.bs=[]; s.el=[start_el,start_el]; s.elx_iv=elx_iv; s.genacc=[0,0]
        s.rng=random.Random(seed); s.decks=[]; s.hands=[]
        for side in (0,1):
            d=decks[side][:]; random.Random(seed*7+side).shuffle(d); s.decks.append(d[4:]); s.hands.append(d[:4])
            for (c,r,k) in ((3,9,'keep'),(1,8,'tower'),(5,8,'tower')):
                s.add(side,k,c,r)
        s.crowns=[0,0]; s.over=None; s.placed=[collections.Counter(),collections.Counter()]
    def gc(s,side,c,r):  # координаты: у каждой стороны своя половина снизу; side1 зеркально
        return (c,r) if side==0 else (6-c,9-r)
    def add(s,side,kind,c,r):
        b=B(); b.id=s.nid; s.nid+=1; b.side=side; b.kind=kind; b.c,b.r=s.gc(side,c,r) if kind in('keep','tower') else (c,r)
        if kind=='keep': st=KEEP
        elif kind=='tower': st=TOWER
        else: st=CARDS[kind]
        b.hp=b.maxhp=st['hp']; b.stars=1; b.cd=0; b.slow=0; b.tower=kind in('keep','tower')
        s.bs.append(b); return b
    def at(s,c,r):
        for b in s.bs:
            if b.c==c and b.r==r: return b
    def zone(s,side):
        z=set()
        own=[b for b in s.bs if b.side==side]
        back=(8,9) if side==0 else (0,1)
        for c in range(W):
            for r in back: z.add((c,r))
        for b in own:
            rad=CARDS['outpost']['zone'] if b.kind=='outpost' else 1
            for dc in range(-rad,rad+1):
                for dr in range(-rad,rad+1):
                    cc,rr=b.c+dc,b.r+dr
                    if 0<=cc<W and 0<=rr<H: z.add((cc,rr))
        return z
    def valid(s,side,card,c,r):
        if CARDS[card].get('spell'): return 0<=c<W and 0<=r<H
        if not (0<=c<W and 0<=r<H): return False
        b=s.at(c,r)
        if b: return b.side==side and b.kind==card and b.stars<3
        return (c,r) in s.zone(side)
    def play(s,side,card,c,r):
        cost=CARDS[card]['cost']
        if card not in s.hands[side] or s.el[side]<cost or not s.valid(side,card,c,r): return False
        s.el[side]-=cost
        i=s.hands[side].index(card); s.hands[side][i]=s.decks[side].pop(0); s.decks[side].append(card)
        s.placed[side][card]+=1
        st=CARDS[card]
        if st.get('spell'):
            if card=='repair':
                for b in s.bs:
                    if b.side==side and abs(b.c-c)<=1 and abs(b.r-r)<=1: b.hp=min(b.maxhp,b.hp+st['heal'])
            elif card=='fireball':
                for b in s.bs:
                    if b.side!=side and c<=b.c<=c+1 and r<=b.r<=r+1: s.dmg(b,st['dmg']*(st['tower'] if b.tower else 1))
            elif card=='quake':
                for b in s.bs:
                    if b.side!=side and abs(b.c-c)<=1 and abs(b.r-r)<=1:
                        s.dmg(b, st['tower'] if b.tower else (st['dmg'] if b.kind in('wall','outpost') else st['other']))
            s.cleanup(); return True
        b=s.at(c,r)
        if b:
            b.stars+=1; b.maxhp=int(CARDS[card]['hp']*(1+0.5*(b.stars-1))); b.hp=b.maxhp
        else: s.add(side,card,c,r)
        return True
    def stat(s,b,k,default=0):
        if b.kind=='keep': return KEEP.get(k,default)
        if b.kind=='tower': return TOWER.get(k,default)
        return CARDS[b.kind].get(k,default)
    def dmg(s,b,x):
        dr=0
        for o in s.bs:
            if o.side==b.side and o.kind=='dome' and o is not b and abs(o.c-b.c)<=1 and abs(o.r-b.r)<=1: dr=max(dr,CARDS['dome']['dr'])
        b.hp-=x*(1-dr)
    def cleanup(s):
        dead=[b for b in s.bs if b.hp<=0]
        for b in dead:
            s.bs.remove(b)
            if b.tower:
                s.crowns[1-b.side]+= 3 if b.kind=='keep' else 1
                if b.kind=='keep': s.crowns[1-b.side]=3; s.over='keep'
    def step(s):
        s.t+=1; sec=s.t/TPS
        mult=2 if sec>=120 else 1
        for side in (0,1):
            s.el[side]=min(10,s.el[side]+mult/(s.elx_iv*TPS))
            for b in s.bs:
                if b.side==side and b.kind=='workshop':
                    pass
            gens=sum(1 for b in s.bs if b.side==side and b.kind=='workshop')
            s.genacc[side]+=gens/(CARDS['workshop']['gen']*TPS)
            if s.genacc[side]>=1: s.el[side]=min(10,s.el[side]+1); s.genacc[side]-=1
        # healers
        for b in s.bs:
            if b.kind=='healer':
                for o in s.bs:
                    if o.side==b.side and o is not b and abs(o.c-b.c)<=1 and abs(o.r-b.r)<=1:
                        o.hp=min(o.maxhp,o.hp+CARDS['healer']['hps']*(1+0.5*(b.stars-1))/TPS)
        # shooting
        for b in list(s.bs):
            dmgv=s.stat(b,'dmg')
            if not dmgv: continue
            if b.slow>0: b.slow-=1
            if b.cd>0: b.cd-=1; continue
            base=dmgv*(1+0.5*(b.stars-1))
            buff=0
            for o in s.bs:
                if o.side==b.side and o.kind=='banner' and abs(o.c-b.c)<=1 and abs(o.r-b.r)<=1: buff=max(buff,CARDS['banner']['buff']*(1+0.5*(o.stars-1)))
            base*=1+buff
            enemies=[o for o in s.bs if o.side!=b.side]
            fired=False
            if b.kind=='ballista':
                fwd=-1 if b.side==0 else 1
                hits=[o for o in enemies if o.c==b.c and 0<(o.r-b.r)*fwd<=CARDS['ballista']['line']]
                for o in hits: s.dmg(o,base); fired=True
            else:
                rng=s.stat(b,'rng'); minr=s.stat(b,'minr')
                cands=[(math.hypot(o.c-b.c,o.r-b.r),o.hp,o.id,o) for o in enemies]
                cands=[x for x in cands if minr<=x[0]<=rng]
                if cands:
                    cands.sort(key=lambda x:(x[0],x[1],x[2])); o=cands[0][3]
                    s.dmg(o,base); fired=True
                    sp=s.stat(b,'splash')
                    if sp:
                        for e in enemies:
                            if e is not o and abs(e.c-o.c)<=1 and abs(e.r-o.r)<=1: s.dmg(e,base*sp)
                    if b.kind=='ice': o.slow=2*TPS
            if fired:
                iv=s.stat(b,'iv')*(1/(1-CARDS['ice']['slow']) if b.slow>0 else 1)
                b.cd=int(iv*TPS)
        s.cleanup()
        if s.over: return
        if sec>=180 and s.crowns[0]!=s.crowns[1]: s.over='time'
        if sec>=240: s.over='overtime'
# ---------------- бот ----------------
def threat(g,side,c,r):
    t=0
    for o in g.bs:
        if o.side!=side:
            d=math.hypot(o.c-c,o.r-r); dm=g.stat(o,'dmg')
            if dm and g.stat(o,'minr')<=d<=g.stat(o,'rng'): t+=dm/g.stat(o,'iv')
    return t
def bot_move(g,side,rnd,aggr=1.0):
    best=None
    fwd=-1 if side==0 else 1
    enemyT=[o for o in g.bs if o.side!=side and o.tower]
    tgt=min(enemyT,key=lambda o:(o.hp,o.id)) if enemyT else None
    z=g.zone(side)
    for card in set(g.hands[side]):
        st=CARDS[card]
        if st['cost']>g.el[side]: continue
        cells=[(c,r) for c in range(W) for r in range(H) if g.valid(side,card,c,r)]
        for (c,r) in cells:
            ex=g.at(c,r); sc=0
            prog=(9-r) if side==0 else r  # продвижение к врагу
            dist_t=math.hypot(tgt.c-c,tgt.r-r) if tgt else 9
            thr=threat(g,side,c,r)
            if st.get('spell'):
                if card=='fireball':
                    v=sum((st['dmg']*(st['tower'] if o.tower else 1)) for o in g.bs if o.side!=side and c<=o.c<=c+1 and r<=o.r<=r+1)
                    sc=v/st['cost']/25-2
                elif card=='quake':
                    v=sum((st['tower'] if o.tower else (st['dmg'] if o.kind in('wall','outpost') else st['other'])) for o in g.bs if o.side!=side and abs(o.c-c)<=1 and abs(o.r-r)<=1)
                    sc=v/st['cost']/25-2
                else:
                    v=sum(min(o.maxhp-o.hp,st['heal']) for o in g.bs if o.side==side and abs(o.c-c)<=1 and abs(o.r-r)<=1)
                    sc=v/st['cost']/25-1.5
            elif ex:
                sc=1.0+ (2.0 if thr>0 else 0)+ (ex.maxhp-ex.hp)/ex.maxhp*2
                if st.get('dmg'): sc+=1
            elif st.get('dmg') or card=='ballista':
                if card=='ballista':
                    n=sum(1 for o in g.bs if o.side!=side and o.c==c and 0<(o.r-r)*fwd<=st['line'])
                    reach=n
                else:
                    reach=sum((3 if o.tower else 1) for o in g.bs if o.side!=side and st.get('minr',0)<=math.hypot(o.c-c,o.r-r)<=st['rng'])
                hp=st['hp']; surv=hp/(thr+1)
                sc=reach*1.2+min(surv/20,2)-st['cost']*0.3+prog*0.15*aggr
            elif card=='wall':
                # щит перед своими стрелками и продвижение к цели
                shield=sum(1 for o in g.bs if o.side==side and g.stat(o,'dmg') and o.c==c and (o.r-r)*fwd==-1)
                sc=prog*0.35*aggr+shield*1.0-dist_t*0.2+ (0.5 if thr>0 else 0)
            elif card=='outpost':
                sc=prog*0.4*aggr-dist_t*0.2-thr/30
            elif card=='workshop':
                sc=(2.5 if g.t<TPS*60 else 0.5)-thr/20-prog*0.3
            elif card in('banner','dome','healer'):
                nb=sum(1 for o in g.bs if o.side==side and not o.tower and g.stat(o,'dmg') and abs(o.c-c)<=1 and abs(o.r-r)<=1)
                sc=nb*1.1-0.8-thr/40
            sc+=rnd.random()*0.6
            if best is None or sc>best[0]: best=(sc,card,c,r)
    if best and best[0]>0.3:
        # копить порох на дорогие карты: иногда ждём
        g.play(side,best[1],best[2],best[3]); return True
    return False
def match(d0,d1,seed,react=10,aggr=(1.0,1.0)):
    g=Game((d0,d1),seed); rnd=[random.Random(seed*13+1),random.Random(seed*13+2)]
    while not g.over:
        for side in (0,1):
            if g.t%react==side*react//2: bot_move(g,side,rnd[side],aggr[side])
        g.step()
    hp=[sum(b.hp for b in g.bs if b.side==sd and b.tower) for sd in (0,1)]
    if g.crowns[0]!=g.crowns[1]: w=0 if g.crowns[0]>g.crowns[1] else 1
    else: w=0 if hp[0]>hp[1] else (1 if hp[1]>hp[0] else -1)
    return g,w
ALL=list(CARDS)
def rand_deck(r): return r.sample(ALL,8)
if __name__=='__main__':
    N=int(sys.argv[1]) if len(sys.argv)>1 else 200
    r=random.Random(1)
    stats=collections.Counter(); dur=[]; wins=collections.Counter(); plays=collections.Counter(); crowns=collections.Counter()
    for i in range(N):
        d0,d1=rand_deck(r),rand_deck(r)
        g,w=match(d0,d1,i)
        stats[g.over]+=1; dur.append(g.t/TPS); crowns[max(g.crowns)]+=1
        for side,d in ((0,d0),(1,d1)):
            for c in d:
                plays[c]+=1
                if w==side: wins[c]+=1
    print('исходы',dict(stats),'ср. длительность',round(sum(dur)/N),'с','макс корон',dict(crowns))
    print('винрейт карт (в колоде):')
    for c in sorted(ALL,key=lambda c:-wins[c]/max(1,plays[c])):
        print(f'  {c:9s} {wins[c]/max(1,plays[c]):.2f}  ({plays[c]})')

# Проверка воспроизведения записей (REP-02…REP-05): записываем бой ботов и проигрываем запись стороны 1 против другого бота.
# Запуск из этой папки: python3 replay_check.py 60
import sys,random,collections,math
src=open('proto.py',encoding='utf-8').read().split("if __name__=='__main__':")[0]
exec(src)
TOWER.update(hp=600,dmg=30); KEEP.update(hp=1000,dmg=40)
# 1) записываем бои бот-против-бота: события стороны 1 в её собственных координатах
orig_play=Game.play
def rec_play(s,side,card,c,r):
    ok=orig_play(s,side,card,c,r)
    if ok and hasattr(s,'log') and side==s.recside:
        cc,rr=(c,r) if side==0 else (6-c,9-r)   # в «своих» координатах
        s.log.append((s.t,card,cc,rr))
    return ok
Game.play=rec_play
def nearest_valid(g,side,card,c,r):
    best=None
    for cc in range(W):
        for rr in range(H):
            if g.valid(side,card,cc,rr):
                d=max(abs(cc-c),abs(rr-r))
                k=(d,abs(rr-r),cc)
                if best is None or k<best[0]: best=(k,cc,rr)
    return best
r=random.Random(5)
stats=collections.Counter(); outcomes=collections.Counter(); crowns=collections.Counter(); dur=[]
N=int(sys.argv[1]) if len(sys.argv)>1 else 60
for i in range(N):
    d0,d1=rand_deck(r),rand_deck(r)
    g=Game((d0,d1),i); g.log=[]; g.recside=1
    rnd=[random.Random(i*13+1),random.Random(i*13+2)]
    while not g.over:
        for side in (0,1):
            if g.t%10==side*5: bot_move(g,side,rnd[side])
        g.step()
    log=g.log
    # 2) проигрываем запись стороны 1 против нового бота с другой колодой
    d2=rand_deck(r)
    h=Game((d2,d1),1000+i); h.log=[]; h.recside=-1
    rb=random.Random(i*31)
    q=list(log); pending=[]
    while not h.over:
        if h.t%10==0: bot_move(h,0,rb)
        while q and q[0][0]<=h.t: pending.append(q.pop(0))
        keep=[]
        for ev in pending:
            t,card,c,rr=ev
            gc,gr=6-c,9-rr  # в координаты поля
            if card not in h.hands[1]:
                # рука могла разойтись: подменяем карту в руке (запись — источник истины по картам)
                h.hands[1][0]=card
            if CARDS[card]['cost']>h.el[1]:
                if h.t-t>5*TPS: stats['dropped_elixir']+=1
                else: keep.append(ev)
                continue
            if h.valid(1,card,gc,gr): h.play(1,card,gc,gr); stats['exact']+=1
            else:
                nv=nearest_valid(h,1,card,gc,gr)
                if nv and nv[0][0]<=2: h.play(1,card,nv[1],nv[2]); stats['moved']+=1
                else: stats['dropped_cell']+=1
        pending=keep
        h.step()
    outcomes['запись' if (h.crowns[1]>h.crowns[0]) else ('бот' if h.crowns[0]>h.crowns[1] else 'по прочности')]+=1
    crowns[max(h.crowns)]+=1; dur.append(h.t/TPS)
tot=sum(stats.values())
print('события записи:',{k:f'{v/tot:.0%}' for k,v in stats.items()})
print('исходы против записи:',dict(outcomes),'корон',dict(sorted(crowns.items())),'ср',round(sum(dur)/N),'с')

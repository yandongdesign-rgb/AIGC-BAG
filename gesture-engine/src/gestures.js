export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
export function classify(l,previous,dt,cfg){
 const scale=distance(l[0],l[9])||.1;
 const straight=(tip,pip,mcp)=>distance(l[tip],l[mcp])>distance(l[pip],l[mcp])*1.55&&distance(l[tip],l[0])>distance(l[pip],l[0])*1.1;
 const fingers=[straight(8,6,5),straight(12,10,9),straight(16,14,13),straight(20,18,17)];
 const thumb=distance(l[4],l[17])>distance(l[3],l[17])*1.2;
 if(fingers.some(Boolean)&&distance(l[4],l[8])/scale<cfg.pinchRatio)return 'pinch';
 if(fingers[0]&&!fingers.slice(1).some(Boolean))return 'point';
 if(!fingers.some(Boolean)&&!thumb)return 'fist';
 if(fingers.every(Boolean)){
  // Camera cannot establish anatomical palm-up reliably: use visible palm + upward motion.
  const area=Math.abs((l[5].x-l[0].x)*(l[17].y-l[0].y)-(l[5].y-l[0].y)*(l[17].x-l[0].x));
  if(previous&&dt>0&&(previous.y-l[9].y)/dt>cfg.raiseSpeed&&area/scale**2>.12)return 'lift';
  return 'open';
 }
 return 'idle';
}
export class Stabilizer{
 constructor(cfg){this.cfg=cfg;this.state='idle';this.candidate='idle';this.since=0;this.seen=0;}
 update(raw,now){if(raw!=='idle')this.seen=now;if(raw==='idle'&&now-this.seen<this.cfg.lostMs)return this.state;
 if(raw!==this.candidate){this.candidate=raw;this.since=now;}if(now-this.since>=this.cfg.stableMs)this.state=raw;return this.state;}
}

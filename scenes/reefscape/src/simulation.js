import * as THREE from 'three';
import { randomGenerator, clamp, groundHeight, limitVector } from './math.js';
import { currentAt } from './water.js';
import { HOST, ROCKS, STATIONS, TANK, CORAL_BOUNDS, THICKETS, PROMONTORY } from './layout.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
export const FIXED_STEP=1/60;
// A hosting group is a breeding pair plus non-breeders — mean group size on a wild anemone
// is 3.4 — and a captive lyretail harem is one terminal male to four to six females. Nine
// chromis is also a keeper's number: below seven a pod concentrates its aggression on one
// fish and eats itself down to a single survivor.
export const POPULATION={clownfish:3,chromis:9,anthias:7,shrimp:2};
const REEF_BOUNDS=[...ROCKS,...CORAL_BOUNDS];
// Where the two Acropora thickets sit in that list. A chromis does not merely hover near
// its colony, it lives in it — juveniles barely leave the branches and the whole pod drops
// between them at an alarm — so its own head holds it off far less than everything else.
const SHELTER=ROCKS.length;
// How long one U-swim takes from the top of the dive to the top of the rise.
const USWIM=2.0;
// Open-water fish hold a station inside a shoal rather than steering for themselves, and
// each shoal is pinned to a structure rather than to the open column. Two chromis pods sit
// over the two Acropora thickets and swap members; the anthias spread out in front of the
// arch, the one promontory here, which is where a swarm of them would actually be.
const SHOALS=[
  // Each pod hangs over the open face of its own thicket rather than over its middle:
  // that is the side the flow and the plankton come from, and it keeps the fish off the
  // tank wall the colony is built against.
  {kind:'chromis',home:[THICKETS[0].x+1.10,THICKETS[0].top-.18,THICKETS[0].z+.75],spread:[1.10,.52,.96],reach:.32,rove:[.42,.18,.38],lead:.78,shelter:THICKETS[0]},
  {kind:'chromis',home:[THICKETS[1].x-1.10,THICKETS[1].top-.22,THICKETS[1].z+.80],spread:[1.06,.50,.92],reach:.32,rove:[.40,.16,.36],lead:.74,shelter:THICKETS[1]},
  {kind:'anthias',home:[PROMONTORY.x,PROMONTORY.y+1.75,PROMONTORY.z+.75],spread:[2.10,.95,1.25],reach:.48,rove:[.80,.38,.58],lead:1.35,shelter:PROMONTORY},
];

export class ReefSimulation {
  constructor(seed=36719) {
    this.random=randomGenerator(seed);this.time=0;this.fish=[];this.food=Array.from({length:32},()=>({active:false,position:V(),velocity:V(),age:0,size:0}));
    this.lastFeed=-10;this.consumed=0;this.steps=0;
    this._flow=V();this._delta=V();this._desired=V();this._force=V();this._sep=V();this._cohesion=V();this._align=V();this._relative=V();
    this.shoals=SHOALS.map(s=>({...s,home:V(...s.home),centre:V(...s.home),drift:V(),timer:0,swell:1}));
    // Buston & Cant measured 177 adjacent-rank pairs on wild percula: a dominant ends up
    // 1.26 times its immediate subordinate's length, and 1.37 for the two smallest fish.
    // These three sizes are that ladder, so the group reads as a queue rather than a trio.
    const initial=[[-5.15,4.18,2.1],[-2.78,3.99,1.85],[-3.54,3.85,2.35]];
    for(let i=0;i<3;i++)this.add('clown',initial[i],[.84,.66,.48][i],i);
    for(let i=0;i<9;i++)this.add('chromis',null,.63+(i?this.random()*.13:.15),i,i%2);
    // Rank 0 is the terminal male. FishBase puts the male at 15 cm against 7 cm for the
    // female, and an aquarium harem at about 12.5 cm to 9; he is half again their length.
    for(let i=0;i<7;i++)this.add('anthias',null,(i?.66:1.00)+this.random()*.09,i,2);
    this.previous=this.fish.map(()=>({p:V(),v:V(),alarm:0}));
    this.shrimp=STATIONS.map((p,i)=>({position:V(p.x,p.y,p.z),home:V(p.x,p.y,p.z),yaw:i===0?.30:2.8,phase:i*2.4,state:'advertise',timer:3+i*2,step:0,walk:0}));
  }
  add(kind,position,size,rank,shoal=-1) {
    const r=this.random;
    const f={kind,rank,size,shoal,station:V(r()*2-1,r()*2-1,r()*2-1),position:V(),velocity:V(kind==='clown'?.11:-.28,0,.02),goal:V(),goalTimer:0,phase:r()*6.28,effort:0,yaw:kind==='clown'?0:Math.PI,pitch:0,bank:0,roll:0,alarm:0,spook:0,state:'forage',lastSpeed:0,hold:0,show:6+r()*9,display:0};
    if(position)f.position.set(...position);else this.station(f,f.position);
    f.goal.copy(f.position);this.fish.push(f);return f;
  }
  // Where this animal's slot in its shoal currently sits. Popper & Fishelson found the
  // territorial male anthias holding the water right against the rock with the females and
  // juveniles ranging above him, so his slot only ever runs downward from the group's
  // centre where theirs runs either way: the harem stacks male-low, not male-high.
  station(f,out) {
    const s=this.shoals[f.shoal],k=s.swell,lead=f.kind==='anthias'&&!f.rank;
    const rise=lead?-.62-Math.abs(f.station.y)*.55:f.station.y;
    return out.set(s.centre.x+f.station.x*s.spread[0]*k,s.centre.y+rise*s.spread[1]*k,s.centre.z+f.station.z*s.spread[2]*k);
  }
  feed(x=0,z=1) {
    if(this.time-this.lastFeed<1)return 0;
    let count=0;
    for(const pellet of this.food)if(!pellet.active&&count<8){
      pellet.active=true;pellet.age=0;pellet.size=.027+this.random()*.015;
      pellet.position.set(clamp(x+(this.random()-.5)*1.3,-7,7),TANK.surface-.12-this.random()*.16,z+(this.random()-.5)*.9);
      pellet.velocity.set(0,-.04,0);count++;
    }
    if(count)this.lastFeed=this.time;return count;
  }
  chooseGoal(f) {
    const r=this.random;
    if(f.kind==='clown') {
      // Buston's field work: percula rarely stray past the periphery of their host's
      // tentacles, and the dominant female ranges widest while the smallest non-breeder is
      // held closest by her. Roughly a third of those excursions are a bathe instead — the
      // fish swims down through the crown, which is how it keeps its coat of host mucus
      // and, incidentally, how it ventilates the anemone.
      f.hold=r()<(f.rank?.36:.22)?2.2+r()*2.6:0;
      const a=r()*Math.PI*2,radius=HOST.radius*(f.hold?r()*.50:.34+r()*(f.rank===0?.98:f.rank===1?.74:.50));
      f.goal.set(HOST.x+Math.cos(a)*radius,HOST.y+(f.hold?.20+r()*.26:.66+r()*.94)-f.rank*.12,HOST.z+.34+Math.sin(a)*radius*.58);
      f.goalTimer=f.hold||2.8+r()*4.4;return;
    }
    // A cleaner shrimp rocking its white antennae over a rock shoulder is advertising, and
    // a planktivore will leave the shoal to be worked over, hanging almost still above the
    // station for several seconds. Clownfish get cleaned at the anemone instead.
    const open=this.shrimp.filter(s=>s.state==='advertise');
    if(open.length&&r()<.045){
      const s=open[Math.floor(r()*open.length)%open.length];
      f.goal.set(s.position.x+(r()-.5)*.4,s.position.y+.50+r()*.22,s.position.z+.28);
      f.hold=f.goalTimer=5+r()*5;return;
    }
    // A slot drifts rather than being redrawn, so a fish keeps its place in the layer it is
    // in. Anthias hold their slot far longer, because a hovering anthias is station-keeping
    // against the flow rather than touring, and only its head turns.
    f.hold=0;
    const keep=f.kind==='anthias'?.82:.50,churn=1-keep;
    f.station.set(f.station.x*keep+(r()*2-1)*churn,f.station.y*keep+(r()*2-1)*churn,f.station.z*keep+(r()*2-1)*churn);
    // A chromis will cross to the other colony, but only when it is the emptier one by a
    // clear margin: branch space is what limits how many a colony can shelter. The move is
    // rare because a fish is site-attached to the particular head it settled on, so both
    // heads keep a cloud and the tank is not full of animals commuting.
    if(f.kind==='chromis'&&r()<.05&&this.fish.filter(o=>o.shoal===1-f.shoal).length<this.fish.filter(o=>o.shoal===f.shoal).length-1)f.shoal=1-f.shoal;
    this.station(f,f.goal);f.goalTimer=(f.kind==='anthias'?7.:3.4)+r()*(f.kind==='anthias'?7.:5.2);
  }
  step(dt=FIXED_STEP,pointer=null) {
    if(!Number.isFinite(dt)||dt<=0||dt>.101)throw new RangeError('Simulation step must be 0 < dt <= 0.101 seconds.');
    this.time+=dt;this.steps++;
    const t=this.time;
    for(const p of this.food)if(p.active){
      p.age+=dt;if(p.age>36){p.active=false;continue;}
      currentAt(p.position,t,this._flow);
      this._flow.y-=.17; // reduced gravity balanced by drag: bounded settling velocity
      p.velocity.lerp(this._flow,1-Math.exp(-dt*4));p.position.addScaledVector(p.velocity,dt);
      const bed=groundHeight(p.position.x,p.position.z)+p.size;
      if(p.position.y<bed){p.position.y=bed;p.velocity.multiplyScalar(.1);}
    }
    // A shoal sits up-current of its shelter, where the drifting food arrives, and opens
    // out as the flow strengthens: the count of chromis above an Acropora colony rises with
    // the current because the fish swim further off the coral to reach the plankton. When
    // the pumps reverse the whole group slides across to the other face of its rock and,
    // because heading follows velocity through the water, turns to face the new flow.
    for(const s of this.shoals) {
      currentAt(s.home,t,this._flow);
      s.timer-=dt;
      if(s.timer<=0){const r=this.random;s.drift.set((r()*2-1)*s.rove[0],(r()*2-1)*s.rove[1],(r()*2-1)*s.rove[2]);s.timer=7+r()*9;}
      this._desired.copy(s.home).add(s.drift);
      this._desired.x-=Math.tanh(this._flow.x*5)*s.lead;
      s.centre.lerp(this._desired,1-Math.exp(-dt*(s.kind==='anthias'?.28:.42)));
      s.swell+=(1+Math.min(s.reach,Math.abs(this._flow.x)*1.4)-s.swell)*(1-Math.exp(-dt*.5));
    }
    // Read neighbours from a snapshot: no order-dependent following of already-updated fish.
    const old=this.previous;
    for(let i=0;i<this.fish.length;i++){old[i].p.copy(this.fish[i].position);old[i].v.copy(this.fish[i].velocity);old[i].alarm=this.fish[i].alarm;}
    for(let index=0;index<this.fish.length;index++) {
      const f=this.fish[index],p=f.position;
      currentAt(p,t,this._flow);
      f.alarm=Math.max(0,f.alarm-dt);f.goalTimer-=dt;
      // A neighbour's bolt takes about seventy milliseconds to reach this fish, against
      // about eight for the one that saw the threat itself, so the response is held here
      // and released a few frames late. That delay is the whole difference between a
      // school that flinches as one object and one that flinches as a wave.
      if(f.spook>0&&(f.spook-=dt)<=0)f.alarm=2.3;
      if(pointer&&pointer.speed>.9&&p.distanceToSquared(pointer.position)<8.5)f.alarm=2.6;
      if(f.hold>0)f.hold=Math.max(0,f.hold-dt);
      // The terminal male's U-swim: a fast dive under the harem and back up the far side.
      // Shapiro's counts make this and the nose rush male-only — a female performs them at
      // effectively zero rate — so it is the single movement that sexes the fish on sight.
      if(f.kind==='anthias'&&!f.rank){
        f.show-=dt;
        if(f.show<=0){f.display=USWIM;f.show=11+this.random()*13;}
        if(f.display>0)f.display=Math.max(0,f.display-dt);
      }
      if(f.goalTimer<=0||(!f.hold&&p.distanceToSquared(f.goal)<.10))this.chooseGoal(f);
      else if(f.shoal>=0&&!f.hold)this.station(f,f.goal); // the slot travels with its shoal
      let goal=f.goal,food=null,nearest=2.5**2;
      if(f.alarm>0){
        f.state='shelter';
        // A percula backs into the tentacles; every open-water fish goes down to the
        // structure its shoal is attached to — the chromis into the branches of their own
        // coral head in unison, the anthias to the arch and the holes in it. The chromis
        // goal sits inside the colony's own envelope, so the pod presses down onto the
        // branches and the obstacle field is what stops it, rather than hovering politely
        // above the coral it is supposed to be hiding in.
        if(f.kind==='clown')this._desired.set(HOST.x+(f.rank-1)*.44,HOST.y+.50,HOST.z+.30);
        else{const s=this.shoals[f.shoal].shelter;this._desired.set(s.x+(p.x-s.x)*.30,s.y+(f.kind==='chromis'?.55:1.05),s.z+(p.z-s.z)*.30);}
        goal=this._desired;
      }else if(f.display>0){
        f.state='display';
        const s=this.shoals[f.shoal],k=1-f.display/USWIM;
        this._desired.set(s.centre.x+(k*2-1)*2.1,s.centre.y+.40-Math.sin(k*Math.PI)*1.75,s.centre.z+.30);
        goal=this._desired;
      }else{
        f.state=f.hold?(f.kind==='clown'?'bathe':'clean'):'forage';
        for(const item of this.food)if(item.active){
          if(f.kind==='clown'&&((item.position.x-HOST.x)**2+(item.position.y-HOST.y-.7)**2+(item.position.z-HOST.z)**2)>10)continue;
          const d=p.distanceToSquared(item.position);if(d<nearest){nearest=d;food=item;goal=item.position;}
        }
        if(food)f.state='feed';
      }
      // A fish being cleaned, or one wallowing in the tentacles, is barely swimming.
      const topSpeed=(f.kind==='clown'?.59:f.kind==='anthias'?.62:.87)*(f.alarm>0?1.65:f.display>0?1.5:food?1.3:f.hold&&p.distanceToSquared(f.goal)<.5?.16:1);
      this._delta.subVectors(goal,p);const dist=this._delta.length();
      this._force.copy(this._delta).multiplyScalar(dist>1e-5?Math.min(topSpeed,dist*.68)/dist:0);
      this._force.sub(this._flow); // swim velocity relative to the moving water
      this._sep.set(0,0,0);this._cohesion.set(0,0,0);this._align.set(0,0,0);let neighbors=0;
      for(let j=0;j<this.fish.length;j++)if(j!==index){
        const other=this.fish[j],q=old[j].p;this._delta.subVectors(p,q);const d2=this._delta.lengthSq();
        // Open-water fish keep well over a body length between them; the clownfish crowd.
        const personal=(f.size+other.size)*(f.kind==='clown'?.46:.82);
        if(d2<personal*personal&&d2>1e-8)this._sep.addScaledVector(this._delta,(personal-Math.sqrt(d2))/d2*(f.kind==='clown'&&other.kind==='clown'&&f.rank>other.rank?1.9:1.1));
        if(f.kind!=='clown'&&other.kind===f.kind&&d2<7.84&&d2>.18){this._cohesion.add(q);this._align.add(old[j].v);neighbors++;}
        // Only a fresh bolt recruits, so the alarm cannot circulate back round the school
        // and hold it up indefinitely.
        if(f.alarm<=0&&f.spook<=0&&other.kind===f.kind&&old[j].alarm>1.9&&d2<4.0)f.spook=.055;
      }
      this._force.addScaledVector(this._sep,1.30);
      // Stations already hold the shoal together, so cohesion only softens the edges;
      // alignment is what makes a turn run through the group.
      if(neighbors&&f.alarm<=0&&!food){
        this._cohesion.multiplyScalar(1/neighbors).sub(p);this._align.multiplyScalar(1/neighbors).sub(f.velocity);
        this._force.addScaledVector(this._cohesion,.055).addScaledVector(this._align,.30);
      }
      // Non-host fish avoid cnidarian tentacles; residents can enter the living crown.
      if(f.kind!=='clown'){
        this._delta.set(p.x-HOST.x,(p.y-HOST.y-.55)*1.2,p.z-HOST.z);
        const d=this._delta.length();if(d<2.4&&d>.001)this._force.addScaledVector(this._delta,(2.4-d)/d*1.9);
      }
      // Anticipatory ellipsoid avoidance before position integration.
      const own=f.kind==='chromis'?SHELTER+f.shoal:-1;
      for(let k=0;k<REEF_BOUNDS.length;k++){
        const o=REEF_BOUNDS[k],keep=k===own?.84:1.22;
        const mx=o[3]+f.size*.26,my=o[4]+f.size*.25,mz=o[5]+f.size*.25;
        const dx=(p.x+f.velocity.x*.6-o[0])/mx,dy=(p.y+f.velocity.y*.6-o[1])/my,dz=(p.z+f.velocity.z*.6-o[2])/mz;
        const d=Math.hypot(dx,dy,dz);
        if(d<keep&&d>1e-6){this._delta.set(dx/mx,dy/my,dz/mz).normalize();this._force.addScaledVector(this._delta,(keep-d)*2.6);}
      }
      if(p.y<.55)this._force.y+=(.55-p.y)*2;
      if(p.y>TANK.surface-.6)this._force.y-=(p.y-(TANK.surface-.6))*2;
      if(Math.abs(p.x)>8)this._force.x-=Math.sign(p.x)*(Math.abs(p.x)-8)*2;
      if(p.z>4.5)this._force.z-=(p.z-4.5)*2;
      if(p.z<TANK.back+.45)this._force.z+=(TANK.back+.45-p.z)*3;
      limitVector(this._force,topSpeed);
      this._relative.copy(f.velocity).sub(this._flow);
      this._force.sub(this._relative).multiplyScalar(2.4);
      limitVector(this._force,f.alarm>0?2.3:1.35);
      f.effort+=(this._force.length()*.7-f.effort)*(1-Math.exp(-dt*3));
      f.velocity.addScaledVector(this._force,dt);limitVector(f.velocity,1.7);p.addScaledVector(f.velocity,dt);
      // Robust final nonpenetration for rocks. Smooth steering normally keeps this idle.
      for(let k=0;k<REEF_BOUNDS.length;k++){
        const o=REEF_BOUNDS[k],shrink=k===own?.70:1;
        const rx=(o[3]+f.size*.19)*shrink,ry=(o[4]+f.size*.18)*shrink,rz=(o[5]+f.size*.19)*shrink;
        const dx=(p.x-o[0])/rx,dy=(p.y-o[1])/ry,dz=(p.z-o[2])/rz,d=Math.hypot(dx,dy,dz);
        if(d<1&&d>1e-7){
          p.set(o[0]+dx/d*rx,o[1]+dy/d*ry,o[2]+dz/d*rz);
          this._delta.set(dx/rx,dy/ry,dz/rz).normalize();const into=f.velocity.dot(this._delta);if(into<0)f.velocity.addScaledVector(this._delta,-into);
        }
      }
      p.y=clamp(p.y,groundHeight(p.x,p.z)+.2,TANK.surface-.18);p.x=clamp(p.x,TANK.left+.25,TANK.right-.25);p.z=clamp(p.z,TANK.back+.22,TANK.front-.3);
      this._relative.copy(f.velocity).sub(this._flow);
      const speed=this._relative.length();
      if(speed>.022){
        const targetYaw=Math.atan2(-this._relative.z,this._relative.x);
        const angle=Math.atan2(Math.sin(targetYaw-f.yaw),Math.cos(targetYaw-f.yaw));
        const turn=clamp(angle,-2.4*dt,2.4*dt);f.yaw+=turn;
        f.bank+=(clamp(-turn/dt*.06,-.18,.18)-f.bank)*(1-Math.exp(-dt*4));
        f.pitch+=(clamp(Math.atan2(this._relative.y,Math.hypot(this._relative.x,this._relative.z)),-.42,.42)-f.pitch)*(1-Math.exp(-dt*4));
      }
      // percula rows with its pectorals and the body rocks against the stroke. The waddle
      // is the species' walk, not a symptom of hurrying, so it rides on the bank angle at
      // the pectoral beat rather than replacing it.
      f.roll=f.bank+(f.kind==='clown'?Math.sin(f.phase*2.6)*.155:0);
      // Tail frequency depends on swim speed through water, not ground speed.
      f.phase+=dt*Math.PI*2*(1.0+speed*2.4+f.effort*.40);f.lastSpeed=speed;
      if(food&&p.distanceToSquared(food.position)<(f.size*.42)**2){food.active=false;this.consumed++;f.goalTimer=0;}
    }
    for(const s of this.shrimp){
      s.timer-=dt;s.phase+=dt;
      if(s.timer<0){s.state=s.state==='advertise'?'graze':'advertise';s.timer=4+this.random()*6;}
      const near=this.fish.some(f=>f.position.distanceToSquared(s.position)<2.2);
      const speed=s.state==='graze'?.034:0;s.walk=speed;s.step+=speed*dt*28;
      // Feet stay attached to a small known rock/sand patch. Movement is centimetre-scale.
      s.position.x=s.home.x+Math.sin(s.phase*.17)*.085;
      s.position.z=s.home.z+Math.sin(s.phase*.13)*.055;
      s.yaw+=(Math.sin(s.phase*.12)*.20+(s.home.x>0?.30:2.8)-s.yaw)*dt*.3;
      s.signal=near?1.8:1;
    }
  }
  diagnostics(){
    return {time:this.time,steps:this.steps,population:POPULATION,food:this.food.filter(p=>p.active).length,consumed:this.consumed,
      maxSpeed:Math.max(...this.fish.map(f=>f.velocity.length())),finite:this.fish.every(f=>[...f.position,...f.velocity,f.yaw,f.phase].every(Number.isFinite))};
  }
}

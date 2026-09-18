import * as THREE from 'three';
import { randomGenerator, clamp, groundHeight, limitVector } from './math.js';
import { currentAt } from './water.js';
import { HOST, ROCKS, STATIONS, TANK, CORAL_BOUNDS } from './layout.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
export const FIXED_STEP=1/60;
export const POPULATION={clownfish:3,chromis:9,anthias:4,shrimp:2};
const REEF_BOUNDS=[...ROCKS,...CORAL_BOUNDS];
// Open-water fish hold a station inside a shoal rather than steering for themselves.
// Two chromis pods let the shoal split and rejoin; the anthias hover as one loose group
// high in the column, where they pick plankton out of the pump flow.
const SHOALS=[
  {kind:'chromis',centre:[-2.3,4.55,-.30],spread:[2.45,1.20,1.65]},
  {kind:'chromis',centre:[2.2,4.20,.65],spread:[2.20,1.10,1.50]},
  {kind:'anthias',centre:[3.4,5.85,-1.55],spread:[2.30,.95,1.30]},
];

export class ReefSimulation {
  constructor(seed=36719) {
    this.random=randomGenerator(seed);this.time=0;this.fish=[];this.food=Array.from({length:32},()=>({active:false,position:V(),velocity:V(),age:0,size:0}));
    this.lastFeed=-10;this.consumed=0;this.steps=0;
    this._flow=V();this._delta=V();this._desired=V();this._force=V();this._sep=V();this._cohesion=V();this._align=V();this._relative=V();
    this.shoals=SHOALS.map(s=>({kind:s.kind,spread:s.spread,centre:V(...s.centre),goal:V(...s.centre),timer:0}));
    const initial=[[-5.15,4.18,2.1],[-2.78,3.99,1.85],[-3.54,3.85,2.35]];
    for(let i=0;i<3;i++)this.add('clown',initial[i],[.84,.66,.48][i],i);
    for(let i=0;i<9;i++)this.add('chromis',null,.44+this.random()*.19,i,i%2);
    // Rank 0 is the terminal male: larger, and holding station above the harem.
    for(let i=0;i<4;i++)this.add('anthias',null,(i?.50:.72)+this.random()*.15,i,2);
    this.previous=this.fish.map(()=>({p:V(),v:V()}));
    this.shrimp=STATIONS.map((p,i)=>({position:V(p.x,p.y,p.z),home:V(p.x,p.y,p.z),yaw:i===0?.30:2.8,phase:i*2.4,state:'advertise',timer:3+i*2,step:0,walk:0}));
  }
  add(kind,position,size,rank,shoal=-1) {
    const r=this.random;
    const f={kind,rank,size,shoal,station:V(r()*2-1,r()*2-1,r()*2-1),position:V(),velocity:V(kind==='clown'?.11:-.28,0,.02),goal:V(),goalTimer:0,phase:r()*6.28,effort:0,yaw:kind==='clown'?0:Math.PI,pitch:0,roll:0,alarm:0,state:'forage',lastSpeed:0};
    if(position)f.position.set(...position);else this.station(f,f.position);
    f.goal.copy(f.position);this.fish.push(f);return f;
  }
  // Where this animal's slot in its shoal currently sits.
  station(f,out) {
    const s=this.shoals[f.shoal];
    return out.set(s.centre.x+f.station.x*s.spread[0],s.centre.y+f.station.y*s.spread[1]+(f.kind==='anthias'&&!f.rank?.62:0),s.centre.z+f.station.z*s.spread[2]);
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
      const a=r()*Math.PI*2, radius=.40+r()*(f.rank===0?1.45:f.rank===1?1.1:.75);
      f.goal.set(HOST.x+Math.cos(a)*radius,HOST.y+.77+r()*.96-f.rank*.13,HOST.z+.37+Math.sin(a)*radius*.56);
      f.goalTimer=2.8+r()*4.4;return;
    }
    // A slot drifts rather than being redrawn, so a fish keeps its place in the layer it
    // is in; a chromis occasionally changes pod, which is what splits the shoal. Anthias
    // hold their slot far longer, so they hang nose-on to the flow instead of touring.
    const hold=f.kind==='anthias'?.72:.50,churn=1-hold;
    f.station.set(f.station.x*hold+(r()*2-1)*churn,f.station.y*hold+(r()*2-1)*churn,f.station.z*hold+(r()*2-1)*churn);
    if(f.kind==='chromis'&&r()<.14)f.shoal=1-f.shoal;
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
    // Shoals wander the open column above the arch. The anthias ride higher and move
    // slower, so the group hangs in the flow instead of touring the tank.
    for(const s of this.shoals) {
      s.timer-=dt;
      if(s.timer<=0){
        const r=this.random,high=s.kind==='anthias';
        s.goal.set(high?-1.2+r()*7.8:-5.4+r()*10.6,(high?5.05:3.75)+r()*(high?1.25:1.85),-2.3+r()*(high?3.2:4.3));
        s.timer=(high?14:9)+this.random()*10;
      }
      s.centre.lerp(s.goal,1-Math.exp(-dt*(s.kind==='anthias'?.085:.14)));
    }
    // Read neighbours from a snapshot: no order-dependent following of already-updated fish.
    const old=this.previous;
    for(let i=0;i<this.fish.length;i++){old[i].p.copy(this.fish[i].position);old[i].v.copy(this.fish[i].velocity);}
    for(let index=0;index<this.fish.length;index++) {
      const f=this.fish[index],p=f.position;
      currentAt(p,t,this._flow);
      f.alarm=Math.max(0,f.alarm-dt);f.goalTimer-=dt;
      if(pointer&&pointer.speed>.9&&p.distanceToSquared(pointer.position)<8.5)f.alarm=2.6;
      if(f.goalTimer<=0||p.distanceToSquared(f.goal)<.10)this.chooseGoal(f);
      else if(f.shoal>=0)this.station(f,f.goal); // the slot travels with its shoal
      let goal=f.goal,food=null,nearest=2.5**2;
      if(f.alarm>0){
        f.state='shelter';
        if(f.kind==='clown')this._desired.set(HOST.x+(f.rank-1)*.44,HOST.y+.50,HOST.z+.30);
        else this._desired.set(p.x,Math.max(3.1,p.y-.7),p.z-1.5);
        goal=this._desired;
      }else{
        f.state='forage';
        for(const item of this.food)if(item.active){
          if(f.kind==='clown'&&((item.position.x-HOST.x)**2+(item.position.y-HOST.y-.7)**2+(item.position.z-HOST.z)**2)>10)continue;
          const d=p.distanceToSquared(item.position);if(d<nearest){nearest=d;food=item;goal=item.position;}
        }
        if(food)f.state='feed';
      }
      const topSpeed=(f.kind==='clown'?.59:f.kind==='anthias'?.62:.87)*(f.alarm>0?1.65:food?1.3:1);
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
      for(const o of REEF_BOUNDS){
        const mx=o[3]+f.size*.26,my=o[4]+f.size*.25,mz=o[5]+f.size*.25;
        const dx=(p.x+f.velocity.x*.6-o[0])/mx,dy=(p.y+f.velocity.y*.6-o[1])/my,dz=(p.z+f.velocity.z*.6-o[2])/mz;
        const d=Math.hypot(dx,dy,dz);
        if(d<1.22&&d>1e-6){this._delta.set(dx/mx,dy/my,dz/mz).normalize();this._force.addScaledVector(this._delta,(1.22-d)*2.6);}
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
      for(const o of REEF_BOUNDS){
        const rx=o[3]+f.size*.19,ry=o[4]+f.size*.18,rz=o[5]+f.size*.19;
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
        f.roll+=(clamp(-turn/dt*.06,-.18,.18)-f.roll)*(1-Math.exp(-dt*4));
        f.pitch+=(clamp(Math.atan2(this._relative.y,Math.hypot(this._relative.x,this._relative.z)),-.42,.42)-f.pitch)*(1-Math.exp(-dt*4));
      }
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

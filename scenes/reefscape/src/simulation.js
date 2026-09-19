import * as THREE from 'three';
import { randomGenerator, clamp, groundHeight, limitVector } from './math.js';
import { currentAt } from './water.js';
import { supportHeight } from './terrain.js';
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
  {kind:'chromis',home:[THICKETS[0].x+1.10,THICKETS[0].top-.18,THICKETS[0].z+.75],spread:[1.10,.52,.96],reach:.32,rove:[.42,.18,.38],lead:.78,shelter:THICKETS[0],tour:[110,190]},
  {kind:'chromis',home:[THICKETS[1].x-1.10,THICKETS[1].top-.22,THICKETS[1].z+.80],spread:[1.06,.50,.92],reach:.32,rove:[.40,.16,.36],lead:.74,shelter:THICKETS[1],tour:[120,210]},
  {kind:'anthias',home:[PROMONTORY.x,PROMONTORY.y+1.75,PROMONTORY.z+.75],spread:[2.10,.95,1.25],reach:.48,rove:[.80,.38,.58],lead:1.35,shelter:PROMONTORY,tour:[50,100]},
];
// The open water a shoal or a wanderer may tour: the column in front of and above the
// hardscape, clear of every rock and coral envelope.
const OPEN={x:[-7.2,7.2],y:[3.6,7.3],z:[.2,4.4]};
// Gait per species. A fish is not a boat: it points where it goes, speed comes in bouts of
// tail beats separated by straight-bodied glides — the burst-and-coast that saves a small
// fish about half its energy — and the tail-beat rate climbs with speed along Bainbridge's
// line, here written in tank units for each species' body length (`hz` at rest and per
// unit of speed). `thrust` is how quickly a bout brings the fish up to what it wants,
// `drag` how fast a glide bleeds it off, `bout` and `glide` their lengths in seconds, `idle`
// the speed below which the tail merely idles against the flow instead of bouting, `slip`
// the sideways speed the pectorals can manage while hovering, `turn` the cruising yaw
// rate, and `pectoral` the rowing rate at rest. percula is labriform — it rows with its
// pectorals at 2.4–4.6 Hz and only a burst brings the tail in — so its `tail` is a fraction.
const GAIT={
  clown:{hz:[1.7,2.4],thrust:2.6,drag:1.6,bout:[.35,.6],glide:[.3,.7],idle:.16,slip:.22,turn:2.4,pectoral:2.6,tail:.32},
  chromis:{hz:[1.9,3.4],thrust:2.6,drag:1.15,bout:[.45,.85],glide:[.5,1.5],idle:.13,slip:.12,turn:3.0,pectoral:2.2,tail:1},
  anthias:{hz:[1.7,2.6],thrust:2.2,drag:1.0,bout:[.5,1.0],glide:[.6,1.7],idle:.13,slip:.12,turn:2.6,pectoral:1.9,tail:1},
};

// The cleaner shrimp's own tunables. One unit is 10 cm and the modelled animal is about 0.9
// long. Nobody has published a kinematic study of Lysmata, so the structure here is the
// ethogram — long spells advertising, short repositioning walks, picking in between — run
// at rates borrowed from decapods that have been measured: a few centimetres a second, a
// step every 0.4 s, a tail flip of 130 ms that is 47% flexion.
const SHRIMP={
  wrap:2,        // s; every appendage rhythm in shrimp.js is a whole multiple of 0.5 Hz off this clock
  speed:.24,     // units/s over the rock
  stride:.095,   // ground covered per leg cycle. The leg shader swings each foot half of it
  pivot:.22,     // the radius a turn on the spot makes the feet walk, so pivoting still steps
  turn:1.4,      // rad/s
  square:1.2,    // rad of heading error it will walk through: a crayfish turns by shortening
                 // the strides on one side, not by pivoting, so only a target behind it
                 // has to be squared up to first
  range:.58,     // how far from its station it will wander
  arrive:.04,
  drop:.20,      // it refuses a foothold this far below its own shoulder
  grade:.62,     // or on ground this steep
  reach:1.35,    // units at which a client overhead is close enough to work on
  under:.16,     // how nearly beneath it the animal puts itself
  hold:.25,      // s a departed client goes on counting as one
  bout:.52,      // share of pauses that end in a walk, against `forage` in a spell of picking
  hike:.20,      // it does not get up to move less than this, so a bout is worth watching
  forage:.22,
  stand:4,       // s of advertising, plus up to five more
  rush:.81,      // (units/s)², what counts as a frightened body going past at speed
  startle:.72,   // units², and how close it has to pass
  flee:.95,      // s of tail flip and recovery
  flip:.13,      // s a flip takes, 47% of it flexion
  flips:2,       // two or three is the usual bout
  jet:2.4,       // units/s backwards while the abdomen is firing
  unroll:.62,    // how fast the abdomen straightens once the bout is over
};

export class ReefSimulation {
  constructor(seed=36719) {
    this.random=randomGenerator(seed);this.time=0;this.fish=[];this.food=Array.from({length:32},()=>({active:false,position:V(),velocity:V(),age:0,size:0}));
    this.lastFeed=-10;this.consumed=0;this.steps=0;
    this._flow=V();this._delta=V();this._desired=V();this._force=V();this._sep=V();this._cohesion=V();this._align=V();this._relative=V();this._heading=V();
    this.shoals=SHOALS.map(s=>({...s,home:V(...s.home),centre:V(...s.home),drift:V(),timer:0,swell:1,out:V(),legs:0,rest:s.tour[0]*(.4+.6*this.random())}));
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
    // The shrimp draw from their own stream. Sharing the fish's made every tuning of a walk
    // bout shift nineteen fish trajectories with it, which is a trap rather than a coupling.
    this.shrimpRandom=randomGenerator(seed^0x5bf03635);
    this.shrimp=STATIONS.map((p,i)=>({position:V(p.x,p.y,p.z),home:V(p.x,p.y,p.z),goal:V(p.x,p.y,p.z),yaw:i===0?.30:2.8,state:'advertise',timer:3+i*2,
      rhythm:i*.7,step:0,walk:0,pick:0,reach:0,curl:0,sway:0,signal:0,flick:0,sniff:0,burst:1+i,reverse:false}));
  }
  add(kind,position,size,rank,shoal=-1) {
    const r=this.random;
    const f={kind,rank,size,shoal,station:V(r()*2-1,r()*2-1,r()*2-1),position:V(),velocity:V(kind==='clown'?.11:-.28,0,.02),goal:V(),goalTimer:0,phase:r()*6.28,yaw:kind==='clown'?0:Math.PI,pitch:0,bank:0,roll:0,bend:0,turning:0,
      speed:.1,wave:0,beat:false,bout:r(),pectoral:r()*6.28,rowing:1,alarm:0,spook:0,state:'forage',hold:0,show:6+r()*9,display:0,roam:0,follow:null};
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
  // A point in the open column with a clear body length round it, for a tour or a wander.
  openWater(out) {
    const r=this.random;
    for(let attempt=0;attempt<12;attempt++){
      out.set(OPEN.x[0]+r()*(OPEN.x[1]-OPEN.x[0]),OPEN.y[0]+r()*(OPEN.y[1]-OPEN.y[0]),OPEN.z[0]+r()*(OPEN.z[1]-OPEN.z[0]));
      if(REEF_BOUNDS.every(o=>Math.hypot((out.x-o[0])/(o[3]+.7),(out.y-o[1])/(o[4]+.7),(out.z-o[2])/(o[5]+.7))>1)&&Math.hypot(out.x-HOST.x,out.y-HOST.y-.6,out.z-HOST.z)>2.6)break;
    }
    return out;
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
    // A wanderer on its way round the open water takes its next leg, and comes home only
    // when the legs run out; the shoalmates that left with it keep following instead.
    if(f.roam>0&&--f.roam>0){this.openWater(f.goal);f.goalTimer=7+r()*5;f.hold=0;return;}
    // A cleaner shrimp rocking its white antennae over a rock shoulder is advertising, and
    // a planktivore will leave the shoal to be worked over, hanging almost still above the
    // station for several seconds. Clownfish get cleaned at the anemone instead.
    const open=this.shrimp.filter(s=>s.state==='advertise');
    if(open.length&&r()<.045){
      const s=open[Math.floor(r()*open.length)%open.length];
      f.goal.set(s.position.x+(r()-.5)*.4,s.position.y+.50+r()*.22,s.position.z+.28);
      f.hold=f.goalTimer=5+r()*5;return;
    }
    // Neither species is tied to its rock the way a goby is: a chromis or an anthias will
    // leave the shoal for a turn round the open column and come back to its slot, and a
    // shoalmate close enough to see it go is likely to go with it. Those small breakaway
    // groups, two or three fish sweeping the tank together and rejoining, are what the
    // school does between alarms; the alignment below keeps them moving as one.
    if(r()<(f.kind==='chromis'?.018:.032)&&f.alarm<=0){
      f.roam=2+Math.floor(r()*2);this.openWater(f.goal);f.goalTimer=7+r()*5;f.hold=0;
      for(const o of this.fish)if(o!==f&&o.kind===f.kind&&o.roam<=0&&!o.follow&&o.hold<=0&&o.position.distanceToSquared(f.position)<2.6&&r()<.40)o.follow=f;
      return;
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
  // Turn the wanted swim velocity into what a fish can actually do with it. The heading
  // turns at a bounded rate and the body bends into the turn; thrust only acts along the
  // heading, so a fish pointed the wrong way slows, pivots and goes, rather than sliding
  // sideways to its goal. Speed rides the bout-and-glide cycle, and when there is nowhere
  // to go the tail falls still and the pectorals take over the hovering.
  swim(f,want,dt) {
    const g=GAIT[f.kind],r=this.random,demand=want.length(),ease=k=>1-Math.exp(-dt*k);
    if(demand>.02){
      const yawTo=Math.atan2(-want.z,want.x),angle=Math.atan2(Math.sin(yawTo-f.yaw),Math.cos(yawTo-f.yaw));
      // A hovering fish pivots on its pectorals, slowly; a fish under way turns on an arc.
      const rate=g.turn*(f.alarm>0?2.4:.4+.6*clamp(f.speed/.35,0,1));
      const turn=clamp(angle*5*dt,-rate*dt,rate*dt);f.yaw+=turn;f.turning+=(turn/dt-f.turning)*ease(12);
      f.pitch+=(clamp(Math.atan2(want.y,Math.hypot(want.x,want.z)),-.45,.45)-f.pitch)*ease(3);
    }else{f.turning*=1-ease(6);f.pitch*=1-ease(1);}
    f.bend+=(clamp(f.turning*.13,-.34,.34)-f.bend)*ease(7);
    f.bank+=(clamp(-f.turning*.06,-.18,.18)-f.bank)*ease(4);
    const h=this._heading.set(Math.cos(f.yaw)*Math.cos(f.pitch),Math.sin(f.pitch),-Math.sin(f.yaw)*Math.cos(f.pitch));
    // Only the part of the wanted velocity that lies ahead can be swum for; a scare
    // overrides that, because a bolting fish beats first and steers as it goes.
    const target=f.alarm>0?demand:Math.max(0,h.dot(want));
    f.bout-=dt;
    if(target<g.idle&&f.alarm<=0){
      // Holding: the tail idles in proportion to the flow it is holding against.
      f.beat=false;f.speed+=(target-f.speed)*ease(4);f.wave+=(target/g.idle*.45*g.tail-f.wave)*ease(6);
    }else if(f.beat){
      f.speed+=(target*1.25-f.speed)*ease(g.thrust*(f.alarm>0?1.8:1));f.wave+=((f.alarm>0?1:g.tail)-f.wave)*ease(14);
      if(f.bout<=0){if(f.alarm>0)f.bout=.25;else{f.beat=false;f.bout=g.glide[0]+r()*(g.glide[1]-g.glide[0]);}}
    }else{
      f.speed*=Math.exp(-g.drag*dt);f.wave*=Math.exp(-dt*9);
      if(f.alarm>0||(f.bout<=0&&f.speed<target*.86)){f.beat=true;f.bout=g.bout[0]+r()*(g.bout[1]-g.bout[0]);}
    }
    const hz=g.hz[0]+g.hz[1]*f.speed;
    if(f.wave>.02)f.phase+=dt*Math.PI*2*hz;
    // Pectorals row constantly while the fish hovers and tuck in during a bout; on the
    // clownfish they are the engine, so they row the whole time and quicken with speed.
    const rowing=f.kind==='clown'?1:f.beat?.25:1;
    f.rowing+=(rowing-f.rowing)*ease(8);f.pectoral+=dt*Math.PI*2*(g.pectoral+(f.kind==='clown'?3.:1.2)*f.speed);
    // Sideways and vertical trim that the pectorals manage on their own, small enough to
    // read as a hovering fish holding its place and gone once it is under way.
    this._relative.copy(want).addScaledVector(h,-h.dot(want));
    limitVector(this._relative,g.slip*(1-clamp((f.speed-.08)/.3,0,1)));
    f.velocity.copy(this._flow).addScaledVector(h,f.speed).add(this._relative);
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
    // Every so often the whole shoal goes on a tour instead, a slow loop of two or three
    // legs through the open column before it settles back over its structure.
    for(let i=0;i<this.shoals.length;i++) {
      const s=this.shoals[i];
      currentAt(s.home,t,this._flow);
      s.timer-=dt;s.rest-=dt;
      if(s.timer<=0){const r=this.random;s.drift.set((r()*2-1)*s.rove[0],(r()*2-1)*s.rove[1],(r()*2-1)*s.rove[2]);s.timer=7+r()*9;}
      if(s.legs>0){
        if(s.centre.distanceToSquared(s.out)<1.2){s.legs--;if(s.legs>0)this.openWater(s.out);else s.rest=s.tour[0]+this.random()*(s.tour[1]-s.tour[0]);}
        this._desired.copy(s.out);
      }else{
        if(s.rest<=0&&this.fish.every(f=>f.shoal!==i||f.alarm<=0)){s.legs=2+Math.floor(this.random()*2);this.openWater(s.out);}
        this._desired.copy(s.home).add(s.drift);
        this._desired.x-=Math.tanh(this._flow.x*5)*s.lead;
      }
      s.centre.lerp(this._desired,1-Math.exp(-dt*(s.legs>0?.30:s.kind==='anthias'?.28:.42)));
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
      // A follower's goal is its leader's flank for as long as the leader is out roaming.
      if(f.follow&&(f.follow.roam<=0&&f.follow.state!=='roam'||f.alarm>0))f.follow=null;
      if(f.follow){f.goal.copy(f.follow.position).addScaledVector(f.station,1.2);f.goalTimer=1;}
      else if(f.goalTimer<=0||(!f.hold&&p.distanceToSquared(f.goal)<.10))this.chooseGoal(f);
      else if(f.shoal>=0&&!f.hold&&f.roam<=0&&f.state!=='roam')this.station(f,f.goal); // the slot travels with its shoal
      let goal=f.goal,food=null,nearest=2.5**2;
      if(f.alarm>0){
        f.state='shelter';f.roam=0;
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
        f.state=f.hold?(f.kind==='clown'?'bathe':'clean'):f.roam>0||f.follow?'roam':'forage';
        for(const item of this.food)if(item.active){
          if(f.kind==='clown'&&((item.position.x-HOST.x)**2+(item.position.y-HOST.y-.7)**2+(item.position.z-HOST.z)**2)>10)continue;
          const d=p.distanceToSquared(item.position);if(d<nearest){nearest=d;food=item;goal=item.position;}
        }
        if(food)f.state='feed';
      }
      // A fish being cleaned, or one wallowing in the tentacles, is barely swimming.
      const topSpeed=(f.kind==='clown'?.59:f.kind==='anthias'?.70:.92)*(f.alarm>0?1.65:f.display>0?1.5:food?1.3:f.hold&&p.distanceToSquared(f.goal)<.5?.16:1);
      this._delta.subVectors(goal,p);const dist=this._delta.length();
      this._force.copy(this._delta).multiplyScalar(dist>1e-5?Math.min(topSpeed,dist*.68)/dist:0);
      this._force.sub(this._flow); // swim velocity relative to the moving water
      this._sep.set(0,0,0);this._cohesion.set(0,0,0);this._align.set(0,0,0);let neighbors=0;
      for(let j=0;j<this.fish.length;j++)if(j!==index){
        const other=this.fish[j],q=old[j].p;this._delta.subVectors(p,q);const d2=this._delta.lengthSq();
        // Open-water fish keep well over a body length between them; the clownfish crowd.
        const personal=(f.size+other.size)*(f.kind==='clown'?.46:1.0);
        if(d2<personal*personal&&d2>1e-8)this._sep.addScaledVector(this._delta,(personal-Math.sqrt(d2))/d2*(f.kind==='clown'&&other.kind==='clown'&&f.rank>other.rank?1.9:1.1));
        if(f.kind!=='clown'&&other.kind===f.kind&&d2<7.84&&d2>.18){this._cohesion.add(q);this._align.add(old[j].v);neighbors++;}
        // Only a fresh bolt recruits, so the alarm cannot circulate back round the school
        // and hold it up indefinitely.
        if(f.alarm<=0&&f.spook<=0&&other.kind===f.kind&&old[j].alarm>1.9&&d2<4.0)f.spook=.055;
      }
      this._force.addScaledVector(this._sep,1.8);
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
      this.swim(f,this._force,dt);
      limitVector(f.velocity,1.7);p.addScaledVector(f.velocity,dt);
      // Robust final nonpenetration for rocks. Smooth steering normally keeps this idle.
      for(let k=0;k<REEF_BOUNDS.length;k++){
        const o=REEF_BOUNDS[k],shrink=k===own?.70:1;
        const rx=(o[3]+f.size*.19)*shrink,ry=(o[4]+f.size*.18)*shrink,rz=(o[5]+f.size*.19)*shrink;
        const dx=(p.x-o[0])/rx,dy=(p.y-o[1])/ry,dz=(p.z-o[2])/rz,d=Math.hypot(dx,dy,dz);
        if(d<1&&d>1e-7){
          p.set(o[0]+dx/d*rx,o[1]+dy/d*ry,o[2]+dz/d*rz);
          this._delta.set(dx/rx,dy/ry,dz/rz).normalize();const into=f.velocity.dot(this._delta);if(into<0){f.velocity.addScaledVector(this._delta,-into);f.speed*=.5;}
        }
      }
      p.y=clamp(p.y,groundHeight(p.x,p.z)+.2,TANK.surface-.18);p.x=clamp(p.x,TANK.left+.25,TANK.right-.25);p.z=clamp(p.z,TANK.back+.22,TANK.front-.3);
      // percula rows with its pectorals and the body rocks against the stroke. The waddle
      // is the species' walk, not a symptom of hurrying, so it rides on the bank angle at
      // the pectoral beat rather than replacing it.
      f.roll=f.bank+(f.kind==='clown'?Math.sin(f.pectoral)*.155:0);
      if(food&&p.distanceToSquared(food.position)<(f.size*.42)**2){food.active=false;this.consumed++;f.goalTimer=0;}
    }
    this.stepShrimp(dt,pointer);
  }
  // A cleaner shrimp lives on one rock shoulder. Most of its day is spent standing over it
  // advertising — whipping the long white antennae, which precedes four cleans in five, and
  // rocking the white first pair of legs fore and aft, which is the display Caves measured
  // in this species rather than the whole-body sway of the swimming cleaners — broken by
  // short walks to reposition and longer spells picking at the rock with the two chelate
  // pairs. Fish only steer for a shrimp that is advertising (`chooseGoal`); one that arrives
  // is turned to, stepped under and reached at. A tail flip is the only violent thing the
  // animal does and only a body going past at speed sets it off.
  stepShrimp(dt,pointer) {
    const r=this.shrimpRandom;
    // A foot only goes down where the rock is: refuse a foothold off the shoulder, one that
    // drops away from it, or one on ground too steep to stand on.
    const tread=(s,x,z)=>(x-s.home.x)**2+(z-s.home.z)**2<=SHRIMP.range**2
      &&Math.abs(supportHeight(x,z)-supportHeight(s.home.x,s.home.z))<=SHRIMP.drop
      &&Math.hypot(supportHeight(x+.12,z)-supportHeight(x-.12,z),supportHeight(x,z+.12)-supportHeight(x,z-.12))<=SHRIMP.grade*.24;
    // Square up onto the bearing first and only then walk it. Returns how far off the target
    // still was, so the caller can tell arrival from a step that is going nowhere.
    const toward=(s,tx,tz,astern,near)=>{
      const dx=tx-s.position.x,dz=tz-s.position.z,range=Math.hypot(dx,dz);
      const bearing=Math.atan2(-dz,dx)+(astern?Math.PI:0)-s.yaw;
      const off=Math.atan2(Math.sin(bearing),Math.cos(bearing));
      const turn=clamp(off,-SHRIMP.turn*dt,SHRIMP.turn*dt);s.yaw+=turn;
      let gone=0;
      if(Math.abs(off)<SHRIMP.square&&range>near){
        gone=Math.min(SHRIMP.speed*dt,range-near);
        const x=s.position.x+dx/range*gone,z=s.position.z+dz/range*gone;
        if(tread(s,x,z)){s.position.x=x;s.position.z=z;}else{gone=0;s.timer=0;}
      }
      // Ground covered drives the gait — by the feet as much as by the body, so a turn on
      // the spot steps too — and nothing else does, so the legs can never skate.
      s.step=(s.step+((astern?-gone:gone)+Math.abs(turn)*SHRIMP.pivot)/SHRIMP.stride+1)%1;
      return range;
    };
    for(const s of this.shrimp) {
      s.rhythm=(s.rhythm+dt)%SHRIMP.wrap;s.timer-=dt;
      s.position.y=supportHeight(s.position.x,s.position.z);
      let client=null,nearest=SHRIMP.reach**2;
      for(const f of this.fish)if(f.state==='clean'){const d=f.position.distanceToSquared(s.position);if(d<nearest){nearest=d;client=f;}}
      // Caridoid escape. Only a body going past at speed sets it off, never the client
      // hanging still overhead, so it stays the rarity it is in an undisturbed tank.
      if(s.state!=='escape'&&!client&&((pointer&&pointer.speed>1.2&&pointer.position.distanceToSquared(s.position)<SHRIMP.startle)
        ||this.fish.some(f=>f.alarm>0&&f.velocity.lengthSq()>SHRIMP.rush&&f.position.distanceToSquared(s.position)<SHRIMP.startle))){s.state='escape';s.timer=SHRIMP.flee;}
      let stepping=false;
      if(s.state==='escape'){
        const age=SHRIMP.flee-s.timer,bout=SHRIMP.flip*SHRIMP.flips;
        if(age<bout){
          // Flexion is 47% of the stroke and the abdomen never straightens fully between
          // flips, which is why a bout reads as one movement and not as two twitches.
          const k=(age%SHRIMP.flip)/SHRIMP.flip;s.curl=k<.47?k/.47:1-(k-.47)/.53*.70;
          if(k<.47){const x=s.position.x-Math.cos(s.yaw)*SHRIMP.jet*dt,z=s.position.z+Math.sin(s.yaw)*SHRIMP.jet*dt;
            if(tread(s,x,z)){s.position.x=x;s.position.z=z;}}
        }else s.curl=Math.max(0,.30-(age-bout)*SHRIMP.unroll);
        // It goes over onto one side as it fires — within fifteen milliseconds of the first
        // flexion in Arnott's frames — and rights itself as the abdomen comes back down.
        s.sway=s.curl*1.3;
        if(s.timer<=0){s.state='advertise';s.timer=SHRIMP.stand+r()*5;}
      }else if(client){
        s.state='serve';s.timer=SHRIMP.hold;
        stepping=toward(s,client.position.x,client.position.z,false,SHRIMP.under)>SHRIMP.under;
      }else if(s.state==='walk'){
        stepping=true;
        if(toward(s,s.goal.x,s.goal.z,s.reverse,SHRIMP.arrive)<=SHRIMP.arrive)s.timer=0;
      }
      if(s.timer<=0){
        const roll=r();let footing=false;
        if(roll<SHRIMP.bout)for(let k=0;k<8&&!footing;k++){
          const a=r()*6.2832,d=SHRIMP.hike+r()*(SHRIMP.range-SHRIMP.hike),x=s.home.x+Math.cos(a)*d,z=s.home.z+Math.sin(a)*d;
          if(tread(s,x,z)&&(x-s.position.x)**2+(z-s.position.z)**2>SHRIMP.hike**2){s.goal.set(x,supportHeight(x,z),z);footing=true;}
        }
        // Carideans back out of places as readily as they walk into them.
        if(footing){s.state='walk';s.timer=1.2+r()*1.8;s.reverse=r()<.22;}
        else if(roll<SHRIMP.bout+SHRIMP.forage){s.state='pick';s.timer=2.5+r()*3.5;}
        else{s.state='advertise';s.timer=SHRIMP.stand+r()*5;}
      }
      // Rocking is elicited by a big dark shape overhead rather than by a fish as such, and
      // it runs four times as often at a predator-sized client as at a small one.
      const show=client?.62+.38*Math.min(1,client.size*1.3):s.state==='walk'?.10:s.state==='pick'?.26:s.state==='escape'?0:.58;
      s.signal+=(show-s.signal)*(1-Math.exp(-dt*2.4));
      s.walk+=((stepping?1:0)-s.walk)*(1-Math.exp(-dt*7));
      s.pick+=((s.state==='pick'?1:0)-s.pick)*(1-Math.exp(-dt*3));
      s.reach+=((s.state==='serve'?1:0)-s.reach)*(1-Math.exp(-dt*2.8));
      // Antennules flick in bursts of a few and then rest. A lobster's rate climbs from
      // under one a second to three and a half once there is food in the water, so the
      // bursts close up when this animal has something worth reading.
      if((s.burst-=dt)<=0){s.sniff=1-s.sniff;s.burst=s.sniff?1.4+r()*1.6:(1.2+r()*2.8)/(1+s.signal);}
      s.flick+=(s.sniff-s.flick)*(1-Math.exp(-dt*9));
      // The whole-body rock that goes with the antennal whip: the same two hertz, a couple
      // of millimetres of lean, and it grows with the signal rather than quickening.
      if(s.state!=='escape'){s.sway=Math.sin(12.566*s.rhythm)*s.signal;s.curl-=s.curl*(1-Math.exp(-dt*6));}
    }
  }
  diagnostics(){
    return {time:this.time,steps:this.steps,population:POPULATION,food:this.food.filter(p=>p.active).length,consumed:this.consumed,
      maxSpeed:Math.max(...this.fish.map(f=>f.velocity.length())),finite:this.fish.every(f=>[...f.position,...f.velocity,f.yaw,f.phase].every(Number.isFinite))};
  }
}

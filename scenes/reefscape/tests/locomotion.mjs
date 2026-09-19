import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../../riverscape/tests/three-loader.mjs',import.meta.url);
const { ReefSimulation,FIXED_STEP,GAIT }=await import('../src/simulation.js');
const { reefNavigation,clearWater,clearSegment }=await import('../src/navigation.js');
const { currentAt }=await import('../src/water.js');
const { createFishSchool }=await import('../src/fish-model.js');
const { HOST,TANK }=await import('../src/layout.js');
const THREE=await import('three');
const nav=reefNavigation(),seen=new Set([0]),queue=[0];
while(queue.length){const u=queue.shift();for(const [v] of nav.edges[u])if(!seen.has(v)){seen.add(v);queue.push(v);}}
assert.equal(seen.size,nav.nodes.length,'Navigation graph must have no isolated regions');
for(let i=0;i<nav.nodes.length;i+=7)for(let j=3;j<nav.nodes.length;j+=13){
  let prev=nav.nodes[i];const path=nav.route(prev,nav.nodes[j]);
  for(const point of path){assert.ok(clearWater(point));assert.ok(clearSegment(prev,point),'Path must not cut reef corners');prev=point;}
  assert.ok(prev.distanceTo(nav.nodes[j])<1e-6);
}

const flow=new THREE.Vector3(),heading=new THREE.Vector3(),relative=new THREE.Vector3();
const reports=[];
// Coverage is tested per animal, not merely by the shoal target. A target visiting the
// opposite island is useless if its fish are still tail-wagging back at the first one.
for(const seed of [36719,42,9001]){
  const sim=new ReefSimulation(seed);
  const stats=sim.fish.map(f=>({min:f.position.clone(),max:f.position.clone(),was:f.position.clone(),path:0,beats:0,coasts:0,active:0,idleTail:0,aligned:0,moving:0,hz:0}));
  let maxHost=0,maxStep=0;
  for(let k=0;k<180/FIXED_STEP;k++){
    sim.step(FIXED_STEP);
    sim.fish.forEach((f,i)=>{
      const s=stats[i],step=f.position.distanceTo(s.was);maxStep=Math.max(maxStep,step);
      s.path+=step;s.was.copy(f.position);s.min.min(f.position);s.max.max(f.position);
      assert.ok([f.speed,f.phase,f.tailAmplitude,f.tailHz,...f.position,...f.velocity].every(Number.isFinite));
      assert.ok(f.position.x>TANK.left&&f.position.x<TANK.right&&f.position.z>TANK.back&&f.position.z<TANK.front&&f.position.y<TANK.surface);
      // Includes the very first rendered frame: spawning inside coral caused a .3-unit snap.
      assert.ok(step<.045,`Fish ${i} snapped ${step} units at ${sim.time}, seed ${seed}`);
      if(f.kind==='clown'){maxHost=Math.max(maxHost,f.position.distanceTo(new THREE.Vector3(HOST.x,HOST.y,HOST.z)));return;}
      if(f.beat)s.beats++;else if(f.tailAmplitude<.008&&f.speed>.25)s.coasts++;
      if(f.tailAmplitude>.035){s.active++;s.hz+=f.tailHz;if(f.velocity.length()<.12)s.idleTail++;}
      currentAt(f.position,sim.time,flow);relative.copy(f.velocity).sub(flow);
      if(relative.length()>.28){s.moving++;heading.set(Math.cos(f.yaw)*Math.cos(f.pitch),Math.sin(f.pitch),-Math.sin(f.yaw)*Math.cos(f.pitch));if(heading.dot(relative)/relative.length()>.94)s.aligned++;}
    });
  }
  const free=stats.filter((_,i)=>sim.fish[i].kind!=='clown');
  for(const s of free){
    assert.ok(s.max.x-s.min.x>10,'Every non-clownfish must traverse most of the reef width');
    assert.ok(s.max.y-s.min.y>1.8&&s.max.z-s.min.z>2,'Roaming must include height and depth, not a horizontal rail');
    assert.ok(s.path>65,'Roaming fish must cover real distance');
    assert.ok(s.coasts>500,'There must be moving, quiet-tailed coasts');
    assert.ok(s.beats/(180/FIXED_STEP)>.15&&s.beats/(180/FIXED_STEP)<.62);
    assert.ok(s.idleTail/(s.active||1)<.10,'Strong tail motion must not mainly occur in place');
    assert.ok(s.aligned/(s.moving||1)>.94,'Swimming must follow the body heading through water');
  }
  assert.ok(maxHost<2.6,'Clownfish retain their host territory');
  reports.push({seed,minRoamingWidth:Math.min(...free.map(s=>s.max.x-s.min.x)),minRoamingDistance:Math.min(...free.map(s=>s.path)),maxStep,maxHost});
}
// A frightened chromis may enter its own shelter. Returning the avoidance envelope
// to full size must be gradual; an instantaneous radius change used to eject the fish.
const startled=new ReefSimulation(42),refugeFish=startled.fish.find(f=>f.kind==='chromis');
const before=startled.fish.map(f=>f.position.clone());let maxAccess=0;
for(let k=0;k<15/FIXED_STEP;k++){
  const pointer=k>=120&&k<210?{position:refugeFish.position.clone(),speed:8}:null;
  startled.step(FIXED_STEP,pointer);
  startled.fish.forEach((f,i)=>{
    assert.ok(f.position.distanceTo(before[i])<.045,'Shelter entry/recovery must not teleport a fish');
    before[i].copy(f.position);
  });
  maxAccess=Math.max(maxAccess,refugeFish.shelterAccess);
}
assert.ok(maxAccess>.95&&refugeFish.shelterAccess<.001,'Shelter access must open and then close smoothly');
// A controlled zero-demand fish settles with absolutely no renderer-added oscillation.
const still=new ReefSimulation(),fish=still.fish.find(f=>f.kind==='chromis'),zero=new THREE.Vector3();
still._flow.set(0,0,0);
for(let k=0;k<600;k++)still.swim(fish,zero,FIXED_STEP);
assert.ok(fish.tailAmplitude<1e-6&&fish.speed<1e-6);
const scene=new THREE.Scene(),school=createFishSchool(scene,still);school.update();
const group=school.groups.find(g=>g.fish.includes(fish)),index=group.fish.indexOf(fish);
assert.equal(group.data[index*4+1],Math.fround(fish.tailAmplitude),'Renderer must use the actual gait amplitude with no floor');
// Applying bank after heading/pitch must not rotate the model away from its swim vector.
fish.yaw=.7;fish.pitch=.4;fish.roll=.25;school.update();
const matrix=new THREE.Matrix4();group.mesh.getMatrixAt(index,matrix);
const forward=new THREE.Vector3(1,0,0).transformDirection(matrix);
heading.set(Math.cos(fish.yaw)*Math.cos(fish.pitch),Math.sin(fish.pitch),-Math.sin(fish.yaw)*Math.cos(fish.pitch));
assert.ok(forward.dot(heading)>.99999);
assert.ok(Object.values(GAIT).every(g=>g.stride>0&&g.length>0));
console.log(JSON.stringify({pass:true,roamingSeconds:540,alarmRecoverySeconds:15,navigationNodes:nav.nodes.length,reports},null,2));

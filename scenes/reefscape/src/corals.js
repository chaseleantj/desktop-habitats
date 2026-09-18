import * as THREE from 'three';
import { merge, tint, tube, ellipsoid, coralBranches, seaFan, massiveCoral, polyp, plateCoral } from './geometry.js';
import { underwater, responseGLSL } from './water.js';
import { randomGenerator, clamp } from './math.js';
import { supportHeight } from './terrain.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
// uv.x carries how far a vertex stands from its holdfast, and so how much of the
// flow it answers; the tissue material reads it instead of a per-colony constant.
const flexible=(g,root,span)=>{const p=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<p.count;i++)uv.setX(i,clamp((p.getY(i)-root)/span,0,1));return g;};

function coralTexture(repeat){
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),rng=randomGenerator(229),image=ctx.createImageData(256,256);
  for(let i=0;i<image.data.length;i+=4){let v=166+rng()*62;image.data[i]=image.data[i+1]=image.data[i+2]=v;image.data[i+3]=255;}ctx.putImageData(image,0,0);
  for(let j=-1;j<20;j++)for(let i=-1;i<20;i++){let x=i*14+(j%2)*7+(rng()-.5)*4,y=j*14+(rng()-.5)*4;ctx.fillStyle='#737373';ctx.beginPath();ctx.ellipse(x,y,2.2,3.1,rng(),0,Math.PI*2);ctx.fill();ctx.strokeStyle='#d7d7d7';ctx.lineWidth=1.5;ctx.stroke();}
  const texture=new THREE.CanvasTexture(c);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(...repeat);texture.anisotropy=4;return texture;
}

/** Every coral in the tank: stony skeletons are static, and only fleshy tissue
 *  and the gorgonian fans answer the flow. */
export function createCorals(scene){
  // Same corallite relief on branches and plates, but a plate's uv runs around
  // and across the whorl rather than along a branch, so it needs its own repeat.
  const rng=randomGenerator(22097),coralMap=coralTexture([2,2]),plateMap=coralTexture([9,1.5]);
  const branchMat=underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.76,bumpMap:coralMap,bumpScale:.030}),{key:'branching-coral',transmission:.05});
  // Acropora, needle-fine Seriatopora and stubby Montipora digitata, pigmented
  // the way they colour up under a blue-white reef lamp: dark encrusted feet,
  // saturated bodies, pale growing tips.
  const NEEDLE={thickness:.024,forks:3,roots:6,order:3,rise:.80,corallite:.08,blunt:0},FINGER={thickness:.070,forks:2,roots:16,order:1,rise:1.0,taper:.78,blunt:1,spread:.46};
  const branches=[
    coralBranches([-5.82,3.55,-1.00],2.15,1.05,39,'#8467ae','#d6e4f4',{roots:9,thickness:.030}),
    coralBranches([-7.10,2.60,-1.05],1.75,1.16,74,'#3d9a4d','#e2f4a8',{thickness:.030}),
    coralBranches([-4.35,3.08,-2.15],2.30,.99,122,'#ee7896','#ffdce4',NEEDLE),
    coralBranches([-2.52,1.06,2.05],.95,.88,318,'#e0832c','#f2b45e',FINGER),
    coralBranches([-7.63,.74,1.19],.95,1.12,231,'#5a5fbe','#d6dcf4',{thickness:.034}),
    coralBranches([5.45,2.88,-1.52],1.80,1.22,82,'#7d6bb8','#d8e6f6',{roots:9,thickness:.030}),
    coralBranches([7.34,2.52,-1.62],1.30,1.00,417,'#2f9c8c','#d2f2e6',{thickness:.032}),
    coralBranches([3.28,1.14,-1.52],1.60,.86,23,'#ee7896','#ffdce4',NEEDLE),
    coralBranches([4.30,.62,1.55],.84,.98,611,'#e0832c','#f2b45e',FINGER),
    // The arch lintel carries its own colonies; the cave beneath stays open.
    coralBranches([-.45,3.22,-1.14],.90,.86,707,'#4aa050','#9fd672',FINGER),
    coralBranches([1.34,3.54,-1.24],.85,.82,811,'#8a53bd','#d8dcf6',{thickness:.034,roots:6}),
  ];
  const coral=new THREE.Mesh(merge(branches),branchMat);coral.castShadow=coral.receiveShadow=true;scene.add(coral);

  const plateMat=underwater(new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.86,bumpMap:plateMap,bumpScale:.09}),{key:'plate-coral',transmission:.03});
  // Capricornis grows in overlapping whorls, so the big colonies get a second tier.
  const plates=[
    plateCoral([4.38,2.98,-.30],.60,180,'#5fb845','#e8f6b2',.42),plateCoral([4.88,2.62,.10],.46,183,'#57ae40','#e8f6b2',.32),
    plateCoral([-6.05,2.22,.30],.58,271,'#f0902e','#fce8b4',.42),plateCoral([-5.62,1.84,.70],.46,274,'#ec8a2c','#fce8b4',.30),
    plateCoral([-2.60,1.12,1.05],.52,276,'#dc6a46','#fad4b6',.34),plateCoral([3.02,1.38,.58],.50,342,'#46a4cc','#def4fa',.32),
    plateCoral([6.30,1.52,.62],.48,349,'#9a64d8','#e8e0fa',.32)];
  const plate=new THREE.Mesh(merge(plates),plateMat);plate.castShadow=plate.receiveShadow=true;scene.add(plate);

  // Massive colonies on the rock shoulders: meandering brain skeletons, not painted balls.
  const massive=[];
  for(const [x,z,s,ridges,face,groove] of [
    [-6.20,.55,.78,18,'#4fa24e','#17381f'],[-4.95,2.05,.58,17,'#c8603c','#3d1416'],
    [3.35,1.45,.60,16,'#3d9c92','#0e3236'],[5.90,2.25,.74,19,'#a05aae','#2a1035']])
    massive.push(massiveCoral([x,supportHeight(x,z)+s*.40,z],[s,s*.66,s*.80],x*19,face,groove,{ridges}));
  const brain=new THREE.Mesh(merge(massive),underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.62}),{key:'massive-coral',transmission:.06}));
  brain.castShadow=brain.receiveShadow=true;scene.add(brain);

  // Zoanthid islands grow as connected mats, each patch one colour morph:
  // contrasting mouth, oral disc and tentacle skirt.
  const parts=[],patches=[
    [-6.00,1.85,.92,142,'#ff8f3c','#3fbf52','#14512e'],[-6.86,1.02,.68,86,'#ffe27a','#e8732a','#6b2410'],
    [-3.13,2.03,.82,112,'#ffe680','#2f9fd8','#10315e'],[3.16,.64,.86,122,'#ffb43c','#7fd04a','#1e5c2a'],
    [5.70,1.94,.80,108,'#fff0b0','#d44a74','#4f1636'],[7.00,.72,.76,94,'#ffdf70','#25ac9c','#0a3a3c'],
    [-5.45,-.26,.56,64,'#ffe27a','#e8732a','#6b2410'],[4.74,-.81,.72,84,'#ff8f3c','#3fbf52','#14512e'],
    [-.38,-1.16,.64,74,'#ffb43c','#7fd04a','#1e5c2a'],[1.32,-1.30,.46,44,'#fff0b0','#d44a74','#4f1636'],
  ];
  for(const [cx,cz,size,count,mouth,disc,skirt] of patches){
    for(let j=0;j<count;j++){
      const a=j*2.399963,r=size*Math.sqrt((j+.5)/count),x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r*.66,y=supportHeight(x,z)-.02;
      if(Math.abs(supportHeight(x+.06,z)-supportHeight(x-.06,z))>.18||Math.abs(supportHeight(x,z+.06)-supportHeight(x,z-.06))>.18)continue;
      parts.push(polyp([x,y,z],.092+rng()*.036,.092+rng()*.046,j*7+cx*13,mouth,disc,skirt));
    }
  }
  const polyps=new THREE.Mesh(merge(parts),underwater(new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,flatShading:true,roughness:.58}),{key:'zoanthid-gardens',transmission:.09}));polyps.receiveShadow=true;scene.add(polyps);

  // Everything that bends: two gorgonian fans standing in the water column and
  // the hammer colony on the right shoulder. One material, one draw call.
  const tissue=[
    flexible(seaFan([6.85,3.30,-.62],3.05,54,'#b8452f','#efa07e',{yaw:-.26}),3.30,3.05),
    flexible(seaFan([-7.45,2.96,-2.10],2.35,91,'#8449b8','#d6b6e8',{yaw:.34,order:7,stems:3,thickness:.042}),2.96,2.35),
  ];
  // Short polyps terminating in paired rounded hammer-shaped tips, not the
  // host anemone's long tapered tentacles.
  const base=V(6.03,1.35,.96),stalk=new THREE.Color('#2f8a60'),crown=new THREE.Color('#79c98a'),gold=new THREE.Color('#f5cb50');
  for(let i=0;i<185;i++){
    const a=i*2.39996,r=.84*Math.sqrt((i+.5)/185),root=base.clone().add(V(Math.cos(a)*r*.64,-r*.12,Math.sin(a)*r*.52));
    const len=.35+rng()*.45,lean=V(Math.cos(a)*r*.45,.0,Math.sin(a)*r*.40),pts=[],radii=[];
    for(let j=0;j<=6;j++){const t=j/6;pts.push(root.clone().add(V(lean.x*t*t+.065*Math.sin(t*4+i)*t,len*t,lean.z*t*t)));radii.push(.037*(1-.18*t));}
    const g=tube(pts,radii,5);tint(g,p=>stalk.clone().lerp(crown,clamp((p.y-base.y)/.9,0,1)*.62));tissue.push(flexible(g,base.y,.9));
    for(let k=-1;k<=1;k++){const tip=ellipsoid(pts.at(-1).clone().add(V(k*.040,.02*Math.abs(k),k*.02)).toArray(),[.051,.045,.041],i*3+k,7);
      tint(tip,()=>gold.clone().multiplyScalar(.82+rng()*.16));tissue.push(flexible(tip,base.y,.9));}
  }
  const tissueMat=underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.52}),{key:'reef-tissue',transmission:.12,vertex:responseGLSL,
    normal:`objectNormal.y-=.52*uv.x*dot(reefResponse(position,reefTime,.85),objectNormal.xz);`,
    begin:`transformed.xz+=reefResponse(position,reefTime,.85)*uv.x*uv.x*.30;`});
  const fleshy=new THREE.Mesh(merge(tissue),tissueMat);fleshy.receiveShadow=true;scene.add(fleshy);

  // Low leathery mushroom polyps carpet the flatter rock shoulders.
  const mushrooms=[],morphs=[['#b0342c','#e8703c'],['#2f5fb8','#49a8d8'],['#3f8f47','#9cc84a'],['#7f3f96','#c06ab8']];
  for(let i=0;i<30;i++){
    const side=i<18?-1:1,a=i*2.4,r=Math.sqrt((i%18)/18)*.76,x=(side<0?-3.05:5.05)+Math.cos(a)*r,z=(side<0?1.60:1.80)+Math.sin(a)*r*.52;
    const s=.15+rng()*.19,y=supportHeight(x,z)+.03,[face,ray]=morphs[i%morphs.length],c=new THREE.Color(face),stripe=new THREE.Color(ray);
    const g=ellipsoid([x,y,z],[s,.075,s*.89],i*12,18);
    // Radial ridges run from the mouth outwards; the mouth stays dark and the
    // turned-down margin falls away into shadow, so the disc is not one flat button.
    tint(g,p=>{const d=Math.hypot(p.x-x,p.z-z)/s;
      return c.clone().lerp(stripe,.18+.26*Math.sin(Math.atan2(p.z-z,p.x-x)*13)*Math.min(1,d*1.6)).multiplyScalar(.46+.42*Math.min(1,d*2.4)-.30*Math.max(0,d-.78));});
    mushrooms.push(g);
  }
  const mush=new THREE.Mesh(merge(mushrooms),underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.80}),{key:'mushrooms',transmission:.07}));mush.receiveShadow=true;scene.add(mush);
}

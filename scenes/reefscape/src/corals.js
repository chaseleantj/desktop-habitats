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
  const branchMat=underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.72,bumpMap:coralMap,bumpScale:.048}),{key:'branching-coral',transmission:.20});
  // Acropora, needle-fine Seriatopora and stubby Montipora digitata. Live coral
  // tissue is mostly tan and brown — zooxanthellae, not pigment — so the colonies
  // read khaki and olive with pale growing tips, and only two carry a fluorescent
  // morph: the orange digitata on the left and the green one on the right.
  const NEEDLE={thickness:.033,forks:3,roots:6,order:3,rise:.80,corallite:.08,blunt:0},FINGER={thickness:.070,forks:2,roots:16,order:1,rise:1.0,taper:.78,blunt:1,spread:.46};
  const branches=[
    coralBranches([-5.82,3.55,-1.00],2.15,1.05,39,'#bda372','#cfc8da',{roots:15,thickness:.052,reach:.54,spread:.42}),
    coralBranches([-7.10,2.60,-1.05],1.75,1.16,74,'#95975c','#d4d9a4',{roots:12,thickness:.044,reach:.62,spread:.34}),
    coralBranches([-4.35,3.08,-2.15],2.30,.99,122,'#c39a80','#e8d7cb',NEEDLE),
    coralBranches([-2.52,1.06,2.05],.95,.88,318,'#d17d28','#f2b968',{...FINGER,vary:.40}),
    coralBranches([5.45,2.88,-1.52],1.80,1.22,82,'#bda068','#d6c6ae',{roots:15,thickness:.052,reach:.54,spread:.42}),
    coralBranches([7.34,2.52,-1.62],1.30,1.00,417,'#66a86a','#cfd8a6',{roots:12,thickness:.046,reach:.64,spread:.34}),
    coralBranches([3.28,1.14,-1.52],1.60,.86,23,'#bb9c84','#e2d6ca',NEEDLE),
    coralBranches([4.30,.62,1.55],.84,.98,611,'#979c4a','#ccce82',{...FINGER,vary:.40}),
    // The arch lintel carries its own colonies; the cave beneath stays open.
    coralBranches([-.45,3.22,-1.14],.90,.86,707,'#93a264','#c6db92',{...FINGER,vary:.40}),
    coralBranches([1.34,3.54,-1.24],.85,.82,811,'#ab9b9e','#e0d6d2',{thickness:.042,roots:6}),
  ];
  const coral=new THREE.Mesh(merge(branches),branchMat);coral.castShadow=coral.receiveShadow=true;scene.add(coral);

  const plateMat=underwater(new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.86,bumpMap:plateMap,bumpScale:.09}),{key:'plate-coral',transmission:.16});
  // Capricornis grows in overlapping whorls, so the big colonies get a second tier.
  const plates=[
    plateCoral([4.38,2.98,-.30],.60,180,'#78894e','#cbd0a0',.42),plateCoral([4.88,2.62,.10],.46,183,'#72844a','#cbd0a0',.32),
    plateCoral([-6.05,2.22,.30],.58,271,'#a8783f','#dfcda2',.42),plateCoral([-5.62,1.84,.70],.46,274,'#a2743d','#dfcda2',.30),
    plateCoral([3.02,1.38,.58],.50,342,'#5d8086','#bed2d4',.32)];
  const plate=new THREE.Mesh(merge(plates),plateMat);plate.castShadow=plate.receiveShadow=true;scene.add(plate);

  // Massive colonies on the rock shoulders: meandering brain skeletons, not painted
  // balls, and one dominant piece per island rather than a row of them.
  const massive=[];
  for(const [x,z,s,ridges,face,groove] of [
    [-4.95,2.05,.66,26,'#8f7c4a','#2a3018'],[3.35,1.45,.68,24,'#7e6472','#241a2c']])
    massive.push(massiveCoral([x,supportHeight(x,z)+s*.40,z],[s,s*.66,s*.80],x*19,face,groove,{ridges,relief:.17}));
  const brain=new THREE.Mesh(merge(massive),underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.62}),{key:'massive-coral',transmission:.12}));
  brain.castShadow=brain.receiveShadow=true;scene.add(brain);

  // Zoanthid islands grow as connected mats, each patch one colour morph:
  // contrasting mouth, oral disc and tentacle skirt.
  const parts=[],patches=[
    [-6.00,1.85,1.02,168,'#f0993c','#4e8c3a','#1b4524'],[-3.13,2.03,.86,124,'#d8cf9e','#4a7a6c','#152c26'],
    [3.16,.64,.94,142,'#cdae5c','#7f6234','#33250e'],[5.70,1.94,.82,112,'#cf6f38','#717c3a','#272e13'],
    [-5.45,-.26,.58,68,'#cdae5c','#7f6234','#33250e'],[4.74,-.81,.74,88,'#f0993c','#4e8c3a','#1b4524'],
    [-.38,-1.16,.66,78,'#cf6f38','#717c3a','#272e13'],
  ];
  const jitter=(hex,k)=>new THREE.Color(hex).offsetHSL((rng()-.5)*.055,(rng()-.5)*.20,(rng()-.5)*k);
  for(const [cx,cz,size,count,mouth,disc,skirt] of patches){
    for(let j=0;j<count;j++){
      const a=j*2.399963,r=size*Math.sqrt((j+.5)/count),x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r*.66,y=supportHeight(x,z)-.055;
      if(Math.abs(supportHeight(x+.06,z)-supportHeight(x-.06,z))>.18||Math.abs(supportHeight(x,z+.06)-supportHeight(x,z-.06))>.18)continue;
      // A mat thins out towards its margin along a ragged line, so the colony has no
      // disc-shaped footprint; and no two polyps share a colour or an angle.
      if(rng()<clamp((r/size-.58+.22*Math.sin(a*5.3+cx))/.46,0,1))continue;
      const tilt=[(rng()-.5)*.62,(rng()-.5)*.62];
      parts.push(polyp([x,y,z],.092+rng()*.036,.092+rng()*.046,j*7+cx*13,jitter(mouth,.10),jitter(disc,.14),jitter(skirt,.10),tilt));
    }
  }
  const polyps=new THREE.Mesh(merge(parts),underwater(new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,flatShading:true,roughness:.76}),{key:'zoanthid-gardens',transmission:.20}));polyps.receiveShadow=true;scene.add(polyps);

  // Everything that bends: two gorgonian fans standing in the water column and
  // the hammer colony on the right shoulder. One material, one draw call.
  const tissue=[
    flexible(seaFan([6.85,3.30,-.62],3.05,54,'#a86a54','#e0bda6',{yaw:-.26,order:8,thickness:.094}),3.30,3.05),
    flexible(seaFan([-7.45,2.96,-2.10],2.35,91,'#7d6497','#c8b9d4',{yaw:.34,order:7,stems:3,thickness:.042}),2.96,2.35),
  ];
  // Short polyps terminating in paired rounded hammer-shaped tips, not the
  // host anemone's long tapered tentacles.
  const base=V(6.03,1.35,.96),stalk=new THREE.Color('#3a7a5a'),crown=new THREE.Color('#79b389'),gold=new THREE.Color('#d9bd63');
  for(let i=0;i<185;i++){
    const a=i*2.39996,r=.84*Math.sqrt((i+.5)/185),root=base.clone().add(V(Math.cos(a)*r*.64,-r*.12,Math.sin(a)*r*.52));
    const len=.35+rng()*.45,lean=V(Math.cos(a)*r*.45,.0,Math.sin(a)*r*.40),pts=[],radii=[];
    for(let j=0;j<=6;j++){const t=j/6;pts.push(root.clone().add(V(lean.x*t*t+.065*Math.sin(t*4+i)*t,len*t,lean.z*t*t)));radii.push(.037*(1-.18*t));}
    const g=tube(pts,radii,5);tint(g,p=>stalk.clone().lerp(crown,clamp((p.y-base.y)/.9,0,1)*.62));tissue.push(flexible(g,base.y,.9));
    // Euphyllia ancora ends in a flattened anchor bar across the polyp, not a bead:
    // two wide, shallow lobes set either side of the axis.
    for(const k of [-1,1]){const tip=ellipsoid(pts.at(-1).clone().add(V(k*.046,.012,k*.024)).toArray(),[.074,.034,.044],i*3+k,7);
      tint(tip,()=>gold.clone().multiplyScalar(.82+rng()*.16));tissue.push(flexible(tip,base.y,.9));}
  }
  const tissueMat=underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.52}),{key:'reef-tissue',transmission:.12,vertex:responseGLSL,
    normal:`objectNormal.y-=.52*uv.x*dot(reefResponse(position,reefTime,.85),objectNormal.xz);`,
    begin:`transformed.xz+=reefResponse(position,reefTime,.85)*uv.x*uv.x*.30;`});
  const fleshy=new THREE.Mesh(merge(tissue),tissueMat);fleshy.receiveShadow=true;scene.add(fleshy);

  // Low leathery mushroom polyps carpet the flatter rock shoulders.
  const mushrooms=[],morphs=[['#8a4034','#bc7550'],['#4a6070','#7d94a0'],['#4c6a3c','#8a9a55'],['#6a4a6e','#96809c']];
  for(let i=0;i<24;i++){
    const side=i<14?-1:1,a=i*2.4,r=Math.sqrt((i%14)/14)*.76,x=(side<0?-3.05:5.05)+Math.cos(a)*r,z=(side<0?1.60:1.80)+Math.sin(a)*r*.52;
    // The support field is sampled at 5 cm, so a disc laid on a steep face hangs in the
    // water; a mushroom only settles where the rock is near flat anyway.
    if(Math.abs(supportHeight(x+.08,z)-supportHeight(x-.08,z))>.22||Math.abs(supportHeight(x,z+.08)-supportHeight(x,z-.08))>.22)continue;
    const s=.16+rng()*.21,y=supportHeight(x,z)-.045,[face,ray]=morphs[i%morphs.length],c=new THREE.Color(face),stripe=new THREE.Color(ray);
    const g=ellipsoid([x,y,z],[s,.125,s*.89],i*12,18);
    // Radial ridges run from the mouth outwards; the mouth stays dark and the
    // turned-down margin falls away into shadow, so the disc is not one flat button.
    tint(g,p=>{const d=Math.hypot(p.x-x,p.z-z)/s;
      return c.clone().lerp(stripe,.18+.26*Math.sin(Math.atan2(p.z-z,p.x-x)*13)*Math.min(1,d*1.6)).multiplyScalar(.46+.42*Math.min(1,d*2.4)-.30*Math.max(0,d-.78));});
    mushrooms.push(g);
  }
  const mush=new THREE.Mesh(merge(mushrooms),underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.80}),{key:'mushrooms',transmission:.18}));mush.receiveShadow=true;scene.add(mush);
}

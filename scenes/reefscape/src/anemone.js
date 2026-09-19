import * as THREE from 'three';
import { underwater,responseGLSL } from './water.js';
import { randomGenerator,smoothstep,clamp,lerp,noise } from './math.js';
import { merge } from './geometry.js';
import { ANEMONES } from './layout.js';
import { supportHeight } from './terrain.js';

// One anemone is a column standing on the rock with a crown of tentacles on the oral disc
// at its top; every proportion below is a share of the animal's scale S, so the clownfish
// host and a small colony elsewhere are the same animal at different sizes. The shape is
// Remora's duskrose anemone taken into three dimensions: a rounded foot, a waist and a
// flare to the rim; tentacles rooted on a golden-angle spiral over the disc, each a
// tapering finger with a rounded, faintly swollen tip, leaving the disc a little off the
// axis and arcing further outward along its length, so the inner rings stand and the
// outer ring hangs over the rim. The crown's reach is roughly REACH·S, and a placement
// in layout.js states that reach, so the scale follows from it.
const REACH=.90,COLUMN_HEIGHT=.66,RIM=.36,ROOT_RADIUS=.24;
// Column silhouette as [share of height, radius/S]: the pedal disc gripping the rock, a
// waist, and the flare to the rim; cosine-blended so the rim rounds off and the waist is a
// smooth throat rather than a kink. Below the rock the foot spreads on, hidden, so no
// edge of it can float over a hollow.
const COLUMN=[[0,.37],[.10,.31],[.5,.28],[1,RIM]];
function columnRadius(u){
  if(u<0)return COLUMN[0][1]*(1-u*.8);
  for(let i=1;i<COLUMN.length;i++){const [u0,r0]=COLUMN[i-1],[u1,r1]=COLUMN[i];if(u<=u1)return lerp(r0,r1,.5-.5*Math.cos(Math.PI*(u-u0)/(u1-u0)));}
  return RIM;
}
// The disc is a shallow dome over the tentacle field; v runs from the rim (0) to the
// centre (1). The mouth is an elliptical slit with raised lips, so e is the distance from
// the centre stretched along the slit's axis.
const discLift=v=>.045*smoothstep(0,.45,v);
const mouthLift=e=>.030*Math.exp(-(((e-.20)/.08)**2))-.045*(1-smoothstep(0,.11,e));
const GOLDEN=Math.PI*(3-Math.sqrt(5)),E=Math.E,hash=seed=>{const v=Math.sin(seed*E)*Math.cos(seed*Math.PI)*1e4;return v-Math.floor(v);};
// Verrucae: the adhesive warts a column carries, a staggered lattice crowding toward the
// rim with a share of its sites left bare, read as a pale mottle and a slight relief.
const VERRUCAE={rows:12,cols:20,skip:.22,jitter:.9,topBias:.55,size:.020};
function verruca(a,u,seed){
  const {rows,cols,skip,jitter,topBias,size}=VERRUCAE,rf=Math.pow(clamp(u,0,1),1/topBias)*rows;let best=0;
  for(let dr=-1;dr<=1;dr++){const row=Math.floor(rf)+dr;if(row<0||row>=rows)continue;
    const cf=a/(2*Math.PI)*cols-(row%2)/2;
    for(let dc=-1;dc<=1;dc++){const col=((Math.floor(cf)+dc)%cols+cols)%cols,site=row*cols+col+seed;
      if(hash(site*E+401)<skip)continue;
      const cy=Math.pow((row+.5+(hash(site*Math.PI+411)-.5)*jitter)/rows,topBias),cx=(col+.5+(row%2)/2+(hash(site*E+421)-.5)*jitter)/cols*2*Math.PI;
      const wart=size*(.45+.9*hash(site*E+441))*(.5+.5*cy),da=Math.atan2(Math.sin(a-cx),Math.cos(a-cx))*columnRadius(clamp(u,0,1)),dy=(u-cy)*COLUMN_HEIGHT;
      best=Math.max(best,Math.exp(-(da*da+dy*dy)/(wart*wart)*1.6)*(.55+.45*hash(site*Math.PI+431)));}}
  return best;
}
const FOOT=new THREE.Color('#7a2c24'),SHAFT=new THREE.Color('#c04a2c'),LIP=new THREE.Color('#d0663a'),WART=new THREE.Color('#e0a08c'),DISC=new THREE.Color('#a8564c'),LIPS=new THREE.Color('#c07868'),MOUTH=new THREE.Color('#3a1018');
// Each placement becomes one column-and-disc surface of revolution about its own axis,
// standing on the rock; the disc's dome carries the tentacle roots.
function specimen(spec,index){
  const S=spec.radius/REACH,H=COLUMN_HEIGHT*S,up=new THREE.Vector3(0,1,0),axis=new THREE.Vector3();
  // The axis leans a little with the rock it stands on and by whatever the placement asks
  // for; the disc's position is authored, the column drops from it to wherever the rock is.
  const step=.25,lean=spec.lean||[0,0],slopeX=(supportHeight(spec.x+step,spec.z)-supportHeight(spec.x-step,spec.z))/(2*step),slopeZ=(supportHeight(spec.x,spec.z+step)-supportHeight(spec.x,spec.z-step))/(2*step);
  axis.set(-slopeX*.35+lean[0],1,-slopeZ*.35+lean[1]).normalize();
  const frame=new THREE.Quaternion().setFromUnitVectors(up,axis),disc=new THREE.Vector3(spec.x,spec.y,spec.z);
  const foot=disc.clone().addScaledVector(axis,-H),sunk=Math.max(.12*S,foot.y-supportHeight(foot.x,foot.z)+.04);
  return {S,H,frame,foot,sunk,seed:index*977,count:tentacleCount(spec)};
}
function bodyGeometry(sp){
  const {S,H,frame,foot,sunk,seed}=sp,rings=56,segments=72,pos=[],col=[],idx=[],point=new THREE.Vector3(),color=new THREE.Color(),FOLD=.68;
  for(let j=0;j<=rings;j++){const t=j/rings;
    for(let i=0;i<=segments;i++){const a=i/segments*Math.PI*2;
      let r,y,shade=1;
      if(t<FOLD){
        // Column: u runs from below the rock (hidden, so the foot never floats) to the rim.
        const u=lerp(-sunk/H,1,t/FOLD),wart=verruca(a,u,seed),edge=1+.012*noise(Math.cos(a)*3+seed,u*4,Math.sin(a)*3);
        // Longitudinal striation: the mesenterial insertions show through the body wall as
        // shallow grooves that fade below the rim.
        const groove=Math.pow(.5+.5*Math.cos(a*14+seed),1.5)*(1-smoothstep(.70,.92,u)),base=columnRadius(u);
        r=S*base*edge*(1-.012*groove)*(1+.8*VERRUCAE.size*wart/base);y=H*u;
        color.copy(FOOT).lerp(SHAFT,smoothstep(.05,.55,u)).lerp(LIP,smoothstep(.55,1,u)).lerp(WART,Math.min(1,wart*.55));
        // The crown shades the top of the column and the grooves lie in their own shadow.
        shade=(1-.42*smoothstep(.72,1,u))*(1-.30*groove);
      }else{
        const v=(t-FOLD)/(1-FOLD),e=(1-v)*(1+.30*Math.cos(2*a+seed));r=S*RIM*(1-v);y=H+S*(discLift(v)+mouthLift(e));
        // Mesenterial lines radiate from the mouth across the disc, which sits in the crown's shade.
        color.copy(DISC).lerp(LIPS,Math.exp(-(((e-.20)/.10)**2))).lerp(MOUTH,1-smoothstep(.04,.13,e));
        shade=.45*(1-.14*smoothstep(.55,1,Math.cos(a*24))*smoothstep(.15,.4,v)*(1-smoothstep(.7,.9,v)));
      }
      point.set(Math.cos(a)*r,y,Math.sin(a)*r).applyQuaternion(frame).add(foot);
      pos.push(point.x,point.y,point.z);col.push(color.r*shade,color.g*shade,color.b*shade);
      if(j<rings&&i<segments){const k=j*(segments+1)+i;idx.push(k,k+segments+1,k+1,k+1,k+segments+1,k+segments+2);}}}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));geo.setIndex(idx);geo.computeVertexNormals();
  return geo;
}
// A tentacle's mesh is a straight tube whose position.y is the axial parameter and whose
// cross-section is the profile in shares of the base radius; the vertex shader bends it.
function tentacleGeometry(){
  const levels=[0,.10,.20,.30,.40,.50,.59,.67,.74,.80,.85,.89,.92,.945,.96,.972,.983,.992,.998,1],sides=12,CAP=.945,pos=[],idx=[];
  // Tapers to half its base by the neck, swells into a small knob, then closes as a
  // rounded tip a little longer than it is wide.
  const neck=s=>(1-.50*Math.pow(s,2.0))*(1+.24*Math.exp(-(((s-.91)/.065)**2)));
  const radius=s=>s<=CAP?neck(s):neck(CAP)*Math.sqrt(Math.max(0,1-((s-CAP)/(1-CAP))**2));
  for(let j=0;j<levels.length;j++){const s=levels[j],r=radius(s);
    for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2;pos.push(Math.cos(a)*r,s,Math.sin(a)*r);if(j<levels.length-1&&i<sides){const k=j*(sides+1)+i;idx.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);}}}
  // Closed base: a root standing a little proud of the disc would otherwise show as a black slot.
  const hub=pos.length/3;pos.push(0,0,0);for(let i=0;i<sides;i++)idx.push(hub,i,i+1);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
// A small anemone has fewer tentacles than a large one, but not in proportion to its
// disc's area (about 170 on the host, 30 on the smallest clone), and for its size they are
// shorter and stouter: a clone is a stubby-fingered version of the host, not a miniature.
const tentacleCount=spec=>Math.round(110*Math.pow(spec.radius/REACH,1.3));
const girthOf=S=>.036*Math.pow(S,.70),lengthOf=S=>.48*Math.pow(S,1.15);
export const TENTACLE_COUNT=ANEMONES.reduce((n,spec)=>n+tentacleCount(spec),0);
export function createAnemone(scene){
  // Built after the terrain, so the columns stand on the baked rock rather than its analytic stand-in.
  const specimens=ANEMONES.map(specimen),rng=randomGenerator(8945);
  const vertex=`attribute vec4 aShape;attribute vec4 aCurve;varying float vAxis;varying float vAround;varying float vTone;varying float vRing;varying float vSeed;${responseGLSL}
    // The resting strand is a circular arc in the local x-y plane (x outward from the disc,
    // y the anemone's axis): it leaves the disc aCurve.x from the axis and turns a further
    // aCurve.y by the tip, so a small curl is a straight finger and a large one hooks over
    // the rim. A slight wander out of that plane, phased per tentacle, keeps a crown seen
    // face-on from reading as spines on a ball. The flow adds a cantilever bend on top,
    // solved once in the normal hook, which three runs before begin_vertex.
    vec2 tSway;vec2 tTip;
    void tentacleSolve(){vec3 root=instanceMatrix[3].xyz;mat3 toLocal=transpose(mat3(instanceMatrix));
      vec2 f=reefResponse(root,reefTime,.45+aShape.x*.60+aCurve.z*.50),g=reefResponse(root,reefTime,1.3+aShape.x*.80);
      float gain=.90*aShape.x;
      tSway=(toLocal*vec3(f.x,0.,f.y)).xz*gain;tTip=(toLocal*vec3(g.x,0.,g.y)).xz*gain*.5;}
    vec3 arcPoint(float s){float c=max(aCurve.y,.02),t=aCurve.x+c*s;return vec3(cos(aCurve.x)-cos(t),sin(t)-sin(aCurve.x),.05*s*sin(s*5.5+aCurve.w*25.)*c)*aShape.x/c;}
    vec3 arcTangent(float s){float t=aCurve.x+aCurve.y*s;return normalize(vec3(sin(t),cos(t),.05*(sin(s*5.5+aCurve.w*25.)+5.5*s*cos(s*5.5+aCurve.w*25.))));}
    vec3 tentacleCenter(float s){vec2 h=tSway*s*s+tTip*s*s*s*s;return arcPoint(s)+vec3(h.x,0.,h.y)-arcTangent(s)*(.5*dot(h,h)/aShape.x);}
    vec3 tentacleSlope(float s){vec2 dh=tSway*2.*s+tTip*4.*s*s*s;return arcTangent(s)*aShape.x+vec3(dh.x,0.,dh.y);}`;
  const mat=underwater(new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.52,metalness:0}),{
    key:'tank-anemone',vertex,
    // Tissue a few cells thick: the base passes a little light, the tip most of it.
    transmission:'(.20+.40*smoothstep(.20,1.,vAxis))',
    normal:`tentacleSolve();vec3 slope=normalize(tentacleSlope(position.y));vec3 tx=normalize(vec3(slope.y,-slope.x,0.));vec3 tz=normalize(cross(tx,slope));objectNormal=normalize(tx*normal.x+slope*normal.y+tz*normal.z);`,
    begin:`float s=position.y;vec3 dir=normalize(tentacleSlope(s));vec3 ax=normalize(vec3(dir.y,-dir.x,0.));vec3 az=normalize(cross(ax,dir));
      transformed=tentacleCenter(s)+(ax*position.x+az*position.z)*aShape.y;
      vAxis=s;vAround=atan(position.z,position.x);vTone=aShape.z;vRing=aShape.w;vSeed=aCurve.w;`,
    fragment:`varying float vAxis;varying float vAround;varying float vTone;varying float vRing;varying float vSeed;`,
    // Light through the thin edge of a tentacle: where the surface turns away from the
    // eye the tissue goes pale and warm instead of dark, and the wet tip carries the highlight.
    surfaceNormal:`float thin=smoothstep(.30,.95,vAxis),rim=pow(1.-abs(dot(normal,normalize(vViewPosition))),2.5);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.74,.52,.44),rim*thin*.32);roughnessFactor*=1.-.10*thin;`,
    // Kept below the tone mapper's shoulder: brighter tissue turns chalk, not rose.
    // Orange-red pigment lies in irregular blotches along the shaft, not rings: two waves
    // along the axis beat against one round the tube, phased per tentacle.
    color:`float mottle=smoothstep(.30,.80,.5+.5*sin(vAxis*17.+vSeed*40.)*sin(vAround*2.+vAxis*6.+vSeed*23.)*(.7+.3*sin(vAxis*7.3-vSeed*13.)));
      vec3 root=vec3(.16,.035,.05),shaft=mix(vec3(.52,.28,.17),vec3(.64,.38,.26),vTone),bands=vec3(.50,.12,.04),tip=vec3(.60,.36,.25);
      vec3 tissue=mix(root,shaft,smoothstep(0.,.22,vAxis));
      tissue=mix(tissue,bands,mottle*.70*smoothstep(.08,.30,vAxis)*(1.-smoothstep(.78,.98,vAxis)));
      tissue=mix(tissue,tip,smoothstep(.55,1.,vAxis));
      // Inside the crown the roots and the inner rings' shafts are buried among their
      // neighbours and only the tips and the outer envelope stand in the light; what
      // reaches the depths has come through tissue, so they go deep orange rather than
      // grey. Cheaper and steadier than shadowing a few hundred swaying instances.
      float buried=(1.-smoothstep(.22,.82,vAxis))*(1.-.60*vRing*vRing);
      diffuseColor.rgb=mix(tissue,vec3(.14,.035,.01),buried*.78);`
  });
  const tentacles=new THREE.InstancedMesh(tentacleGeometry(),mat,TENTACLE_COUNT),shapes=new Float32Array(TENTACLE_COUNT*4),curves=new Float32Array(TENTACLE_COUNT*4);
  const matrix=new THREE.Matrix4(),rotation=new THREE.Matrix4(),X=new THREE.Vector3(),Y=new THREE.Vector3(),Z=new THREE.Vector3(),root=new THREE.Vector3();
  const all=[];
  for(const sp of specimens){const {S,H,frame,foot,count}=sp;
    for(let i=0;i<count;i++){
      // Stratified radius and the golden angle: even coverage of the annulus round the
      // bare mouth with no clumps and no gaps, from the index alone.
      const rr=Math.sqrt(ROOT_RADIUS*ROOT_RADIUS+(1-ROOT_RADIUS*ROOT_RADIUS)*(i+.5)/count),ring=(rr-ROOT_RADIUS)/(1-ROOT_RADIUS);
      const a=i*GOLDEN+(rng()-.5)*.44,rootRadius=clamp(rr+(rng()-.5)*.10,ROOT_RADIUS*.9,1);
      X.set(Math.cos(a),0,Math.sin(a));Y.set(0,1,0);Z.crossVectors(X,Y);
      root.set(X.x*rootRadius*RIM*S,H+S*discLift(1-rootRadius)-.006*S,X.z*rootRadius*RIM*S).applyQuaternion(frame).add(foot);
      rotation.makeBasis(X,Y,Z);matrix.makeRotationFromQuaternion(frame).multiply(rotation).setPosition(root);
      // Rim tentacles are longer and leave the disc at a greater lean; every strand turns
      // further outward along its length by its own amount, unevenly across the crown.
      const len=lengthOf(S)*(.88+.50*ring)*(.86+.28*rng()),girth=girthOf(S)*(.85+.30*rng()),tilt=.25+.75*Math.pow(ring,1.2),curl=(.20+.80*rng())*(.60+.75*ring);
      all.push({matrix:matrix.clone(),shape:[len,girth,rng(),ring],curve:[tilt,curl,rng(),rng()]});
    }
  }
  // 317 is coprime with the count, so a lowered instance count still draws a spread of
  // rings and of anemones instead of one crown's inner tentacles.
  const stride=[317,313,311,307].find(p=>TENTACLE_COUNT%p)||1;
  for(let i=0;i<TENTACLE_COUNT;i++){const t=all[(i*stride)%TENTACLE_COUNT];tentacles.setMatrixAt(i,t.matrix);shapes.set(t.shape,i*4);curves.set(t.curve,i*4);}
  tentacles.geometry.setAttribute('aShape',new THREE.InstancedBufferAttribute(shapes,4));tentacles.geometry.setAttribute('aCurve',new THREE.InstancedBufferAttribute(curves,4));
  tentacles.frustumCulled=false;tentacles.receiveShadow=true;scene.add(tentacles);
  const body=new THREE.Mesh(merge(specimens.map(bodyGeometry)),underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.44}),{key:'anemone-body',transmission:.10}));
  body.castShadow=body.receiveShadow=true;scene.add(body);
  return {tentacles,count:TENTACLE_COUNT};
}

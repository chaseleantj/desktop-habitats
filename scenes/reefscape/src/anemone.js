import * as THREE from 'three';
import { underwater,responseGLSL } from './water.js';
import { randomGenerator,smoothstep } from './math.js';
import { tint } from './geometry.js';
import { HOST } from './layout.js';

export const TENTACLE_COUNT=440;
// Oral disc, rolled margin and column are one surface of revolution: t=1 is the
// tentacle-bearing margin, past it the body rolls under and tucks into the rock.
const MARGIN=1.50,DISC_Z=.78,DOME=.44,TUCK=1.45,BODY_T=Math.PI/MARGIN;
function bodyPoint(a,t,out){
  const phi=t*MARGIN,fold=1+.075*Math.sin(a*3+.5)+.032*Math.sin(a*7+2.1);
  const r=HOST.radius*fold*Math.sin(phi)/Math.sin(MARGIN),x=Math.cos(a)*r,z=Math.sin(a)*r*DISC_Z,drop=Math.cos(phi)-Math.cos(MARGIN);
  // A low oral cone with the mouth sunk into it, plus shallow radial folds.
  const mouth=.160*Math.exp(-((t/.285)**2))-.165*Math.exp(-((t/.10)**2));
  return out.set(HOST.x+x,HOST.y+drop*(DOME+TUCK*smoothstep(0,.40,-drop))+mouth+.042*Math.sin(a*5+1.2)*t*t-.13*z,HOST.z+z);
}
export function createAnemone(scene){
  const rng=randomGenerator(8945),pos=[],idx=[];
  // Entacmaea quadricolor: a near-cylindrical shaft that clubs into a bulb at .875,
  // wider than it is long, pinched by a short neck. Past CAP the tentacle closes as
  // a hemisphere of the neck radius — a blunt nipple, never a taper run out to a spike.
  const levels=[0,.12,.24,.36,.47,.57,.655,.725,.78,.822,.855,.885,.908,.932,.952,.968,.981,.992,1],sides=12,CAP=.932;
  const club=s=>(.036*(1-.16*s)+.046*Math.exp(-(((s-.875)/.125)**2)))*(1-.55*smoothstep(.885,CAP,s));
  for(let j=0;j<levels.length;j++){
    const s=levels[j],radius=s<=CAP?club(s):club(CAP)*Math.sqrt(Math.max(0,1-((s-CAP)/(1-CAP))**2));
    for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2;pos.push(Math.cos(a)*radius,s,Math.sin(a)*radius);if(j<levels.length-1&&i<sides){const k=j*(sides+1)+i;idx.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);}}
  }
  // Closed base: a root that is not quite buried would otherwise show as a black
  // slot, the open tube read through its own back faces.
  const hub=pos.length/3;pos.push(0,0,0);
  for(let i=0;i<sides;i++)idx.push(hub,i,i+1);
  // position.y doubles as the axial parameter; the shader places and shades from it.
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();
  const shapes=new Float32Array(TENTACLE_COUNT*4),curves=new Float32Array(TENTACLE_COUNT*4);
  const vertex=`attribute vec4 aShape;attribute vec4 aCurve;varying float vAxis;varying float vTone;varying float vPale;${responseGLSL}
    // tBend.xy is the shaft lean, .zw the tip curl: the heavier bulb lags the
    // shaft. Solved once in the normal hook, which three runs before begin_vertex.
    vec4 tBend;
    void tentacleSolve(){vec3 root=instanceMatrix[3].xyz;mat3 toLocal=transpose(mat3(instanceMatrix));
      vec2 shaft=reefResponse(root,reefTime,.50+aShape.x*.55+aShape.y*.70),tip=reefResponse(root,reefTime,1.35+aShape.x*.90);
      float gain=.85*aShape.x/(.55+aShape.y*.90);
      tBend=vec4(aCurve.xy+(toLocal*vec3(shaft.x,0.,shaft.y)).xz*gain,aCurve.zw+(toLocal*vec3(tip.x,0.,tip.y)).xz*gain*.55);}
    float tentacleShorten(){return (.30*dot(tBend.xy,tBend.xy)+.55*dot(tBend.zw,tBend.zw))/aShape.x;}
    vec3 tentacleCenter(float s){vec2 h=tBend.xy*(s*s*(1.5-.5*s))+tBend.zw*(s*s*s*s);
      return vec3(h.x,aShape.x*s-tentacleShorten()*s*s*s,h.y);}
    vec3 tentacleSlope(float s){vec2 h=tBend.xy*(3.*s-1.5*s*s)+tBend.zw*(4.*s*s*s);
      return vec3(h.x,aShape.x-3.*tentacleShorten()*s*s,h.y);}`;
  const mat=underwater(new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.44,metalness:0}),{
    key:'tank-anemone',transmission:.24,vertex,
    normal:`tentacleSolve();vec3 slope=normalize(tentacleSlope(position.y));vec3 tx=normalize(vec3(slope.y,-slope.x,0.));vec3 tz=normalize(cross(tx,slope));objectNormal=normalize(tx*normal.x+slope*normal.y+tz*normal.z);`,
    begin:`float s=position.y;vec3 dir=normalize(tentacleSlope(s));vec3 ax=normalize(vec3(dir.y,-dir.x,0.));vec3 az=normalize(cross(ax,dir));
      transformed=tentacleCenter(s)+(ax*position.x+az*position.z)*aShape.y*(1.+.40*(aShape.w-.5)*smoothstep(.50,.84,s));
      vAxis=s;vTone=aShape.z;vPale=smoothstep(.83+.06*aShape.w,.95,s);`,
    fragment:`varying float vAxis;varying float vTone;varying float vPale;`,
    // Wet tissue: the pale bulbs carry the highlight, the shaft stays soft.
    surfaceNormal:`roughnessFactor*=1.-.28*vPale;`,
    // Kept below the tone mapper's shoulder: brighter tissue turns chalk, not rose.
    color:`float olive=smoothstep(.17,.03,vTone);
      vec3 shaft=mix(vec3(.055,.030,.018),vec3(.115,.050,.026),vTone);
      vec3 flesh=mix(mix(vec3(.560,.170,.055),vec3(.760,.310,.170),vTone),vec3(.400,.290,.095),olive);
      vec3 bulb=mix(mix(vec3(.700,.420,.310),vec3(.900,.650,.490),vTone),vec3(.640,.580,.360),olive);
      // Occlusion inside the crown: low and near the axis is buried, the drooping
      // outer tentacles stay lit. Cheaper and steadier than shadowing 440 instances.
      float buried=(1.-smoothstep(.95,1.85,length((vReefWorld.xz-vec2(${HOST.x.toFixed(3)},${HOST.z.toFixed(3)}))/vec2(1.,${DISC_Z}))))*(1.-smoothstep(${(HOST.y+.15).toFixed(3)},${(HOST.y+1.15).toFixed(3)},vReefWorld.y));
      diffuseColor.rgb=mix(mix(shaft,flesh,smoothstep(.03,.30,vAxis)),bulb,vPale)*(.40+.60*smoothstep(0.,.55,vAxis))*(1.-.60*buried);`
  });
  const tentacles=new THREE.InstancedMesh(geo,mat,TENTACLE_COUNT),dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0);
  const root=new THREE.Vector3(),normal=new THREE.Vector3(),bend=new THREE.Vector3(),curl=new THREE.Vector3(),inverse=new THREE.Quaternion();
  for(let i=0;i<TENTACLE_COUNT;i++){
    // 317 is coprime with the count, so a lowered instance count still draws a
    // radius- and angle-spread subset instead of only the inner tentacles.
    const sample=(i*317)%TENTACLE_COUNT,rim=Math.sqrt((sample+.5)/TENTACLE_COUNT),a=sample*2.39996322973+(rng()-.5)*.20;
    // Crown lobes: a living anemone is never a circle of equal-length tentacles.
    const len=(.47+rng()*.58+(1-rim)*.56)*(1+.17*Math.sin(a*3+1.1)+.09*Math.sin(a*7-.4));
    // Roots sit on the disc but lean on their own arc: the body's margin is far
    // steeper than a living disc, which would splay the outer rows flat.
    const tilt=Math.pow(rim,1.5)*.92+(rng()-.5)*.30;
    normal.set(Math.cos(a)*Math.sin(tilt)+(rng()-.5)*.11,Math.cos(tilt),Math.sin(a)*Math.sin(tilt)+(rng()-.5)*.11).normalize();
    // The oral cone is left bare, as on a living disc, so the mouth stays visible.
    dummy.position.copy(bodyPoint(a,.20+rim*.78,root)).addScaledVector(normal,-.035);
    dummy.quaternion.setFromUnitVectors(up,normal);dummy.updateMatrix();tentacles.setMatrixAt(i,dummy.matrix);
    inverse.copy(dummy.quaternion).invert();
    // Lean and curl are world vectors; only their transverse part bends a
    // tentacle, so upright ones stand while margin ones hang over the rock.
    const lean=a+(rng()-.5)*1.3,flare=(.10+.30*rim*rim)*len*(.4+1.1*rng()),swing=lean+(rng()-.5)*3.,tip=(.14+.40*rng())*len;
    bend.set(Math.cos(lean)*flare,-(.16+.45*rim)*len,Math.sin(lean)*flare*.92).applyQuaternion(inverse);
    curl.set(Math.cos(swing)*tip,-(.20+.45*rng())*len,Math.sin(swing)*tip*.9).applyQuaternion(inverse);
    // aShape: length, girth, tone, plump (bulb width and how far down the pale runs).
    shapes.set([len,.85+rng()*.75,rng(),rng()],i*4);
    curves.set([bend.x,bend.z,curl.x,curl.z],i*4);
  }
  geo.setAttribute('aShape',new THREE.InstancedBufferAttribute(shapes,4));geo.setAttribute('aCurve',new THREE.InstancedBufferAttribute(curves,4));
  tentacles.frustumCulled=false;tentacles.receiveShadow=true;scene.add(tentacles);
  const rings=30,segments=80,bp=[],bidx=[],point=new THREE.Vector3();
  for(let j=0;j<=rings;j++){const t=BODY_T*Math.pow(j/rings,1.35);
    for(let i=0;i<=segments;i++){bodyPoint(i/segments*Math.PI*2,t,point);bp.push(point.x,point.y,point.z);
      if(j<rings&&i<segments){const k=j*(segments+1)+i;bidx.push(k,k+segments+1,k+1,k+1,k+segments+1,k+segments+2);}}}
  const bodyGeo=new THREE.BufferGeometry();bodyGeo.setAttribute('position',new THREE.Float32BufferAttribute(bp,3));bodyGeo.setIndex(bidx);bodyGeo.computeVertexNormals();
  const mouth=new THREE.Color('#4a1a15'),oral=new THREE.Color('#bb6a4e'),col=new THREE.Color('#94505a');
  tint(bodyGeo,(p,i)=>{const t=BODY_T*Math.pow(Math.floor(i/(segments+1))/rings,1.35),a=(i%(segments+1))/segments*Math.PI*2;
    // Radial mesenterial lines fade out before the margin; the column sits in shade.
    return mouth.clone().lerp(oral,smoothstep(.04,.22,t)).lerp(col,smoothstep(.92,1.45,t))
      .multiplyScalar((1+.11*Math.sin(a*26)*smoothstep(.10,.50,t)*(1-smoothstep(.75,1.05,t)))*(1-.62*smoothstep(1.,1.6,t)));});
  const body=new THREE.Mesh(bodyGeo,underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.62}),{key:'anemone-body',transmission:.10}));
  body.receiveShadow=true;scene.add(body);
  return {tentacles,count:TENTACLE_COUNT};
}

import * as THREE from 'three';
import { underwater } from './water.js';
import { merge, tint } from './geometry.js';

const color=c=>new THREE.Color(c);
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const n=x=>Number(x).toFixed(5);
function part(g,id) {g.setAttribute('part',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(id),1));return g;}
// Merger with an extra anatomical attribute. This is one mesh / draw per species including eyes.
function join(parts) {
  const anatomy=[];
  for(const g of parts) {
    const a=g.attributes.part;
    for(let i=0;i<a.count;i++)anatomy.push(a.getX(i));
  }
  const g=merge(parts);g.setAttribute('part',new THREE.Float32BufferAttribute(anatomy,1));return g;
}

// The snout sits at +SNOUT and the hypural plate at SNOUT-len; u runs 0 at the snout to
// 1 there. `back` and `belly` are the half-heights above and below the spine and `half`
// the half-width, at the knots below. Amphiprion percula is a short deep oval about half
// as deep as it is long; Chromis viridis is a shorter ovate damsel, thin enough to
// vanish edge-on; Pseudanthias squamipinnis is the elongate fusiform of the three.
// Part ids: 0 body, 1 median fin, 2 paired fin, 3 eye.
const SNOUT=.54,RAYS=11;
const KNOTS=[0,.05,.12,.20,.30,.42,.55,.68,.80,.90,1];
const SPECIES={
  clown:{
    len:.98,
    back:[.014,.086,.150,.198,.226,.232,.218,.184,.136,.086,.048],
    belly:[.016,.090,.154,.204,.234,.238,.216,.170,.116,.070,.040],
    half:[.007,.042,.064,.076,.084,.082,.074,.058,.040,.025,.015],
    eye:{u:.135,v:.34,r:.038},fin:'#e2610f',
    dorsal:{from:.200,to:.860,sink:.014,reach:[.046,.098,.112,.104,.086,.108,.110,.078,.030]},
    anal:{from:.600,to:.880,sink:.012,reach:[.036,.094,.104,.078,.030]},
    caudal:[[-.612,.150,0],[-.684,.196,0],[-.746,.176,0],[-.780,.104,0],[-.792,0,0],[-.780,-.102,0],[-.746,-.172,0],[-.684,-.192,0],[-.612,-.148,0]],
    pectoral:{base:[[.275,.30],[.305,.00],[.335,-.30]],tip:[[.365,.018,.096],[.428,-.024,.118],[.466,-.100,.110],[.436,-.160,.084],[.372,-.146,.058]]},
    pelvic:{base:[[.365,-.88],[.400,-.98]],tip:[[.430,-.300,.038],[.500,-.366,.046],[.552,-.312,.030]]},
  },
  chromis:{
    len:.82,
    back:[.020,.112,.170,.190,.196,.190,.170,.136,.098,.064,.037],
    belly:[.022,.112,.166,.186,.192,.184,.158,.120,.082,.054,.031],
    half:[.008,.035,.048,.055,.057,.055,.049,.039,.027,.018,.011],
    eye:{u:.115,v:.33,r:.040},fin:'#8ec3ca',
    dorsal:{from:.215,to:.800,sink:.011,reach:[.032,.066,.072,.074,.078,.090,.100,.072,.026]},
    anal:{from:.580,to:.830,sink:.010,reach:[.028,.072,.086,.066,.024]},
    caudal:[[-.620,.190,0],[-.590,.140,0],[-.546,.092,0],[-.496,.044,0],[-.462,0,0],[-.496,-.042,0],[-.546,-.090,0],[-.590,-.138,0],[-.620,-.188,0]],
    pectoral:{base:[[.255,.30],[.285,.00],[.315,-.30]],tip:[[.345,.015,.062],[.405,-.020,.076],[.442,-.086,.072],[.416,-.134,.054],[.356,-.124,.038]]},
    pelvic:{base:[[.345,-.88],[.380,-.98]],tip:[[.410,-.238,.028],[.472,-.292,.034],[.518,-.246,.022]]},
  },
  anthias:{
    len:1.14,
    back:[.011,.072,.130,.170,.192,.195,.182,.152,.110,.070,.038],
    belly:[.012,.074,.128,.168,.190,.190,.170,.134,.092,.056,.032],
    half:[.006,.032,.050,.060,.064,.062,.055,.043,.030,.019,.011],
    eye:{u:.118,v:.35,r:.036},fin:'#e4a94e',
    dorsal:{from:.180,to:.860,sink:.011,reach:[.040,.088,.100,.092,.086,.096,.104,.076,.030]},
    anal:{from:.600,to:.880,sink:.010,reach:[.032,.086,.096,.072,.028]},
    caudal:[[-.860,.225,0],[-.806,.160,0],[-.760,.104,0],[-.722,.050,0],[-.700,0,0],[-.722,-.048,0],[-.760,-.102,0],[-.806,-.158,0],[-.860,-.223,0]],
    pectoral:{base:[[.250,.30],[.280,.00],[.310,-.30]],tip:[[.340,.018,.068],[.402,-.022,.084],[.442,-.096,.080],[.412,-.150,.060],[.348,-.136,.042]]},
    pelvic:{base:[[.340,-.88],[.375,-.98]],tip:[[.408,-.268,.032],[.476,-.336,.038],[.526,-.284,.024]]},
  },
};
const axis=(kind,u)=>SNOUT-u*SPECIES[kind].len;
function along(values,u) {
  let i=1;while(i<KNOTS.length-1&&KNOTS[i]<u)i++;
  const t=(u-KNOTS[i-1])/(KNOTS[i]-KNOTS[i-1]),s=t*t*(3-2*t);
  return values[i-1]+(values[i]-values[i-1])*s;
}
function section(kind,u) {
  const s=SPECIES[kind];u=Math.max(0,Math.min(1,u));
  return {top:along(s.back,u),bottom:along(s.belly,u),half:along(s.half,u)};
}
/** Surface point at axial fraction u and angle a, a=0 on the dorsal midline.
 *  Fullness above 1 pinches the section toward a ridge at the back and a softer keel at
 *  the belly, which is what a laterally compressed fish's cross-section actually does;
 *  the gill chamber swells the cheek so the head is not a cone. */
function sectionPoint(kind,u,a,out=V()) {
  const s=section(kind,u),v=Math.cos(a),lateral=Math.sin(a);
  const full=.95+.48*Math.pow(Math.max(0,v),1.6)+.40*Math.pow(Math.max(0,-v),1.6);
  const cheek=1+.13*Math.exp(-(((u-.155)/.072)**2))*(.5-v*.5);
  const width=s.half*cheek*Math.pow(Math.abs(lateral),full)*Math.sign(lateral);
  return out.set(axis(kind,u),v>=0?v*s.top:v*s.bottom,width);
}
const skinPoint=(kind,u,v,side)=>{const q=sectionPoint(kind,u,Math.acos(v));return [q.x,q.y,side*Math.abs(q.z)];};

function bodyGeometry(kind) {
  const rings=40,sides=22,p=[],uv=[],index=[],q=V(),previous=V();
  for(let j=0;j<=rings;j++) {
    // Rows crowd toward the snout, where the profile and the orbit turn hardest.
    const u=Math.pow(j/rings,1.24),arc=[0];
    sectionPoint(kind,u,0,previous);
    for(let i=1;i<=sides;i++){sectionPoint(kind,u,i/sides*Math.PI*2,q);arc.push(arc[i-1]+q.distanceTo(previous));previous.copy(q);}
    const half=Math.max(arc[sides>>1],1e-6);
    for(let i=0;i<=sides;i++) {
      sectionPoint(kind,u,i/sides*Math.PI*2,q);p.push(q.x,q.y,q.z);
      // uv.y is the arc fraction from the dorsal midline to the ventral, identical on
      // both flanks: every colour zone then follows the outline rather than a height.
      uv.push(u,i<=sides>>1?arc[i]/half:(arc[sides]-arc[i])/half);
      if(j<rings&&i<sides){const k=j*(sides+1)+i;index.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);}
    }
  }
  // Close both ends so nothing is seen through the snout or the peduncle.
  for(const [row,u,flip] of [[0,0,false],[rings,1,true]]) {
    const hub=p.length/3;p.push(axis(kind,u),0,0);uv.push(u,.5);
    for(let i=0;i<sides;i++){const a=row*(sides+1)+i,b=a+1;index.push(...(flip?[hub,b,a]:[hub,a,b]));}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(index);g.computeVertexNormals();tint(g,()=>color('#ffffff'));return part(g,0);
}

/** A fin is a sheet lofted from its insertion line in the skin to its free margin.
 *  uv.x runs along the base — which ray — and uv.y from the hinge to the edge; the
 *  shader draws the rays, the pigment gradient and the membrane's thinning from those.
 *  The membrane falls short of the ray tips between rays, which is what makes a real
 *  fin's edge finely scalloped rather than a clean arc. */
function fin(base,tip,c,id,columns,steps=5) {
  const hinge=new THREE.CatmullRomCurve3(base.map(k=>V(...k))),margin=new THREE.CatmullRomCurve3(tip.map(k=>V(...k)));
  const p=[],uv=[],cols=[],index=[],a=V(),b=V(),q=V(),tone=color(c),root=tone.clone().multiplyScalar(.74);
  for(let i=0;i<=columns;i++) {
    const s=i/columns;hinge.getPoint(s,a);margin.getPoint(s,b);
    const reach=1-.034*Math.pow(.5-.5*Math.cos(Math.PI*2*s*RAYS),1.4);
    for(let j=0;j<=steps;j++) {
      const t=j/steps;q.lerpVectors(a,b,t*reach);p.push(q.x,q.y,q.z);uv.push(s,t);
      const cc=root.clone().lerp(tone,Math.min(1,t*1.7));cols.push(cc.r,cc.g,cc.b);
      if(i<columns&&j<steps){const k=i*(steps+1)+j;index.push(k,k+1,k+steps+1,k+1,k+steps+2,k+steps+1);}
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));g.setIndex(index);g.computeVertexNormals();return part(g,id);
}
// Median fins hinge a little inside the dorsal or ventral margin, so the membrane grows
// out of the skin instead of balancing on it. Both curves are sampled at the same
// stations: a ray then runs straight out from its own insertion.
function median(kind,{from,to,sink,reach},up) {
  const base=[],tip=[],count=reach.length-1;
  for(let i=0;i<=count;i++) {
    const u=from+(to-from)*i/count,s=section(kind,u),x=axis(kind,u),edge=up?s.top:-s.bottom;
    base.push([x,edge-(up?sink:-sink),0]);tip.push([x,edge+(up?reach[i]:-reach[i]),0]);
  }
  return [base,tip];
}
const hypural=kind=>{
  const s=section(kind,1),line=[];
  for(let i=0;i<=8;i++){const t=i/8;line.push([axis(kind,1)+.024*Math.sin(Math.PI*t),s.top+(-s.bottom-s.top)*t,0]);}
  return line;
};
// A flattened lens seated in the orbit. Its centre is shared with the shader, which
// paints the pupil, the thin iris ring and the sharp dark rim by radius.
function eyeSeat(kind) {
  const e=SPECIES[kind].eye,q=sectionPoint(kind,e.u,Math.acos(e.v));
  return {x:q.x,y:q.y,z:Math.abs(q.z)*.80,r:e.r};
}
function eye(kind,side) {
  const e=eyeSeat(kind),g=new THREE.SphereGeometry(1,10,6);
  g.scale(e.r,e.r*1.05,e.r*.44);g.translate(e.x,e.y,side*e.z);
  tint(g,()=>color('#ffffff'));return part(g,3);
}

export function makeFishGeometry(kind='clown') {
  const s=SPECIES[kind],parts=[bodyGeometry(kind)];
  parts.push(fin(...median(kind,s.dorsal,true),s.fin,1,20));
  parts.push(fin(...median(kind,s.anal,false),s.fin,1,13));
  parts.push(fin(hypural(kind),s.caudal,s.fin,1,22));
  for(const side of [-1,1]) {
    parts.push(fin(s.pectoral.base.map(([u,v])=>skinPoint(kind,u,v,side)),s.pectoral.tip.map(([u,y,z])=>[axis(kind,u),y,side*z]),s.fin,2,10,4));
    parts.push(fin(s.pelvic.base.map(([u,v])=>skinPoint(kind,u,v,side)),s.pelvic.tip.map(([u,y,z])=>[axis(kind,u),y,side*z]),s.fin,2,7,3));
    parts.push(eye(kind,side));
  }
  return join(parts);
}

// Skin pigment per species, in the order back → flank → belly. Bars, stripes and the
// iridescent layer are written against uv: uv.x is the axial fraction u, uv.y the arc
// fraction from the dorsal midline (0) to the ventral (1).
const SKIN={
  clown:`
    vec3 skin=mix(vec3(.66,.115,.006),vec3(1.00,.290,.012),smoothstep(.05,.44,band));
    skin=mix(skin,vec3(1.00,.470,.070),smoothstep(.64,.96,band));
    // Three bars: the head bar behind the eye, the mid bar with the forward-pointing
    // wedge that marks percula, the caudal bar on the peduncle. Each is a white core
    // inside a heavy black edge, which is the species' single loudest feature.
    float b1=abs(u-(.212+.034*band));
    float b2=abs(u-(.505-.082*exp(-pow((band-.46)/.27,2.))));
    float d=min(min(b1-.044,b2-.056),abs(u-.852)-.026);
    float aa=max(fwidth(d),.0012);
    skin=mix(skin,vec3(.013,.019,.023),1.-smoothstep(.021-aa,.021+aa,d));
    skin=mix(skin,vec3(.90,.895,.845),1.-smoothstep(-aa,aa,d));`,
  chromis:`
    vec3 skin=mix(vec3(.020,.115,.115),vec3(.105,.450,.400),smoothstep(.03,.26,band));
    skin=mix(skin,vec3(.320,.630,.560),smoothstep(.30,.58,band));
    skin=mix(skin,vec3(.640,.760,.720),smoothstep(.70,1.,band));
    // The dark pectoral-base spot, and the dusky wash carried onto the caudal peduncle.
    skin*=1.-.26*exp(-pow((u-.300)/.024,2.)-pow((band-.60)/.085,2.));
    skin*=1.-.20*smoothstep(.72,.97,u)*(1.-smoothstep(.55,.85,band));`,
  anthias:`
    vec3 skin=mix(vec3(.38,.105,.070),vec3(.78,.300,.140),smoothstep(.04,.38,band));
    skin=mix(skin,vec3(.90,.560,.400),smoothstep(.54,.94,band));
    // The violet stripe runs from under the eye back to the pectoral base.
    float stripe=exp(-pow((band-(.360+.30*u))/.085,2.))*smoothstep(.02,.07,u)*(1.-smoothstep(.15,.36,u));
    skin=mix(skin,vec3(.36,.17,.50),stripe*.95);
    // The terminal male: magenta-red, with the pale flank patch behind the pectoral.
    skin=mix(skin,mix(vec3(.40,.075,.155),vec3(.72,.27,.34),smoothstep(.08,.58,band)),vTrim.y);
    skin=mix(skin,vec3(.78,.61,.58),vTrim.y*.55*exp(-pow((u-.42)/.095,2.)-pow((band-.28)/.15,2.)));`,
};
// Fin membranes: the pigment across the span, hinge (0) to free margin (1).
const FINS={
  clown:`
    vec3 web=mix(vec3(.78,.225,.018),vec3(.90,.34,.05),span);
    web=mix(web,vec3(.030,.036,.042),smoothstep(.58,.80,span));
    web=mix(web,vec3(.78,.78,.72),smoothstep(.90,1.,span));`,
  chromis:`
    vec3 web=mix(vec3(.150,.470,.400),vec3(.32,.62,.56),span);
    web=mix(web,vec3(.055,.160,.210),smoothstep(.56,1.,span)*.8);`,
  anthias:`
    vec3 web=mix(vec3(.78,.290,.100),vec3(.86,.520,.055),smoothstep(.18,.80,span));
    web=mix(web,vec3(.48,.145,.205),vTrim.y*.6);`,
};
// Guanine platelets under the scales: a thin-film flare that only shows off normal.
const SHEEN={clown:'vec3(.10,.075,.115)',chromis:'vec3(.055,.290,.330)',anthias:'vec3(.190,.085,.245)'};

/** The skin, fin and eye shading for one species. Every animal of that species shares
 *  this material; what differs between them travels in the per-instance aFishTrim:
 *  x tail phase, y beat amplitude, z a shade offset, w the terminal male flag. */
function fishMaterial(kind) {
  const e=eyeSeat(kind);
  return underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.38,metalness:.02,side:THREE.DoubleSide,transparent:true,forceSinglePass:true}),{
    key:`fish-${kind}`,transmission:.085,
    vertex:`attribute float part;attribute vec4 aFishTrim;varying float vPart;varying vec3 vAnatomy;varying vec2 vSkinUv;varying vec2 vTrim;
      #define fishTrim aFishTrim
      float fishFlex(float x) {float q=clamp((.30-x)/1.14,0.,1.);return sin(fishTrim.x+q*3.7)*q*q*fishTrim.y;}
      float fishSlope(float x){float q=clamp((.30-x)/1.14,0.,1.);return -fishTrim.y/1.14*(2.*q*sin(fishTrim.x+q*3.7)+3.7*q*q*cos(fishTrim.x+q*3.7));}`,
    normal:`objectNormal=normalize(vec3(normal.x-fishSlope(position.x)*normal.z,normal.y,normal.z));`,
    begin:`vPart=part;vAnatomy=position;vSkinUv=uv;vTrim=fishTrim.zw;
      transformed.z+=fishFlex(position.x);
      if(part>1.5&&part<2.5){float hinge=clamp((.30-position.x)*3.4,0.,1.);transformed.z+=sign(position.z)*sin(fishTrim.x*1.6)*hinge*.030;}
      ${kind==='anthias'?`// Both sexes carry the lyre; the terminal male's lobes and third dorsal spine are drawn out further.
      if(part>.5&&part<1.5){
        if(position.x<-.58){transformed.x-=fishTrim.w*.20*uv.y*smoothstep(.06,.24,abs(position.y));transformed.y+=sign(position.y)*fishTrim.w*.09*uv.y;}
        else if(position.y>.10)transformed.y+=fishTrim.w*.22*uv.y*exp(-pow((uv.x-.16)/.07,2.));
      }`:''}`,
    fragment:`varying float vPart;varying vec3 vAnatomy;varying vec2 vSkinUv;varying vec2 vTrim;`,
    color:`
      float u=vSkinUv.x,band=vSkinUv.y,span=clamp(vSkinUv.y,0.,1.);
      if(vPart<.5){
        ${SKIN[kind]}
        // The opercular margin and the mouth cleft are seams in the pigment, not geometry:
        // at this size a modelled gill cover would cost triangles nobody could resolve.
        skin*=1.-.26*exp(-pow((u-(.255-.06*band))/.011,2.))*(1.-smoothstep(.78,1.,band));
        float cleft=exp(-pow((band-(.60+2.6*u))/.045,2.))*(1.-smoothstep(.035,.085,u));
        skin=mix(skin,skin*.34,cleft*.8);
        // Imbricate scale rows, faded out once a scale falls under a pixel.
        vec2 cell=vec2(u*27.,band*11.);cell.x+=mod(floor(cell.y),2.)*.5;
        skin*=1.-.115*smoothstep(.40,.50,length(fract(cell)-.5))*(1.-smoothstep(.42,1.15,max(fwidth(cell.x),fwidth(cell.y))));
        // Countershading and a per-animal shift, so no two of a species read identical.
        skin*=1.-.34*(1.-smoothstep(0.,.11,band));
        skin*=vec3(.93+.14*vTrim.x,.96+.08*vTrim.x,1.03-.10*vTrim.x);
        diffuseColor.rgb=skin*(.975+.025*sin(vAnatomy.x*96.+sin(vAnatomy.y*88.)));
      }else if(vPart<2.5){
        ${FINS[kind]}
        // Bone splints stand proud of the membrane between them.
        float rib=pow(.5+.5*cos(vSkinUv.x*${n(Math.PI*2*RAYS)}),26.);
        diffuseColor.rgb=web*(.95+.11*rib)*(.94+.12*vTrim.x);
        // Two cell layers on those splints: opaque at the hinge, all but hyaline at the
        // free margin, and the paired fins thinner again than the median ones.
        diffuseColor.a=clamp((.64+.32*(1.-span)+.22*rib)*(vPart>1.5?.58:1.),.34,1.);
      }else{
        float r=length((vAnatomy.xy-vec2(${n(e.x)},${n(e.y)}))/${n(e.r)});
        diffuseColor.rgb=mix(vec3(.004,.006,.008),mix(vec3(.26,.20,.09),vec3(.07,.055,.03),r),smoothstep(.50,.64,r));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.016,.024,.030),smoothstep(.84,.95,r));
        // A wet cornea always carries one small catchlight; without it the eye is a
        // printed dot, and at this size that reads before anything else does.
        diffuseColor.rgb+=vec3(.62,.64,.66)*exp(-dot((vAnatomy.xy-vec2(${n(e.x+e.r*.30)},${n(e.y+e.r*.32)}))/${n(e.r*.27)},(vAnatomy.xy-vec2(${n(e.x+e.r*.30)},${n(e.y+e.r*.32)}))/${n(e.r*.27)}));
      }
    `,
    surfaceNormal:`
      if(vPart<.5){
        float fresnel=pow(1.-abs(dot(normal,normalize(vViewPosition))),3.4);
        float flank=smoothstep(.09,.33,vSkinUv.y)*(1.-smoothstep(.60,.92,vSkinUv.y));
        diffuseColor.rgb+=${SHEEN[kind]}*fresnel*flank*(.75+.5*vTrim.x);
        // The dorsal ridge and the belly keel are the two places the surface turns to face
        // the lamps square on; scaleless skin there is matt, or the back reads as a
        // painted white stripe under a tank light.
        roughnessFactor=.50+.26*(1.-smoothstep(.05,.26,vSkinUv.y))+.14*smoothstep(.78,1.,vSkinUv.y);
      }else if(vPart>2.5)roughnessFactor=.06;
      // A fin membrane is matt collagen: at a grazing angle a glossy one throws a hard
      // white line along the back that no fish has.
      else roughnessFactor=.76;
    `,
  });
}

/** A draw call per species rather than per animal. The same anatomical geometry
 *  and muscle-wave shader are used, with per-instance phase/effort and transform.
 */
export function createFishSchool(scene,simulation){
  const groups=[];
  for(const kind of ['clown','chromis','anthias']){
    const fish=simulation.fish.filter(f=>f.kind===kind),geometry=makeFishGeometry(kind);
    const data=new Float32Array(fish.length*4),attribute=new THREE.InstancedBufferAttribute(data,4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFishTrim',attribute);
    const mesh=new THREE.InstancedMesh(geometry,fishMaterial(kind),fish.length);mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh); // tiny fixed population, shader-deformed bounds
    // Trim z shades each animal a little differently; w marks the one terminal male.
    groups.push({fish,data,attribute,mesh,trim:fish.map((f,i)=>[(i*.6180339887+.31)%1,kind==='anthias'&&f.rank===0?1:0])});
  }
  const dummy=new THREE.Object3D(),euler=new THREE.Euler(0,0,0,'YXZ');
  return {update(){
    for(const group of groups){
      for(let i=0;i<group.fish.length;i++){
        const f=group.fish[i];dummy.position.copy(f.position);dummy.scale.setScalar(f.size);euler.set(f.roll,f.yaw,f.pitch);dummy.quaternion.setFromEuler(euler);dummy.updateMatrix();group.mesh.setMatrixAt(i,dummy.matrix);
        group.data.set([f.phase,.035+Math.min(.115,f.lastSpeed*.095+f.effort*.025),...group.trim[i]],i*4);
      }
      group.attribute.needsUpdate=true;group.mesh.instanceMatrix.needsUpdate=true;
    }
  },groups};
}

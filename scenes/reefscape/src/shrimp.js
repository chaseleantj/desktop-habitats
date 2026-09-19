import * as THREE from 'three';
import { merge, tint, tube } from './geometry.js';
import { underwater, responseGLSL } from './water.js';
import { supportHeight } from './terrain.js';
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
function sphere(p,s,c){const g=new THREE.SphereGeometry(1,16,10);g.scale(...s);g.translate(...p);tint(g,()=>new THREE.Color(c));return g;}
// Nothing on the animal is textured, so its appendages carry their animation parameters in
// uv instead: x is the appendage's code, y how far along it the vertex sits. Codes 0 and 1
// are the two chelate pairs, 2-4 the ambulatory pereiopods, 5 the third maxillipeds, 6-10
// the pleopods front to back, and on the antenna mesh 0 is the long flagellum.
function limb(points,radii,code){const g=tube(points,radii,5),uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setX(i,code);return g;}
// How far the body rides over the rock — an eighth of its length, which is where a caridean
// carries itself. It is also the lever it rocks about, since a shrimp leaning on its legs
// pivots at its feet and not at its middle.
const SEAT=.132;
// Roughly the width of the stance, so the slope is read across the feet. On a shoulder that
// differs enough from the slope under the animal's middle to hang its outside legs in water.
const STANCE=.20;
// The caridoid escape folds the abdomen under the thorax about the joint behind the
// carapace until the tail fan meets it — 25 degrees between the two, in Arnott's high-speed
// frames. Every mesh carrying abdominal parts bends about it, so the pleopods come with.
const FLEX=`float behind=max(0.,-.13-position.x),bend=shrimpPose.w*4.0*behind;
  vec2 arm=transformed.xy-vec2(-.13,.145);
  transformed.xy=vec2(-.13+arm.x*cos(bend)-arm.y*sin(bend),.145+arm.x*sin(bend)+arm.y*cos(bend));`;

export function createShrimp(scene, simulation) {
  const models=[],up=V(0,1,0),ahead=V(1,0,0),across=V(0,0,1),normal=V(0,1,0),seat=V(0,0,0);
  const tilt=new THREE.Quaternion(),turn=new THREE.Quaternion(),rock=new THREE.Quaternion(),rear=new THREE.Quaternion();
  for(let index=0;index<simulation.shrimp.length;index++) {
    const root=new THREE.Group(),bodyParts=[],legs=[],antennae=[];
    const carapace=sphere([.08,.15,0],[.235,.085,.091],'#d45338');
    // Broad reflective dorsal stripe down a red carapace, not painted glowing eyes.
    tint(carapace,p=>new THREE.Color(p.y>.173?(Math.abs(p.z)<.025?'#eae5ce':'#b4543e'):'#bd9a7c'));
    bodyParts.push(carapace);
    for(let i=0;i<6;i++){
      const x=-.12-i*.060,y=.13-Math.pow(i/5,2)*.10;
      const g=sphere([x,y,0],[.070-i*.003,.061-i*.004,.069-i*.005],'#c9543f');
      tint(g,p=>new THREE.Color(Math.abs(p.z)<.022&&p.y>y+.021?'#efe7cc':p.y>y+.022?'#b65e45':p.x<x-.043?'#a78669':'#cfb092'));bodyParts.push(g);
    }
    // Telson + paired uropods; overlap the sixth segment without a gap.
    for(let side=-1;side<=1;side++)bodyParts.push(sphere([-.50,-.006,side*.069],[.103,.016,.049],side===0?'#d56345':'#eddbb7'));
    bodyParts.push(tube([V(.25,.17,0),V(.38,.20,0),V(.42,.24,0)],[.020,.012,.001],6));
    for(const sign of [-1,1]){
      bodyParts.push(tube([V(.22,.19,sign*.045),V(.26,.25,sign*.087)],[.016,.014],6));
      bodyParts.push(sphere([.26,.26,sign*.087],[.027,.030,.027],'#102629'));
      bodyParts.push(sphere([.271,.270,sign*.097],[.008,.009,.007],'#d0dacc'));
      // A caridean walks on three pairs: P1 is short and stoutly chelate and P2 is the
      // genus' thread-fine chela on a many-jointed carpus, and it picks with both rather
      // than walking on them. Five walking pairs was the wrong read. Both are drawn in five
      // sections, because the pick folds them and four rings creased instead of bending.
      const carried=[
        [[V(.18,.105,sign*.042),V(.168,.048,sign*.078),V(.192,-.010,sign*.094),V(.250,-.078,sign*.090),V(.300,-.135,sign*.076)],[.0090,.0080,.0070,.0105,.0020]],
        [[V(.112,.105,sign*.042),V(.140,.058,sign*.076),V(.215,.018,sign*.074),V(.310,-.018,sign*.062),V(.395,-.050,sign*.048)],[.0070,.0050,.0040,.0042,.0010]]];
      for(let j=0;j<5;j++){
        // The coxa starts inside the shell: the rear pairs stand wider than the abdomen,
        // so a root on the body's own half-width left them beginning in open water. The
        // stance stays inside the shoulder the animal is standing on, which is what keeps
        // the outside feet on rock rather than hanging over the drop.
        const x=.18-j*.068;
        const [path,radii]=j<2?carried[j]
          :[[V(x,.105,sign*.042),V(x-.06,.06,sign*(.15+j*.010)),V(x+.10-j*.026,-.15,sign*(.20+j*.020))],[.009,.008,.003]];
        legs.push(tint(limb(path,radii,j),()=>new THREE.Color(j<2?'#e9cca8':'#e3b597')));
      }
      // Third maxillipeds under the head: the grooming appendages, small and never still.
      legs.push(tint(limb([V(.14,.075,sign*.040),V(.19,-.005,sign*.062),V(.225,-.075,sign*.050)],[.010,.008,.003],5),()=>new THREE.Color('#e9cca8')));
      // Five pairs of pleopods under the first five abdominal somites. They are a short
      // fringe tucked against the belly, not a second row of legs, and they read from the
      // side or when the animal is off the rock; their wave is what says it is alive rather
      // than propped there.
      for(let i=0;i<5;i++){
        const x=-.12-i*.060,y=.090-Math.pow(i/5,2)*.10;
        legs.push(tint(limb([V(x,y,sign*.022),V(x-.014,y-.028,sign*.028),V(x-.026,y-.048,sign*.030)],[.0060,.0050,.0014],6+i),()=>new THREE.Color('#d9b99c')));
      }
      for(let j=0;j<3;j++){
        const pts=[],radii=[];
        for(let k=0;k<=24;k++){
          const s=k/24,len=j===0?1.42:j===1?1.10:.76;
          pts.push(V(.25+s*len*(j===2?.66:.95),.23+s*(.66-j*.23)-.26*s*s,sign*(.075+s*(.30+j*.18))));
          radii.push(.010*(1-s*.86));
        }
        antennae.push(tint(limb(pts,radii,j),()=>new THREE.Color('#ede4c9')));
      }
    }
    // One wrapped two-second clock drives every small rhythm on the animal, so their rates
    // are whole multiples of 0.5 Hz and no phase drifts however long the scene has run.
    const gait={value:new THREE.Vector4(0,0,0,0)},pose={value:new THREE.Vector4(0,0,0,0)};
    const drive=material=>{const inner=material.onBeforeCompile;material.onBeforeCompile=s=>{inner(s);s.uniforms.shrimpGait=gait;s.uniforms.shrimpPose=pose;};return material;};
    const bodyMat=drive(underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.46}),{
      key:'shrimp-shell',transmission:.045,vertex:'uniform vec4 shrimpPose;',begin:FLEX}));
    root.add(new THREE.Mesh(merge(bodyParts),bodyMat));
    const legMat=drive(underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.66}),{
      key:'shrimp-legs',vertex:'uniform vec4 shrimpGait;uniform vec4 shrimpPose;',
      begin:`float code=uv.x,along=uv.y,side=sign(position.z),tip=along*(.30+.70*along);
        if(code<4.5){
          // The wave runs from the back pair forward, a quarter cycle between neighbours at
          // cruising speed, and the two sides in antiphase. Stance and swing are separate
          // arcs rather than one sine, so a planted foot tracks straight back at the body's
          // own speed instead of sliding through the rock. The chelate pairs are carried
          // rather than walked on, so they shuffle along instead of striding.
          float cycle=fract(shrimpGait.x+code*.26+.25*(1.+side)),stance=step(cycle,.70);
          float u=mix((cycle-.70)/.30,cycle/.70,stance),drive=shrimpGait.y*tip*(code>1.5?1.:.35);
          // Half of SHRIMP.stride in simulation.js, which is what stops the feet skating.
          transformed.x+=mix(2.*u-1.,1.-2.*u,stance)*.0475*drive;
          transformed.y+=(1.-stance)*sin(3.14159*u)*.036*drive;
          // The legs draw up under the animal as the abdomen fires.
          transformed+=vec3(-.03,.05,0.)*shrimpPose.w*tip;
        }
        if(code<1.5){
          // The chelate pairs pick: a claw rests on the rock and folds up to the mouthparts
          // and back, left and right out of phase, so the animal picks about twice a second.
          // The limb shortens as it folds, because a claw that only swung on a rigid arm
          // would arrive somewhere out in front of the head instead of at the mouth. The
          // same fold is the reach the animal makes at a client hanging over it.
          float swing=(sin(6.2832*shrimpGait.w+side*3.14159)*.5+.5)*shrimpGait.z+shrimpPose.z*.85;
          float fold=clamp((along-.22)*1.4,0.,1.),bend=swing*fold*(1.-.30*code);
          vec2 arm=(transformed.xy-vec2(.155,.075))*(1.-.36*max(0.,bend));
          transformed.xy=vec2(.155+arm.x*cos(bend)-arm.y*sin(bend),.075+arm.x*sin(bend)+arm.y*cos(bend));
          transformed.z*=1.-.30*max(0.,bend);
          // The advertisement itself. Caves found L. amboinensis signals by rocking this
          // white front pair fore and aft at a few hertz — not by swaying its whole body —
          // and rocks hardest at the big dark clients that are worth the risk of cleaning.
          transformed.x+=sin(25.13*shrimpGait.w)*.024*shrimpPose.x*fold*(1.-.5*code);
        }
        // 5 Hz: the mouthparts flicker far faster than anything else the animal does.
        if(code>4.5&&code<5.5)transformed+=vec3(.012,.009,0.)*sin(31.42*shrimpGait.w+side*1.7)*tip;
        if(code>5.5){
          // Swimmerets beat as a wave running forward at a clean quarter cycle a pair, so
          // the first and fifth are in step; five pairs make a full wavelength of abdomen.
          // They are not a heartbeat — a shrimp standing on rock barely fans them, and they
          // only really drive when it is walking or off the rock altogether.
          float beat=sin(18.85*shrimpGait.w+(code-6.)*1.5708),amp=.12+.88*max(shrimpGait.y,shrimpPose.w);
          transformed.x+=beat*.020*amp*tip;transformed.y+=abs(beat)*.007*amp*tip;
        }
        ${FLEX}`}));
    root.add(new THREE.Mesh(merge(legs),legMat));
    const antennaMat=drive(underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.62}),{
      key:'shrimp-antennae',vertex:`uniform vec4 shrimpGait;uniform vec4 shrimpPose;${responseGLSL}`,
      begin:`float along=uv.y,side=sign(position.z),tip=along*along,antenna=step(uv.x,.5);
        vec2 flow=reefResponse(modelMatrix[3].xyz,reefTime,.19);
        // The long white antennae are the advertisement, and they are read from across the
        // tank: whipping them precedes four cleans in five. They lash forward at about two
        // hertz while the animal is signalling and lie swept back when it is not.
        float sweep=sin(12.566*shrimpGait.w+side*.9)*shrimpPose.x*antenna;
        // An antennule flick is a hard downstroke and a lazy return, roughly one to three —
        // the asymmetry is what traps a discrete parcel of water for the aesthetascs.
        float p=fract(shrimpGait.w*2.),snap=(p<.22?p/.22:1.-(p-.22)/.78)*shrimpPose.y*(1.-antenna);
        transformed.z+=(sweep*side*.14+flow.y*.20)*tip;
        // L. amboinensis taps a client with its antennae before anything else touches it.
        transformed.y+=(sweep*.11-snap*.11+flow.x*.15+shrimpPose.z*(.30+.12*sin(12.566*shrimpGait.w)))*tip;
        transformed.x-=(snap*.035+(1.-shrimpPose.x)*.09*antenna+shrimpPose.w*.22)*tip;`}));
    root.add(new THREE.Mesh(merge(antennae),antennaMat));
    scene.add(root);models.push({root,gait,pose});
  }
  return {update(){models.forEach((m,i)=>{const s=simulation.shrimp[i],x=s.position.x,z=s.position.z;
    normal.set(-THREE.MathUtils.clamp((supportHeight(x+STANCE,z)-supportHeight(x-STANCE,z))/(2*STANCE),-.38,.38),1,
      -THREE.MathUtils.clamp((supportHeight(x,z+STANCE)-supportHeight(x,z-STANCE))/(2*STANCE),-.38,.38)).normalize();
    tilt.setFromUnitVectors(up,normal);turn.setFromAxisAngle(up,s.yaw);
    // The body rock that goes with the antennal whip is a lean on the legs, and reaching for
    // a client lifts the whole front of the animal, so both are rotations of the body rather
    // than offsets bolted onto it.
    rock.setFromAxisAngle(ahead,s.sway*.28);rear.setFromAxisAngle(across,s.reach*.26);
    m.root.quaternion.copy(tilt).multiply(turn).multiply(rock).multiply(rear);
    // Feet on the rock: every one of those rotations turns about the contact patch, and the
    // tail flip is the one thing that takes the animal off it.
    seat.set(0,SEAT+s.curl*.26,0).applyQuaternion(m.root.quaternion);
    m.root.position.set(x+seat.x,supportHeight(x,z)+seat.y,z+seat.z);
    m.gait.value.set(s.step,s.walk,s.pick,s.rhythm);m.pose.value.set(s.signal,s.flick,s.reach,s.curl);
  });},models};
}

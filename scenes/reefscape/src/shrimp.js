import * as THREE from 'three';
import { merge, tint, tube } from './geometry.js';
import { underwater, responseGLSL } from './water.js';
import { supportHeight } from './terrain.js';
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
function sphere(p,s,c){const g=new THREE.SphereGeometry(1,16,10);g.scale(...s);g.translate(...p);tint(g,()=>new THREE.Color(c));return g;}

export function createShrimp(scene, simulation) {
  const models=[],up=new THREE.Vector3(0,1,0),normal=new THREE.Vector3(),tilt=new THREE.Quaternion(),yaw=new THREE.Quaternion();
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
      for(let j=0;j<5;j++){
        const x=.18-j*.068;
        const knee=V(x-.06,.06,sign*(.17+j*.009));
        const foot=V(x+.10-j*.026,-.15,sign*(.25+j*.024));
        const path=[V(x,.09,sign*.072),knee,foot];
        const g=tube(path,[.009,.008,.003],5);
        tint(g,()=>new THREE.Color(j<2?'#e9cca8':'#e3b597'));legs.push(g);
        if(j===0){bodyParts.push(tube([foot.clone().add(V(0,.10,0)),foot.clone().add(V(.052,.075,0))],[.011,.003],5));}
      }
      for(let j=0;j<3;j++){
        const pts=[],radii=[];
        for(let k=0;k<=24;k++){
          const s=k/24,len=j===0?1.42:j===1?1.10:.76;
          pts.push(V(.25+s*len*(j===2?.66:.95),.23+s*(.66-j*.23)-.26*s*s,sign*(.075+s*(.30+j*.18))));
          radii.push(.010*(1-s*.86));
        }
        const geo=tube(pts,radii,5);tint(geo,()=>new THREE.Color('#ede4c9'));antennae.push(geo);
      }
    }
    const bodyMat=underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.46}),{key:'shrimp-shell',transmission:.045});
    root.add(new THREE.Mesh(merge(bodyParts),bodyMat));
    const movement={value:new THREE.Vector3(index*2.4,0,1)};
    const legMat=underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.66}),{
      key:'shrimp-legs',vertex:'uniform vec3 shrimpMotion;',
      begin:`float reach=clamp((.09-position.y)/.24,0.,1.);float phase=shrimpMotion.x+position.x*37.+sign(position.z)*3.14159;
        float lift=max(0.,sin(phase))*shrimpMotion.y;
        transformed.y+=lift*reach*.035;transformed.x+=cos(phase)*shrimpMotion.y*reach*.020;`,
    });
    const wrap=legMat.onBeforeCompile;legMat.onBeforeCompile=s=>{wrap(s);s.uniforms.shrimpMotion=movement;};
    root.add(new THREE.Mesh(merge(legs),legMat));
    const antennaMat=underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.62}),{
      key:'shrimp-antennae',vertex:`uniform vec3 shrimpMotion;${responseGLSL}`,
      begin:`float reach=clamp((position.x-.25)/1.4,0.,1.);vec2 flow=reefResponse(modelMatrix[3].xyz,reefTime,.19);
        float bend=sin(reefTime*1.2+sign(position.z)*.9)*.075*shrimpMotion.z;
        transformed.z+=(bend*sign(position.z)+flow.y*.2)*reach*reach;
        transformed.y+=flow.x*.15*reach*reach;`,
    });
    const wrapped=antennaMat.onBeforeCompile;antennaMat.onBeforeCompile=s=>{wrapped(s);s.uniforms.shrimpMotion=movement;};
    root.add(new THREE.Mesh(merge(antennae),antennaMat));
    scene.add(root);models.push({root,movement});
  }
  return {update(){models.forEach((m,i)=>{const s=simulation.shrimp[i];m.root.position.copy(s.position);const x=s.position.x,z=s.position.z;normal.set(-THREE.MathUtils.clamp((supportHeight(x+.12,z)-supportHeight(x-.12,z))/.24,-.38,.38),1,-THREE.MathUtils.clamp((supportHeight(x,z+.12)-supportHeight(x,z-.12))/.24,-.38,.38)).normalize();tilt.setFromUnitVectors(up,normal);yaw.setFromAxisAngle(up,s.yaw);m.root.quaternion.copy(tilt).multiply(yaw);m.movement.value.set(s.step,s.walk>0?1:0,s.signal||1);});},models};
}

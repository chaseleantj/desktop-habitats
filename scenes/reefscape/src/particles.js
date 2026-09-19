import * as THREE from 'three';
import { randomGenerator } from './math.js';
import { currentAt, shaftGLSL, extinctionGLSL, shadowGLSL, waterTime } from './water.js';

/** Suspended matter. Real tank water is never optically empty: there is always detritus
 *  and marine snow drifting in the circulation, and it is most of what tells the eye the
 *  water has a front and a back. A mote is sized and faded by its own distance, so the
 *  near ones read as soft close-up specks and the far ones as fine haze, and each one
 *  brightens as it drifts through a light shaft and goes dark in the rock's shadow. */
export function createParticles(scene,simulation,shadow){
  const rng=randomGenerator(846),N=3400,pos=new Float32Array(N*3),vel=new THREE.Vector3(),point=new THREE.Vector3();
  // grain.x scales the mote, grain.y its brightness, grain.z how fast it sinks. A few
  // large slow flecks among many fine ones, rather than one uniform dust.
  const grain=new Float32Array(N*3),sink=new Float32Array(N);
  for(let i=0;i<N;i++){
    pos.set([(rng()-.5)*21,rng()*8,-4+rng()*10],i*3);
    const big=rng()<.10,size=big?1.7+rng()*1.5:.55+rng()*.75;
    grain.set([size,(big?.85:.55)+rng()*.55,0],i*3);
    sink[i]=(big?.016:.006)+rng()*.008;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('grain',new THREE.BufferAttribute(grain,3));
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{pixelRatio:{value:1},reefTime:waterTime,...shadow},
    vertexShader:`uniform float pixelRatio;uniform float reefTime;attribute vec3 grain;varying float fade;varying float disc;
      #include <packing>
      ${shaftGLSL}${extinctionGLSL}${shadowGLSL}
      void main(){
        vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
        // A speck close to the lens is a soft disc the size of the lens's blur circle, not
        // a sharper point; the fragment fades the big ones so their light stays the same.
        disc=clamp(26.*grain.x/(-mv.z),1.1,16.);gl_PointSize=disc*pixelRatio;
        // Lit by the same beams the water column is, dark where the rock shades the lamp,
        // and thinned by the water in front of it. Outside a shaft a mote is barely there:
        // the shafts are visible because of what floats in them, not the other way round.
        fade=grain.y*(.09+.95*reefShaft(position,reefTime)*reefLit(position))*dot(reefTransmittance(reefWaterPath(position,cameraPosition)),vec3(.25,.35,.40));
      }`,
    fragmentShader:`varying float fade;varying float disc;
      void main(){float a=(1.-smoothstep(.08,.50,length(gl_PointCoord-.5)))*min(1.,4.5/disc);gl_FragColor=vec4(.80,.87,.92,a*fade);}`});
  const points=new THREE.Points(g,mat);points.frustumCulled=false;scene.add(points);
  const foodGeo=new THREE.SphereGeometry(1,7,5),foodMat=new THREE.MeshStandardMaterial({color:'#b49366',roughness:.9});
  const pellets=new THREE.InstancedMesh(foodGeo,foodMat,simulation.food.length);pellets.frustumCulled=false;scene.add(pellets);const dummy=new THREE.Object3D();
  return {update(dt){
    for(let i=0;i<N;i++){
      point.fromArray(pos,i*3);currentAt(point,simulation.time,vel);point.addScaledVector(vel,dt);point.y-=dt*sink[i];
      if(point.x>11)point.x=-11;if(point.x<-11)point.x=11;if(point.y<-.4)point.y=8;if(point.z>6)point.z=-4;if(point.z<-4)point.z=6;point.toArray(pos,i*3);
    }
    g.attributes.position.needsUpdate=true;
    simulation.food.forEach((p,i)=>{dummy.position.copy(p.position);dummy.scale.setScalar(p.active?p.size*(1-Math.pow(p.age/36,4)):0);dummy.updateMatrix();pellets.setMatrixAt(i,dummy.matrix);});
    pellets.instanceMatrix.needsUpdate=true;
  },setPixelRatio(r){mat.uniforms.pixelRatio.value=r;}};
}

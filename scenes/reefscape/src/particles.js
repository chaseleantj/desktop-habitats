import * as THREE from 'three';
import { randomGenerator } from './math.js';
import { currentAt } from './water.js';

export function createParticles(scene,simulation){
  const rng=randomGenerator(846),N=96,pos=new Float32Array(N*3),vel=new THREE.Vector3(),point=new THREE.Vector3();
  for(let i=0;i<N;i++)pos.set([(rng()-.5)*21,rng()*8,(rng()-.5)*13],i*3);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{pixelRatio:{value:1}},vertexShader:`uniform float pixelRatio;varying float fade;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(19./(-mv.z),.7,2.2)*pixelRatio;fade=.14+.11*clamp(position.y/8.,0.,1.);}`,fragmentShader:`varying float fade;void main(){float a=1.-smoothstep(.12,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.77,.88,.85,a*fade);}`});
  const points=new THREE.Points(g,mat);points.frustumCulled=false;scene.add(points);
  const foodGeo=new THREE.SphereGeometry(1,7,5),foodMat=new THREE.MeshStandardMaterial({color:'#b49366',roughness:.9});
  const pellets=new THREE.InstancedMesh(foodGeo,foodMat,simulation.food.length);pellets.frustumCulled=false;scene.add(pellets);const dummy=new THREE.Object3D();
  return {update(dt){
    for(let i=0;i<N;i++){
      point.fromArray(pos,i*3);currentAt(point,simulation.time,vel);point.addScaledVector(vel,dt);point.y-=dt*.009;
      if(point.x>11)point.x=-11;if(point.x<-11)point.x=11;if(point.y<-.4)point.y=8;if(point.z>7)point.z=-7;if(point.z<-7)point.z=7;point.toArray(pos,i*3);
    }
    g.attributes.position.needsUpdate=true;
    simulation.food.forEach((p,i)=>{dummy.position.copy(p.position);dummy.scale.setScalar(p.active?p.size*(1-Math.pow(p.age/36,4)):0);dummy.updateMatrix();pellets.setMatrixAt(i,dummy.matrix);});
    pellets.instanceMatrix.needsUpdate=true;
  },setPixelRatio(r){mat.uniforms.pixelRatio.value=r;}};
}

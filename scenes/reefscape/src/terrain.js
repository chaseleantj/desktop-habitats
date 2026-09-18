import * as THREE from 'three';
import { merge, ellipsoid, tint } from './geometry.js';
import { randomGenerator, groundHeight } from './math.js';
import { underwater } from './water.js';
import { ROCKS, HOST, STATIONS, TANK } from './layout.js';
export {ROCKS,HOST,STATIONS};
let surfaceField=null,surfaceW=0,surfaceH=0;
export function supportHeight(x,z){
  if(surfaceField){const u=Math.max(0,Math.min(surfaceW-1,(x+9.65)/19.3*(surfaceW-1))),v=Math.max(0,Math.min(surfaceH-1,(z+4.1)/10.2*(surfaceH-1))),ix=Math.min(surfaceW-2,Math.floor(u)),iz=Math.min(surfaceH-2,Math.floor(v)),tx=u-ix,tz=v-iz;
    return (surfaceField[iz*surfaceW+ix]*(1-tx)+surfaceField[iz*surfaceW+ix+1]*tx)*(1-tz)+(surfaceField[(iz+1)*surfaceW+ix]*(1-tx)+surfaceField[(iz+1)*surfaceW+ix+1]*tx)*tz;}
  let y=groundHeight(x,z);for(const r of ROCKS){const q=((x-r[0])/r[3])**2+((z-r[2])/r[5])**2;if(q<1)y=Math.max(y,r[1]+r[4]*Math.sqrt(1-q)*.95);}return y;}

async function liveRockGeometry(){
  const response=await fetch(new URL('../assets/live-rock.bin',import.meta.url));if(!response.ok&&response.status!==0)throw new Error('Unable to load live-rock geometry.');
  const support=await fetch(new URL('../assets/rock-support.bin',import.meta.url));if(!support.ok&&support.status!==0)throw new Error('Unable to load attachment field.');
  const sb=await support.arrayBuffer(),sh=new Uint32Array(sb,0,2);surfaceW=sh[0];surfaceH=sh[1];surfaceField=new Float32Array(sb,8,surfaceW*surfaceH);
  const buffer=await response.arrayBuffer(),head=new Uint32Array(buffer,0,4),N=head[2],I=head[3];
  if(head[0]!==0x52454546||head[1]!==1||buffer.byteLength<16+N*27+I*4)throw new Error('Invalid live-rock asset.');
  const geo=new THREE.BufferGeometry();let offset=16;
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buffer,offset,N*3),3));offset+=N*12;
  geo.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(buffer,offset,N*3),3));offset+=N*12;
  geo.setAttribute('color',new THREE.BufferAttribute(new Uint8Array(buffer,offset,N*3),3,true));offset=Math.ceil((offset+N*3)/4)*4;
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer,offset,I),1));geo.computeBoundingSphere();return geo;
}
export async function createTerrain(scene){
  const rng=randomGenerator(952),loader=new THREE.TextureLoader();
  const [sandMap,sandNormal,rockMap,rockNormal,rockGeo,poreNormal,poreDetail]=await Promise.all([
    ...['sand_01_diff.jpg','sand_01_nor_gl.jpg','rock_boulder_dry_diff.jpg','rock_boulder_dry_nor_gl.jpg'].map(name=>loader.loadAsync(new URL('../../riverscape/assets/'+name,import.meta.url).href)),liveRockGeometry(),loader.loadAsync(new URL('../assets/limestone-normal.png',import.meta.url)),loader.loadAsync(new URL('../assets/limestone-detail.png',import.meta.url))]);
  for(const t of [sandMap,sandNormal,rockMap,rockNormal,poreNormal,poreDetail]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;}
  sandMap.colorSpace=rockMap.colorSpace=THREE.SRGBColorSpace;
  sandMap.repeat.set(11,5.5);sandNormal.repeat.copy(sandMap.repeat);
  // Aragonite reads cream, not paper white: the grain keeps its shadowed texture under the lamp.
  const sandMat=underwater(new THREE.MeshStandardMaterial({color:'#eee9d9',roughness:.96,map:sandMap,normalMap:sandNormal,normalScale:new THREE.Vector2(.62,.62)}),{key:'tank-sand',vertex:'attribute float shade;varying float vShade;',begin:'vShade=shade;',fragment:'varying float vShade;',color:`float grain=dot(diffuseColor.rgb,vec3(.299,.587,.114));diffuseColor.rgb=vec3(.30,.29,.26)*(.45+.70*grain)*vShade;`});
  // The bed runs past every frame edge, like the riverscape's, so no rim or wall is ever seen.
  const ground=new THREE.PlaneGeometry(30,14,180,84);ground.rotateX(-Math.PI/2);ground.translate(0,0,1.0);const p=ground.attributes.position,shade=new Float32Array(p.count);
  // Sand darkens where it meets the rock: a baked contact shadow from each rock footprint,
  // so the hardscape sits in the bed instead of floating on a lit sheet.
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);p.setY(i,groundHeight(x,z)+.014*Math.sin(x*7.8+z*2.3));
    let contact=0;for(const r of ROCKS){const d=Math.max(0,Math.hypot((x-r[0])/r[3],(z-r[2])/r[5])-1)*Math.min(r[3],r[5]);contact=Math.max(contact,Math.exp(-d*d/(.55*r[4])));}
    shade[i]=1-.62*contact;}
  ground.setAttribute('shade',new THREE.BufferAttribute(shade,1));ground.computeVertexNormals();const sand=new THREE.Mesh(ground,sandMat);sand.receiveShadow=true;scene.add(sand);
  // Tri-planar photogrammetry detail over actual porous limestone geometry. The
  // color stream includes coralline patches and precomputed crevice occlusion.
  const rockMat=underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93,map:rockMap}),{key:'live-rock',vertex:'varying vec3 vRockNormal;',normal:'vRockNormal=normal;',fragment:'varying vec3 vRockNormal;uniform sampler2D reefPores;uniform sampler2D reefPoreDetail;',map:`
    vec3 w=pow(abs(normalize(vRockNormal)),vec3(4.));w/=max(.001,w.x+w.y+w.z);
    vec3 p=vReefWorld*1.25;
    vec3 detail=texture2D(map,p.yz).rgb*w.x+texture2D(map,p.xz).rgb*w.y+texture2D(map,p.xy).rgb*w.z;
    float lum=dot(detail,vec3(.299,.587,.114));
    float pores=texture2D(reefPoreDetail,p.yz*2.).r*w.x+texture2D(reefPoreDetail,p.xz*2.).r*w.y+texture2D(reefPoreDetail,p.xy*2.).r*w.z;
    diffuseColor.rgb*=(.27+lum*1.65)*(.48+pores*.86);`,
    surfaceNormal:`vec3 rn=normalize(vRockNormal);vec3 rw=pow(abs(rn),vec3(4.));rw/=max(.001,rw.x+rw.y+rw.z);
      vec3 rp=vReefWorld*2.5;
      vec3 nx=texture2D(reefPores,rp.yz).xyz*2.-1.;vec3 ny=texture2D(reefPores,rp.xz).xyz*2.-1.;vec3 nz=texture2D(reefPores,rp.xy).xyz*2.-1.;
      vec3 perturb=vec3(0.,nx.x,nx.y)*rw.x+vec3(ny.x,0.,ny.y)*rw.y+vec3(nz.x,nz.y,0.)*rw.z;
      normal=normalize(mat3(viewMatrix)*normalize(rn+perturb*.9));`});
  const rockCompile=rockMat.onBeforeCompile;rockMat.onBeforeCompile=shader=>{rockCompile(shader);shader.uniforms.reefPores={value:poreNormal};shader.uniforms.reefPoreDetail={value:poreDetail};};
  // Keep extra shader textures visible to the common disposal path.
  rockMat.userData.extraTextures=[poreNormal,poreDetail];
  const rocks=new THREE.Mesh(rockGeo,rockMat);rocks.castShadow=rocks.receiveShadow=true;scene.add(rocks);
  const rubble=[];
  for(let i=0;i<220;i++){
    const x=(rng()-.5)*22,z=-2.8+rng()*8;
    if(Math.abs(x)<1.2&&rng()>.32)continue;
    const s=.025+Math.pow(rng(),3)*.16,g=ellipsoid([x,groundHeight(x,z)+s*.14,z],[s,s*.53,s*.76],i+91,8);
    tint(g,()=>new THREE.Color('#c3b8a6').multiplyScalar(.55+rng()*.30));rubble.push(g);
  }
  const rubbleMesh=new THREE.Mesh(merge(rubble),underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}),{key:'rubble'}));rubbleMesh.receiveShadow=true;scene.add(rubbleMesh);
  return {obstacles:ROCKS,host:HOST,stations:STATIONS};
}
/** The tank's back wall, seen from inside the water: deep blue at the sand, brightening
 *  toward the lamps. Nothing of the enclosure itself (glass, rim, pumps) is modelled. */
export function createBackdrop(scene){
  const backMat=new THREE.ShaderMaterial({uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),fog:true,
    vertexShader:`varying vec3 p;
      #include <fog_pars_vertex>
      void main(){p=position;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader:`varying vec3 p;
      #include <fog_pars_fragment>
      void main(){
        float top=smoothstep(-1.,9.5,p.y);
        float wash=.55+.45*(exp(-pow((p.x+3.6)/6.,2.))+exp(-pow((p.x-4.4)/5.5,2.)));
        vec3 col=mix(vec3(.004,.014,.034),vec3(.022,.066,.150)*wash,top);
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`});
  const backGeo=new THREE.PlaneGeometry(44,24);backGeo.translate(0,7,TANK.back-.05);
  scene.add(new THREE.Mesh(backGeo,backMat));
}

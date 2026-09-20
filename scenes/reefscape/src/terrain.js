import * as THREE from 'three';
import { merge, ellipsoid, tint } from './geometry.js';
import { randomGenerator, groundHeight } from './math.js';
import { underwater, causticGLSL, extinctionGLSL, waterTime } from './water.js';
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
  for(const t of [sandMap,sandNormal,rockMap,rockNormal,poreNormal,poreDetail]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;}
  sandMap.colorSpace=rockMap.colorSpace=THREE.SRGBColorSpace;
  sandMap.repeat.set(36,17);sandNormal.repeat.copy(sandMap.repeat);
  // Aragonite is a bright bed under a reef lamp — near white, faintly warm — bright enough
  // to throw a real bounce back into the rock. Two samples of the one photograph carry it:
  // an 80 mm tile for actual grain, and the same image stretched to 4 m for the drifts and
  // hollows a bed settles into. One tiling alone reads either as cracked mud up close or as
  // a flat sheet at the wide view.
  const sandMat=underwater(new THREE.MeshStandardMaterial({color:'#eee9d9',roughness:.84,map:sandMap,normalMap:sandNormal,normalScale:new THREE.Vector2(1.9,1.9)}),{key:'tank-sand',vertex:'attribute float shade;varying float vShade;',begin:'vShade=shade;',fragment:'varying float vShade;',
    map:`vec3 reefGrain=texture2D(map,vMapUv).rgb;vec3 reefDrift=texture2D(map,vMapUv*.11+vec2(.37,.11)).rgb;`,
    color:`float grain=dot(reefGrain,vec3(.299,.587,.114)),drift=dot(reefDrift,vec3(.299,.587,.114));
      diffuseColor.rgb=vec3(.880,.845,.758)*(.27+1.02*grain)*(.78+.52*drift)*vShade;`});
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
  const rockMat=underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.86,map:rockMap}),{key:'live-rock',vertex:'varying vec3 vRockNormal;',normal:'vRockNormal=normal;',fragment:'varying vec3 vRockNormal;uniform sampler2D reefPores;uniform sampler2D reefPoreDetail;',map:`
    vec3 w=pow(abs(normalize(vRockNormal)),vec3(4.));w/=max(.001,w.x+w.y+w.z);
    vec3 p=vReefWorld*3.2,q=vReefWorld*.62;
    vec3 detail=texture2D(map,p.yz).rgb*w.x+texture2D(map,p.xz).rgb*w.y+texture2D(map,p.xy).rgb*w.z;
    float lum=dot(detail,vec3(.299,.587,.114));
    // The pore height field is sampled at the scale the relief is shaded at, so the dark
    // values land inside actual cavities instead of floating over the surface as a stain.
    float pores=texture2D(reefPoreDetail,q.yz).r*w.x+texture2D(reefPoreDetail,q.xz).r*w.y+texture2D(reefPoreDetail,q.xy).r*w.z;
    float reefGrit=texture2D(reefPoreDetail,p.yz*1.25).r*w.x+texture2D(reefPoreDetail,p.xz*1.25).r*w.y+texture2D(reefPoreDetail,p.xy*1.25).r*w.z;
    diffuseColor.rgb*=(.80+lum*.58)*(.46+pores*1.02);`,
    // A coralline crust breaks at a scale no vertex can carry: where the grit texture is
    // high the crust has worn through and bare limestone shows, so the patches read as a
    // fine speckled mottle instead of the painted blotches a vertex stream alone gives.
    color:`float bare=smoothstep(.38,.80,reefGrit);
      float chalk=dot(diffuseColor.rgb,vec3(.30,.50,.20));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(chalk*1.14,chalk*1.00,chalk*.78),bare*.48);`,
    surfaceNormal:`vec3 rn=normalize(vRockNormal);vec3 rw=pow(abs(rn),vec3(4.));rw/=max(.001,rw.x+rw.y+rw.z);
      vec3 rp=vReefWorld*.62,rq=vReefWorld*4.0;
      vec3 nx=texture2D(reefPores,rp.yz).xyz*2.-1.;vec3 ny=texture2D(reefPores,rp.xz).xyz*2.-1.;vec3 nz=texture2D(reefPores,rp.xy).xyz*2.-1.;
      vec3 perturb=vec3(0.,nx.x,nx.y)*rw.x+vec3(ny.x,0.,ny.y)*rw.y+vec3(nz.x,nz.y,0.)*rw.z;
      // The first octave lays the atlas over 1.6 units, so its pits land at the 1-3 cm the
      // eye resolves; this second one is the millimetre grain between them, for close views.
      vec3 fx=texture2D(reefPores,rq.yz).xyz*2.-1.;vec3 fy=texture2D(reefPores,rq.xz).xyz*2.-1.;vec3 fz=texture2D(reefPores,rq.xy).xyz*2.-1.;
      perturb+=(vec3(0.,fx.x,fx.y)*rw.x+vec3(fy.x,0.,fy.y)*rw.y+vec3(fz.x,fz.y,0.)*rw.z)*.80;
      normal=normalize(mat3(viewMatrix)*normalize(rn+perturb*.9));
      // Wet limestone is not uniformly matt: the raised crust holds a film of water and
      // catches the lamp, the open pores stay dull. Without this the rock has no highlight
      // anywhere and the whole frame sits in a midtone band.
      roughnessFactor*=.62+.52*reefGrit;`});
  const rockCompile=rockMat.onBeforeCompile;rockMat.onBeforeCompile=shader=>{rockCompile(shader);shader.uniforms.reefPores={value:poreNormal};shader.uniforms.reefPoreDetail={value:poreDetail};};
  // Keep extra shader textures visible to the common disposal path.
  rockMat.userData.extraTextures=[poreNormal,poreDetail];
  const rocks=new THREE.Mesh(rockGeo,rockMat);rocks.castShadow=rocks.receiveShadow=true;scene.add(rocks);
  const rubble=[];
  for(let i=0;i<220;i++){
    const x=(rng()-.5)*22,z=-2.8+rng()*8;
    if(Math.abs(x)<1.2&&rng()>.32)continue;
    const s=.025+Math.pow(rng(),3)*.16,g=ellipsoid([x,groundHeight(x,z)+s*.14,z],[s,s*.53,s*.76],i+91,8);
    tint(g,()=>new THREE.Color('#cdc2ae').multiplyScalar(.72+rng()*.34));rubble.push(g);
  }
  const rubbleMesh=new THREE.Mesh(merge(rubble),underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}),{key:'rubble'}));rubbleMesh.receiveShadow=true;scene.add(rubbleMesh);
  return {obstacles:ROCKS,host:HOST,stations:STATIONS,rockSurface:rocks};
}
/** The tank's back wall, seen from inside the water: deep indigo at the sand, lifting a
 *  little toward the lamps, and seen through the whole depth of the tank, so it takes the
 *  same veil every rear rock does. Nothing of the enclosure itself (glass, rim, pumps) is
 *  modelled. A flat ramp is what makes a tank read as a painted backdrop, so the wall
 *  carries the same ripple the bed does, the bars of the LED array above it, and a slow
 *  large-scale mottle — all of it moving, none of it resolvable as a pattern. */
export function createBackdrop(scene){
  const backMat=new THREE.ShaderMaterial({uniforms:{reefTime:{value:0}},
    vertexShader:`varying vec3 p;
      void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec3 p;uniform float reefTime;
      ${causticGLSL}${extinctionGLSL}
      void main(){
        float top=smoothstep(-3.5,9.5,p.y);
        float wash=.55+.45*(exp(-pow((p.x+3.6)/6.,2.))+exp(-pow((p.x-4.4)/5.5,2.)));
        vec3 col=mix(vec3(.006,.009,.034),vec3(.010,.020,.082)*wash,top);
        col+=vec3(.006,.010,.024)*exp(-pow((p.y+.35)/1.5,2.));
        // The ripple that draws glitter on the bed also plays across the wall, softened by
        // the water it has crossed to get there.
        float ripple=reefIrradiance(vec3(p.x,p.y,-4.1),reefTime).g-.86;
        col+=vec3(.006,.012,.028)*clamp(ripple,-.5,1.1)*smoothstep(-1.,5.,p.y);
        // The LED array reads on the wall as soft vertical bars that drift, not as a ramp.
        float bars=sin(p.x*.62+.5*sin(p.y*.21+reefTime*.045))*sin(p.x*.23-reefTime*.031+1.4);
        col+=vec3(.003,.005,.011)*max(0.,bars)*smoothstep(-.5,7.,p.y);
        // Slow blotching so the gradient is never mathematically smooth.
        col*=.93+.14*sin(p.x*.37+1.9*sin(p.y*.29+reefTime*.021))*sin(p.y*.24-reefTime*.017);
        col*=reefTransmittance(reefWaterPath(p,cameraPosition));
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const backGeo=new THREE.PlaneGeometry(44,24);backGeo.translate(0,7,TANK.back-.05);
  const wall=new THREE.Mesh(backGeo,backMat);
  // The wall is not an `underwater` material, so it carries the shared clock itself.
  wall.onBeforeRender=()=>{backMat.uniforms.reefTime.value=waterTime.value;};
  scene.add(wall);
}

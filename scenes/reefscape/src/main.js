import * as THREE from 'three';
import { createTerrain, createBackdrop } from './terrain.js';
import { createCorals } from './corals.js';
import { createAnemone, TENTACLE_COUNT } from './anemone.js';
import { createFishSchool } from './fish-model.js';
import { createShrimp } from './shrimp.js';
import { createParticles } from './particles.js';
import { ReefSimulation, FIXED_STEP } from './simulation.js';
import { waterTime } from './water.js';

const canvas=document.querySelector('#scene'),habitat=document.querySelector('#habitat'),loading=document.querySelector('#loading');
const params=new URLSearchParams(location.search),isHost=document.documentElement.dataset.motion==='host';
const capture=params.has('capture');
if(capture)document.body.classList.add('clean');
const presets={eco:{fps:24,pixels:1050000,dpr:1},balanced:{fps:30,pixels:1800000,dpr:1.25},detail:{fps:45,pixels:3000000,dpr:1.5}};
const saved=(()=>{try{return localStorage.getItem('reefscape-quality');}catch{return null;}})();
let quality=params.get('quality')||saved||((navigator.connection?.saveData)?'eco':'balanced');
if(!presets[quality])quality='balanced';
let hostRate=60,onBattery=false,contextLost=false,disposed=false;
let paused=capture||(!isHost&&matchMedia('(prefers-reduced-motion: reduce)').matches);
let changeRate=()=>{},changePower=()=>{},feed=()=>{};
// Installed before WebGL startup so host rate 0 cannot be lost during initialization.
window.habitatRate=fps=>{if(!Number.isFinite(fps))return;const next=Math.max(0,Math.min(60,fps));if(next===hostRate)return;hostRate=next;changeRate();};
window.habitatFeed=()=>feed();
window.habitatPause=value=>{paused=Boolean(value);changeRate();};
// The Mac host knows the power source; a browser only sometimes does (see getBattery below).
window.habitatPower=battery=>{const next=Boolean(battery);if(next===onBattery)return;onBattery=next;changePower();};

function reportError(error){console.error(error);loading.hidden=true;const box=document.querySelector('#error');box.hidden=false;box.textContent=`The saltwater tank could not start. ${error.message||error}. Please use a browser with WebGL2 and hardware acceleration enabled. Riverscape remains available from the environment menu.`;}

async function start(){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'low-power',preserveDrawingBuffer:false});
  renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.info.autoReset=false;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#04101d');
  // Display water is clear, but a faint blue veil still builds along the viewing ray, so the
  // back wall and rear corals sit behind the foreground instead of on the same plane.
  scene.fog=new THREE.FogExp2('#102b47',.027);
  const camera=new THREE.PerspectiveCamera(36,16/9,.08,140);
  const views={
    wide:{position:[0,4.3,18.2],target:[0,3.35,0],fov:25.8},
    anemone:{position:[-1.5,4.7,10.5],target:[-3.7,3.40,1.1],fov:34},
    shrimp:{position:[4.5,2.1,7.6],target:[2.45,.75,2.2],fov:30},
    fish:{position:[-1.0,5.2,8.6],target:[-1.6,5.2,-.4],fov:19},
  };
  let view=params.get('view')||'wide';if(!views[view])view='wide';
  function applyView(name){const v=views[name];view=name;camera.position.set(...v.position);camera.lookAt(...v.target);camera.fov=v.fov;camera.updateProjectionMatrix();}
  applyView(view);
  // The beauty pass lands in an HDR target; a short screen-space pass adds contact occlusion
  // where rock meets sand and coral meets rock, then a light vignette, before tone mapping.
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  const postScene=new THREE.Scene(),postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1),AO_SAMPLES=10;
  const post=new THREE.ShaderMaterial({uniforms:{beauty:{value:target.texture},depth:{value:target.depthTexture},size:{value:new THREE.Vector2()},nearFar:{value:new THREE.Vector2(camera.near,camera.far)},aoRadiusScale:{value:1}},depthTest:false,depthWrite:false,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`uniform sampler2D beauty;uniform sampler2D depth;uniform vec2 size;uniform vec2 nearFar;uniform float aoRadiusScale;varying vec2 vUv;
      float distanceAt(vec2 p){float z=texture2D(depth,p).x;return nearFar.x*nearFar.y/(nearFar.y-z*(nearFar.y-nearFar.x));}
      void main(){
        vec3 color=texture2D(beauty,vUv).rgb;float center=distanceAt(vUv);float occlusion=0.;
        for(int i=0;i<${AO_SAMPLES};i++){
          float a=float(i)*2.399963;float radius=2.5+float(i)*${(14.85/(AO_SAMPLES-1)).toFixed(8)};
          float difference=center-distanceAt(vUv+vec2(cos(a),sin(a))*radius*aoRadiusScale/size);
          occlusion+=smoothstep(.012,.13,difference)*(1.-smoothstep(.2,.8,difference));
        }
        color*=1.-occlusion*${(.042*12/AO_SAMPLES).toFixed(8)};
        float vignette=dot((vUv-.5)*vec2(1.,.85),(vUv-.5)*vec2(1.,.85));color*=1.-vignette*.16;
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),post));
  // Reef LEDs: a cool white key with a violet actinic wash from above. Warm tones come only
  // from the animals and coral tissue themselves. The ground half of the hemisphere stands
  // in for the bounce off the bright aragonite bed, so the shaded side of a coral branch
  // reads as tissue in shadow rather than a black stick.
  scene.add(new THREE.HemisphereLight('#8ca6de','#564f3c',.60));
  const sun=new THREE.DirectionalLight('#f6f0e0',3.35);sun.position.set(-3.5,13,4.5);sun.target.position.set(0,0,0);sun.castShadow=true;
  sun.shadow.mapSize.set(1536,1536);Object.assign(sun.shadow.camera,{left:-12,right:12,top:10,bottom:-9,near:1,far:43});sun.shadow.bias=-.0007;sun.shadow.normalBias=.018;sun.shadow.radius=2;sun.shadow.intensity=.80;
  scene.add(sun,sun.target);
  const actinic=new THREE.DirectionalLight('#4f7dff',.72);actinic.position.set(3,12,-2);scene.add(actinic);
  const bounce=new THREE.DirectionalLight('#8fa4d8',.28);bounce.position.set(3,6,8);scene.add(bounce);
  const envData=new Uint8Array(128*64*4);
  for(let y=0;y<64;y++)for(let x=0;x<128;x++){
    const top=1-y/63,glow=Math.exp(-(((top-.86)/.13)**2));const i=(y*128+x)*4;
    envData[i]=6+glow*185;envData[i+1]=12+glow*210;envData[i+2]=26+glow*229;envData[i+3]=255;
  }
  const environment=new THREE.DataTexture(envData,128,64);environment.mapping=THREE.EquirectangularReflectionMapping;environment.colorSpace=THREE.SRGBColorSpace;environment.needsUpdate=true;scene.environment=environment;scene.environmentIntensity=.38;
  createBackdrop(scene);await createTerrain(scene);await createCorals(scene);const anemone=createAnemone(scene);
  const simulation=new ReefSimulation();
  const fishSchool=createFishSchool(scene,simulation);
  const shrimp=createShrimp(scene,simulation),particles=createParticles(scene,simulation);
  function sync(dt){
    waterTime.value=simulation.time;
    fishSchool.update();
    shrimp.update();particles.update(dt);
  }
  // A clock-driven scheduler, not an always-spinning RAF. Paused / hidden / host zero:
  // both timer and RAF are cancelled, simulation and GPU work really stop.
  let timer=0,raf=0,last=performance.now(),deadline=last,accumulator=0,frames=0;
  let cpuEMA=0,slowSamples=0,autoScale=1,ratio=1;
  const running=()=>!disposed&&!paused&&!document.hidden&&!contextLost&&hostRate>0;
  const fps=()=>Math.min(presets[quality].fps,hostRate,onBattery?24:60);
  const cancel=()=>{clearTimeout(timer);cancelAnimationFrame(raf);timer=raf=0;};
  function schedule(){
    if(!running())return;
    timer=setTimeout(()=>{timer=0;raf=requestAnimationFrame(frame);},Math.max(0,deadline-performance.now()-1));
  }
  function render(){
    if(contextLost||disposed||document.hidden)return;
    renderer.info.reset();renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.setRenderTarget(null);renderer.render(postScene,postCamera);frames++;
    if(!loading.hidden)loading.hidden=true;
  }
  function frame(now){
    raf=0;if(!running())return;
    if(now+.5<deadline){schedule();return;}
    const before=performance.now(),elapsed=Math.min(.10,Math.max(0,(now-last)/1000));last=now;
    accumulator+=elapsed;let steps=0;
    while(accumulator>=FIXED_STEP&&steps<6){simulation.step(FIXED_STEP,pointer);accumulator-=FIXED_STEP;steps++;}
    if(steps===6)accumulator=0;
    if(pointer){pointer.speed*=Math.exp(-elapsed*8);}
    sync(steps*FIXED_STEP);render();
    const cost=performance.now()-before;cpuEMA=cpuEMA?cpuEMA*.96+cost*.04:cost;
    // Conservative one-way downshift, never an oscillating up/down resolution loop.
    // CPU render time is only a pressure signal, not a claimed hardware GPU measurement.
    if(cpuEMA>1000/fps()*.85||elapsed>1.65/fps())slowSamples++;else slowSamples=Math.max(0,slowSamples-1);
    if(slowSamples>80&&autoScale>.72&&!capture){autoScale=Math.max(.72,autoScale-.10);slowSamples=0;resize(false);}
    const period=1000/fps();deadline+=period;if(deadline<performance.now())deadline=performance.now()+period;
    schedule();
  }
  function updateControls(){
    const b=document.querySelector('#pause');if(b){b.textContent=paused?'Resume':'Pause';b.setAttribute('aria-pressed',String(paused));}
    const feedButton=document.querySelector('#feed');if(feedButton)feedButton.disabled=!running();
  }
  function restart(){cancel();last=performance.now();deadline=last+1000/Math.max(1,fps());accumulator=0;updateControls();schedule();}
  changeRate=restart;
  changePower=()=>{resize();restart();};
  function resize(draw=true){
    const width=Math.max(1,habitat.clientWidth),height=Math.max(1,habitat.clientHeight),preset=presets[quality];
    anemone.tentacles.count=quality==='eco'?250:quality==='detail'?TENTACLE_COUNT:310;
    ratio=Math.min(devicePixelRatio||1,preset.dpr,Math.sqrt(preset.pixels/(width*height)))*autoScale*(onBattery?.90:1);
    const w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));renderer.setSize(w,h,false);target.setSize(w,h);post.uniforms.size.value.set(w,h);post.uniforms.aoRadiusScale.value=h/972;
    camera.aspect=width/height;
    if(view==='wide'){
      const focus=-3.1*Math.min(1,Math.max(0,(1.3-camera.aspect)/.65));
      camera.position.set(views.wide.position[0]+focus,views.wide.position[1],views.wide.position[2]);
      camera.lookAt(views.wide.target[0]+focus,views.wide.target[1],views.wide.target[2]);
    }
    // Keep the central host in portrait; wide screens get the two tank islands.
    camera.fov=views[view].fov+(view==='wide'&&camera.aspect<1.3?Math.min(15,(1.3-camera.aspect)*22):0);
    camera.updateProjectionMatrix();particles.setPixelRatio(ratio);
    if(draw&&!document.hidden)render();
  }
  const observer=new ResizeObserver(()=>resize());observer.observe(habitat);
  resize(false);

  let pointer=null,lastPointer=0;const point=new THREE.Vector3(),lastPoint=new THREE.Vector3(),ndc=new THREE.Vector2(),raycaster=new THREE.Raycaster();
  const plane=new THREE.Plane(new THREE.Vector3(0,0,1),-2.4);
  function project(event){const bounds=canvas.getBoundingClientRect();ndc.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1);raycaster.setFromCamera(ndc,camera);return raycaster.ray.intersectPlane(plane,point);}
  canvas.addEventListener('pointermove',event=>{
    if(!running()||!project(event))return;const now=performance.now();
    const speed=pointer?point.distanceTo(lastPoint)/Math.max(.016,(now-lastPointer)/1000):0;
    if(!pointer)pointer={position:new THREE.Vector3(),speed:0};
    pointer.position.copy(point);pointer.speed=Math.min(15,speed);lastPoint.copy(point);lastPointer=now;
  },{passive:true});
  canvas.addEventListener('pointerleave',()=>{pointer=null;});
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!running()||!project(event))return;simulation.feed(point.x,1);});
  feed=()=>{if(running())simulation.feed(-2.6+Math.sin(simulation.time*.73)*1.7,1.3);};
  document.querySelector('#feed')?.addEventListener('click',feed);
  function toggle(){paused=!paused;restart();}
  document.querySelector('#pause')?.addEventListener('click',toggle);
  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await habitat.requestFullscreen();}catch(error){console.warn(error.message);}}
  document.querySelector('#fullscreen')?.addEventListener('click',fullscreen);
  document.querySelector('#hide')?.addEventListener('click',()=>document.body.classList.toggle('clean'));
  const select=document.querySelector('#quality');if(select){select.value=quality;select.addEventListener('change',()=>{quality=select.value;autoScale=1;try{localStorage.setItem('reefscape-quality',quality);}catch{}resize();restart();});}
  document.addEventListener('keydown',event=>{
    if(event.repeat||['SELECT','INPUT','TEXTAREA','BUTTON'].includes(event.target.tagName))return;
    if(event.code==='Space'){event.preventDefault();toggle();}else if(event.key.toLowerCase()==='f')fullscreen();else if(event.key.toLowerCase()==='h')document.body.classList.toggle('clean');
  });
  document.addEventListener('visibilitychange',()=>{pointer=null;if(!document.hidden){resize(false);if(paused)render();}restart();});
  const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');motionQuery.addEventListener('change',event=>{if(!isHost&&event.matches){paused=true;restart();}});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;restart();loading.hidden=false;loading.querySelector('p').textContent='The reef is resting';});
  canvas.addEventListener('webglcontextrestored',()=>{contextLost=false;renderer.shadowMap.needsUpdate=true;resize(false);render();restart();});
  if(navigator.getBattery&&!isHost){navigator.getBattery().then(battery=>{function update(){onBattery=!battery.charging;resize();restart();}battery.addEventListener('chargingchange',update);update();}).catch(()=>{});}

  // Capture mode advances the actual simulation, then renders the actual WebGL scene.
  // No image composites or alternative high-cost renderer for screenshots.
  if(capture){const time=Math.min(120,Math.max(0,Number(params.get('time'))||0));for(let i=0;i<Math.round(time/FIXED_STEP);i++)simulation.step(FIXED_STEP);}
  sync(0);render();
  // Static skeleton + limestone shadow map only. Moving organisms do not cast stale
  // animated shadows: no false frozen fish silhouettes, no per-frame shadow pass.
  renderer.shadowMap.autoUpdate=false;
  restart();
  window.reef={
    ready:true,diagnostics:()=>({...simulation.diagnostics(),frames,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,
      pixels:[canvas.width,canvas.height],quality,effectiveFPS:running()?fps():0,renderScale:ratio,cpuFrameEMA:cpuEMA,scheduled:Boolean(timer||raf),paused,hostRate,hidden:document.hidden,contextLost,tentacles:anemone.tentacles.count,webgl:renderer.capabilities.isWebGL2?'WebGL2':'WebGL2',renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER)}),
    setView(name){if(!views[name])throw new RangeError('Unknown reef camera');applyView(name);resize();},
    pause(value=true){paused=Boolean(value);restart();},
    advance(seconds){if(!paused)throw new Error('Pause before advancing deterministic capture time.');if(!Number.isFinite(seconds)||seconds<0||seconds>120)throw new RangeError('Advance must be 0–120 seconds.');for(let i=0;i<Math.round(seconds/FIXED_STEP);i++)simulation.step(FIXED_STEP);sync(seconds);render();},
    feed:()=>feed(),
  };
  // Release owned GPU objects and stop callbacks when a page is really discarded.
  // BFCache pages retain resources and restart from their old simulation time.
  addEventListener('pagehide',event=>{
    cancel();if(event.persisted)return;disposed=true;observer.disconnect();
    const geometries=new Set(),materials=new Set(),textures=new Set();scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materials.add(m));});
    for(const m of materials){for(const value of Object.values(m))if(value?.isTexture)textures.add(value);for(const tex of m.userData?.extraTextures||[])textures.add(tex);m.dispose();}
    geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());sun.shadow.map?.dispose();environment.dispose();target.dispose();post.dispose();renderer.dispose();
  });
  addEventListener('pageshow',event=>{if(event.persisted){resize(false);render();restart();}});
}
start().catch(reportError);

import { groundHeight, smoothstep } from './math.js';
import { TANK } from './layout.js';

export const waterTime={value:0};
export const SURFACE=TANK.surface;
// Surface ripples, at the actual aquarium depth (10 cm/unit), not ocean swell.
// omega² = g k tanh(kh). Pump circulation below is a separate forced flow.
const g=98.1,h=SURFACE;
export const WAVES=[
  {a:.009,k:2.1,angle:.18,phase:.3},
  {a:.007,k:2.85,angle:1.37,phase:1.7},
  {a:.005,k:4.05,angle:-.42,phase:.8},
].map(w=>({...w,dx:Math.cos(w.angle),dz:Math.sin(w.angle),omega:Math.sqrt(g*w.k*Math.tanh(w.k*h))}));
const n=x=>Number(x).toFixed(7);
// Two opposed circulation pumps. Slow alternating strength and a recirculating
// return path approximate wavemaker flow; no claim of solving Navier–Stokes.
const PULSES=[{amp:.25,omega:.88,phase:.2},{amp:.115,omega:.49,phase:1.8}];
function base(p,out){
  const y=Math.max(0,Math.min(h,p.y));
  const wall=Math.max(0,1-(p.x/9.65)**8),bed=.12+.88*smoothstep(0,.9,p.y-groundHeight(p.x,p.z));
  const horizontal=(.64+.36*Math.sin(Math.PI*y/h))*wall*bed;
  out.set(horizontal,.045*Math.sin(p.x*.30)*Math.sin(Math.PI*y/h),.12*Math.sin(p.x*.23+p.z*.37)*horizontal);
  return out;
}
export function currentAt(p,t,out){
  base(p,out);let drive=.10;
  for(const q of PULSES)drive+=q.amp*Math.cos(q.omega*t+q.phase);
  return out.multiplyScalar(drive);
}
export function responseAt(p,t,tau,out){
  base(p,out);let drive=.10;
  for(const q of PULSES)drive+=q.amp*Math.cos(q.omega*t+q.phase-Math.atan(q.omega*tau))/Math.sqrt(1+(q.omega*tau)**2);
  return out.multiplyScalar(drive);
}
// Same coefficients and analytic tau db/dt + b = u response as the CPU.
export const responseGLSL=`
float reefBed(vec2 p){return -.30+.12*sin(p.x*.49+p.y*.22)+.075*sin(p.y*.75-p.x*.25)+.25*exp(-((p.x-6.)*(p.x-6.)/17.+(p.y+1.)*(p.y+1.)/13.));}
vec2 reefResponse(vec3 p,float t,float tau){
  float y=clamp(p.y,0.,${n(h)});
  float boundary=(.12+.88*smoothstep(0.,.9,p.y-reefBed(p.xz)))*max(0.,1.-pow(p.x/9.65,8.));
  float profile=(.64+.36*sin(3.14159265*y/${n(h)}))*boundary;
  float drive=.10;
  ${PULSES.map(q=>`drive+=${n(q.amp)}*cos(${n(q.omega)}*t+${n(q.phase)}-atan(${n(q.omega)}*tau))/sqrt(1.+pow(${n(q.omega)}*tau,2.));`).join('\n')}
  return vec2(profile,.12*sin(p.x*.23+p.z*.37)*profile)*drive;
}`;
export const causticGLSL=`
vec3 reefIrradiance(vec3 p,float t){
  float depth=clamp(${n(h)}-p.y,.02,9.);
  vec2 q=p.xz-depth*vec2(-.12,.025);
  float hxx=0.,hzz=0.,hxz=0.;
  ${WAVES.map(w=>`{float curvature=-${n(w.a*w.k*w.k)}*sin(${n(w.k)}*dot(q,vec2(${n(w.dx)},${n(w.dz)}))-${n(w.omega)}*t+${n(w.phase)});hxx+=curvature*${n(w.dx*w.dx)};hzz+=curvature*${n(w.dz*w.dz)};hxz+=curvature*${n(w.dx*w.dz)};}`).join('\n')}
  // Surface ripples are small, but a point-like LED focuses them into glitter lines on the bed;
  // the factor stands in for that concentration.
  float d=depth*(1.-1./1.333)*5.;
  float determinant=(1.-d*hxx)*(1.-d*hzz)-d*d*hxz*hxz;
  // Glitter lines: the fold where the ray map loses rank is a thin bright band, the rest a
  // mild dimming, as point-like LEDs draw on a tank bed.
  float focus=.86+1.5*pow(clamp(1.-abs(determinant)*1.4,0.,1.),2.5);
  return exp(-vec3(.13,.046,.026)*depth*.1)*focus;
}`;

/** PBR lighting with short in-water paths. Camera air path is deliberately excluded.
 *  Geometry is kept in the bounded tank; neither fog nor sun rays hide bad modelling.
 */
export function underwater(material,{vertex='',begin='',normal='',fragment='',color='',map='',surfaceNormal='',key='reef',transmission=0}={}){
  material.onBeforeCompile=shader=>{
    shader.uniforms.reefTime=waterTime;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nuniform float reefTime;varying vec3 vReefWorld;${vertex}`)
      .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>\n${normal}`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>\n${begin}`)
      .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>\nvec4 reefPosition=vec4(transformed,1.);
      #ifdef USE_INSTANCING
      reefPosition=instanceMatrix*reefPosition;
      #endif
      vReefWorld=(modelMatrix*reefPosition).xyz;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform float reefTime;varying vec3 vReefWorld;vec3 reefLight=vec3(1.);${causticGLSL}${fragment}`)
      .replace('#include <map_fragment>',map||'#include <map_fragment>')
      .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+surfaceNormal)
      .replace('#include <color_fragment>',`#include <color_fragment>\n${color}`)
      .replace('#include <lights_physical_pars_fragment>',`#include <lights_physical_pars_fragment>
      #undef RE_Direct
      void RE_Direct_Reef(const in IncidentLight directLight,const in vec3 geometryPosition,const in vec3 geometryNormal,const in vec3 geometryViewDir,const in vec3 geometryClearcoatNormal,const in PhysicalMaterial material,inout ReflectedLight reflectedLight){
        IncidentLight light=directLight;light.color*=reefLight;
        RE_Direct_Physical(light,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,material,reflectedLight);
        ${transmission?`float wrap=pow(clamp(dot(-geometryNormal,light.direction)*.5+.5,0.,1.),2.);reflectedLight.directDiffuse+=light.color*material.diffuseColor*wrap*${n(transmission)};`:''}
      }
      #define RE_Direct RE_Direct_Reef`)
      .replace('#include <lights_fragment_begin>','reefLight=reefIrradiance(vReefWorld,reefTime);\n#include <lights_fragment_begin>')
      .replace('#include <opaque_fragment>',`vec3 cameraRay=normalize(cameraPosition-vReefWorld);float inWater=clamp((6.1-vReefWorld.z)/max(.3,cameraRay.z),0.,14.)*.1;
        vec3 transmittance=exp(-vec3(.13,.046,.026)*inWater);
        outgoingLight=outgoingLight*transmittance+vec3(.003,.006,.012)*(1.-transmittance);
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>key;return material;
}

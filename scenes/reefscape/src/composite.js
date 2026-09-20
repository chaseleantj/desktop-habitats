import * as THREE from 'three';
import { extinctionGLSL } from './water.js';
import { createPostprocessing } from '../../shared/postprocessing.js';

const AO_SAMPLES=10,VOLUME_SAMPLES=4;
export function createComposite(camera) {
  return createPostprocessing(camera, { uniforms: {eye:{value:new THREE.Vector3()},rayX:{value:new THREE.Vector3()},rayY:{value:new THREE.Vector3()},rayZ:{value:new THREE.Vector3()}},
    fragmentShader: `uniform sampler2D beauty;uniform sampler2D depth;uniform vec2 size;uniform vec2 nearFar;uniform float aoRadiusScale;
      uniform vec3 eye;uniform vec3 rayX;uniform vec3 rayY;uniform vec3 rayZ;varying vec2 vUv;
      ${extinctionGLSL}
      float distanceAt(vec2 p){float z=texture2D(depth,p).x;return nearFar.x*nearFar.y/(nearFar.y-z*(nearFar.y-nearFar.x));}
      void main(){
        vec3 color=texture2D(beauty,vUv).rgb;float center=distanceAt(vUv);float occlusion=0.;
        for(int i=0;i<${AO_SAMPLES};i++){
          float a=float(i)*2.399963;float radius=2.5+float(i)*${(14.85/(AO_SAMPLES-1)).toFixed(8)};
          float difference=center-distanceAt(vUv+vec2(cos(a),sin(a))*radius*aoRadiusScale/size);
          occlusion+=smoothstep(.012,.13,difference)*(1.-smoothstep(.2,.8,difference));
        }
        color*=1.-occlusion*${(.042*12/AO_SAMPLES).toFixed(8)};
        // Light through water is a volume, not a backdrop: march the camera ray from the
        // front glass to the first surface and sum what the water scatters back along it,
        // each sample thinned by the water between it and the glass. The march stops at
        // the depth buffer, so a near rock carries less of the glow than the open water
        // beside it: the water gains a front and a back instead of sitting on one plane.
        // The integrand is smooth along the ray, so a plain midpoint sum is free of bands
        // and needs no dither.
        vec3 forward=normalize(rayZ);
        vec3 ray=normalize(rayZ+rayX*(vUv.x*2.-1.)+rayY*(vUv.y*2.-1.));
        float air=reefAirPath(eye,ray);
        float span=clamp(center/max(.05,dot(ray,forward))-air,0.,34.);
        vec3 glow=vec3(0.);
        for(int i=0;i<${VOLUME_SAMPLES};i++){
          float s=span*(float(i)+.5)/${VOLUME_SAMPLES}.;vec3 p=eye+ray*(air+s);
          // Skylight in the column, brighter toward the lamps.
          float column=.08+.92*smoothstep(-2.5,9.,p.y);
          glow+=vec3(.0016,.0020,.0078)*column*reefTransmittance(s);
        }
        color+=glow*span/${VOLUME_SAMPLES}.;
        float vignette=dot((vUv-.5)*vec2(1.,.85),(vUv-.5)*vec2(1.,.85));color*=1.-vignette*.16;
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
}

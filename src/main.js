import * as THREE from "three";
import { createEnvironment, createParticles } from "./environment.js";
import { createPlants } from "./plants.js";
import { createFishSchool } from "./fish.js";
import { waterTime } from "./water.js";

const canvas = document.querySelector("#scene");
const aquarium = document.querySelector("#aquarium");
const loading = document.querySelector("#loading");
let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
const resolution = 1.5;

function fail(error) {
  console.error(error);
  loading.hidden = true;
}

async function start() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.17;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#050f0c");
  // A faint green-blue veil builds along the viewing ray, leaving the foreground clear
  // while the back planting loses a little contrast through the water.
  scene.fog = new THREE.FogExp2("#16312a", 0.034);
  const camera = new THREE.PerspectiveCamera(25.8, 1420 / 740, 0.2, 65);
  camera.position.set(0, 4.65, 20.5);
  camera.lookAt(0, 4.15, 0);

  // Overhead lamp with a soft skylight-like fill; the back light passes through the
  // thin leaves and reads as their translucency.
  scene.add(new THREE.HemisphereLight(0xc3d7bd, 0x353427, 0.3));
  const key = new THREE.DirectionalLight(0xfff8ee, 4.5);
  key.position.set(-3, 11.5, 4.4);
  key.target.position.set(0, 1, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  // The frustum reaches the foot of the backboard behind the right-hand bed; a fragment
  // outside the shadow map is lit as if nothing stood in front of it.
  Object.assign(key.shadow.camera, {
    left: -12,
    right: 12,
    top: 14,
    bottom: -10,
    near: 1,
    far: 27,
  });
  key.shadow.bias = -0.00012;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc2d8e4, 0.44);
  fill.position.set(1, 5, 10);
  scene.add(fill);
  const back = new THREE.DirectionalLight(0xdbf9ba, 0.8);
  back.position.set(2, 10, -4);
  scene.add(back);

  // A compact HDR environment gives silver scales a broad overhead reflection.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color("#253129");
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 4),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.7, 3.8, 3.4),
      side: THREE.DoubleSide,
    }),
  );
  strip.position.set(0, 6, 1);
  strip.rotation.x = Math.PI / 2;
  envScene.add(strip);
  const frontBounce = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 8),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.24, 0.32, 0.29),
      side: THREE.DoubleSide,
    }),
  );
  frontBounce.position.z = 8;
  envScene.add(frontBounce);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.025, 0.1, 30);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  strip.geometry.dispose();
  strip.material.dispose();
  frontBounce.geometry.dispose();
  frontBounce.material.dispose();

  // The tank's dark backboard: it catches a little of the lamp and the planting's shadows,
  // so gaps between blades read as lit water in front of a wall rather than a void.
  const backboard = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 24),
    new THREE.MeshStandardMaterial({ color: 0x1d3a2c, roughness: 1 }),
  );
  backboard.position.set(0, 7, -7.2);
  backboard.receiveShadow = true;
  scene.add(backboard);
  const { obstacles, landmarks } = await createEnvironment(scene);
  const plants = createPlants(scene);
  const fish = createFishSchool(scene, {
    obstacles,
    landmarks,
    thickets: plants.thickets,
  });
  const particles = createParticles(scene, { thickets: plants.thickets });

  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const postScene = new THREE.Scene(),
    postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const post = new THREE.ShaderMaterial({
    uniforms: {
      beauty: { value: target.texture },
      depth: { value: target.depthTexture },
      size: { value: new THREE.Vector2() },
      nearFar: { value: new THREE.Vector2(camera.near, camera.far) },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `
      uniform sampler2D beauty;uniform sampler2D depth;uniform vec2 size;uniform vec2 nearFar;varying vec2 vUv;
      float distanceAt(vec2 p){float z=texture2D(depth,p).x;return nearFar.x*nearFar.y/(nearFar.y-z*(nearFar.y-nearFar.x));}
      void main(){
        vec3 color=texture2D(beauty,vUv).rgb;float center=distanceAt(vUv);float occlusion=0.;
        for(int i=0;i<12;i++) {
          float a=float(i)*2.399963;float radius=2.5+float(i)*1.35;
          float sampleDepth=distanceAt(vUv+vec2(cos(a),sin(a))*radius/size);
          float difference=center-sampleDepth;
          occlusion+=smoothstep(.012,.13,difference)*(1.-smoothstep(.2,.8,difference));
        }
        color*=1.-occlusion*.022;
        float vignette=dot((vUv-.5)*vec2(1.,.85),(vUv-.5)*vec2(1.,.85));
        color*=1.-vignette*.15;
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.round(bounds.width * resolution),
      height = Math.round(bounds.height * resolution);
    renderer.setSize(width, height, false);
    target.setSize(width, height);
    post.uniforms.size.value.set(width, height);
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
    particles.update(
      height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)),
    );
  }
  new ResizeObserver(resize).observe(aquarium);
  resize();

  // The pointer is a hand at the front glass. The fish read where it is and how fast it
  // is coming toward them, so its velocity is kept, smoothed over a few events, and let
  // die away once the events stop.
  let pointer = null,
    lastPointerTime = 0;
  const pointerPosition = new THREE.Vector3();
  const pointerSample = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -2.6);
  canvas.addEventListener("pointermove", (event) => {
    const bounds = canvas.getBoundingClientRect();
    const normalized = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(normalized, camera);
    if (raycaster.ray.intersectPlane(waterPlane, pointerPosition)) {
      const now = performance.now();
      if (pointer) {
        const seconds = Math.max(0.004, (now - lastPointerTime) / 1000);
        pointerSample
          .subVectors(pointerPosition, pointer.position)
          .divideScalar(seconds);
        pointer.velocity.lerp(pointerSample, 0.5);
        pointer.position.copy(pointerPosition);
      } else
        pointer = {
          position: pointerPosition.clone(),
          velocity: new THREE.Vector3(),
        };
      lastPointerTime = now;
    }
  });
  canvas.addEventListener("pointerleave", () => {
    pointer = null;
  });

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else
      aquarium
        .requestFullscreen()
        .catch((error) => console.warn(error.message));
  }
  document.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (event.code === "Space") {
      event.preventDefault();
      paused = !paused;
    }
    if (event.key.toLowerCase() === "f") fullscreen();
  });
  let last = performance.now(),
    time = 0;
  let ready = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const elapsed = now - last;
    last = now;
    if (document.hidden) return;
    const dt = Math.min(0.05, elapsed / 1000);
    if (!paused) {
      time += dt;
      waterTime.value = time;
      fish.update(dt, time, pointer);
    }
    if (pointer && now - lastPointerTime > 60)
      pointer.velocity.multiplyScalar(Math.exp(-dt * 12));
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
    if (!ready) {
      ready = true;
      loading.style.opacity = 0;
      setTimeout(() => {
        loading.hidden = true;
      }, 850);
    }
  }
  requestAnimationFrame(frame);
}

start().catch(fail);

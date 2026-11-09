import * as THREE from "three";

const mount = document.getElementById("world");
const intro = document.getElementById("intro");
const pauseOverlay = document.getElementById("pause");
const startButton = document.getElementById("startButton");
const resumeButton = document.getElementById("resumeButton");
const recenterButton = document.getElementById("recenterButton");
const speedValue = document.getElementById("speedValue");
const waveValue = document.getElementById("waveValue");
const tideValue = document.getElementById("tideValue");
const tideDistanceValue = document.getElementById("tideDistanceValue");
const stateValue = document.getElementById("stateValue");
const underwaterOverlay = document.getElementById("underwaterOverlay");
const clockLabel = document.getElementById("clockLabel");

const MOBILE = matchMedia("(max-width: 760px)").matches;
const GROUND_Y = -1.15;
const WATER_SIZE = 3000;
const SUN_DIR = new THREE.Vector3(-0.48, 0.27, -0.83).normalize();

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.15 : 1.55));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
mount.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8baeb8);
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 18000);
const clock = new THREE.Clock();
const player = new THREE.Group();
scene.add(player);

scene.add(new THREE.HemisphereLight(0xc4e8f4, 0x17303d, 1.25));
const sunLight = new THREE.DirectionalLight(0xffe2b7, 2.0);
sunLight.position.copy(SUN_DIR).multiplyScalar(800);
scene.add(sunLight);
const fillLight = new THREE.DirectionalLight(0x75c9e7, 0.85);
fillLight.position.set(450, 100, 260);
scene.add(fillLight);

let simulationTime = 0;
let started = false;
let paused = false;
let pointerLocked = false;
let hadPointerLock = false;
let dragging = false;
let lastPointer = { x: 0, y: 0 };
let cameraYaw = 0.12;
let cameraPitch = 0.19;
const cameraDistance = 13.5;
let firstPerson = false;
const keys = Object.create(null);
const velocity = new THREE.Vector3();
let verticalVelocity = 0;
let spaceStrokeRequested = false;
let walkPhase = 0;
let splashTimer = 0;
let rippleTimer = 0;
let tideSprayTimer = 0;
let telemetryTimer = 0;
let tideFrontZ = -720;
let tideCenterX = 0;
let tideAmplitude = 1;

function tideCycleAt(time) {
  const period = 148;
  const phase = (time % period) / period;
  const approaching = phase < 0.70;
  const progress = approaching ? phase / 0.70 : (phase - 0.70) / 0.30;
  const eased = progress * progress * (3 - 2 * progress);
  const distance = approaching ? 720 - 615 * eased : 105 + 615 * eased;
  return { distance, approaching, phase };
}

const OCEAN_GRAVITY = 9.81;
const OCEAN_DEPTH = 350;
const OCEAN_WIND_SPEED = 28; // m/s: deliberately stormy Miller sea state
const OCEAN_WAVES_COUNT = 10;
const OCEAN_WAVE_BINS = [
  { wavelength: 1100, angle: -8, phase: 0.4 },
  { wavelength: 760, angle: 5, phase: 2.2 },
  { wavelength: 520, angle: -14, phase: 4.1 },
  { wavelength: 360, angle: 12, phase: 1.5 },
  { wavelength: 250, angle: -21, phase: 3.2 },
  { wavelength: 170, angle: 22, phase: 5.1 },
  { wavelength: 115, angle: -28, phase: 0.9 },
  { wavelength: 75, angle: 29, phase: 2.8 },
  { wavelength: 48, angle: -35, phase: 4.7 },
  { wavelength: 30, angle: 34, phase: 1.9 }
];

function jonswapAmplitude(wavelength) {
  const k = 2 * Math.PI / wavelength;
  const omega = Math.sqrt(OCEAN_GRAVITY * k * Math.tanh(k * OCEAN_DEPTH));
  const peakOmega = 0.877 * OCEAN_GRAVITY / OCEAN_WIND_SPEED;
  const sigma = omega <= peakOmega ? 0.07 : 0.09;
  const peakShape = Math.exp(-Math.pow(omega - peakOmega, 2) /
    (2 * sigma * sigma * peakOmega * peakOmega));
  const spectrum = 0.0081 * OCEAN_GRAVITY * OCEAN_GRAVITY / Math.pow(omega, 5) *
    Math.exp(-1.25 * Math.pow(peakOmega / omega, 4)) * Math.pow(3.3, peakShape);
  return Math.sqrt(2 * spectrum * (0.15 * omega));
}

const OCEAN_WAVES = OCEAN_WAVE_BINS.map(bin => {
  const angle = THREE.MathUtils.degToRad(bin.angle);
  const dirX = Math.sin(angle);
  const dirZ = -Math.cos(angle);
  const k = 2 * Math.PI / bin.wavelength;
  const omega = Math.sqrt(OCEAN_GRAVITY * k * Math.tanh(k * OCEAN_DEPTH));
  const amplitude = jonswapAmplitude(bin.wavelength);
  // Sum(Q_i * k_i * A_i) remains below one so Gerstner crests do not loop.
  const horizontalAmplitude = 0.68 / (OCEAN_WAVES_COUNT * k);
  return { dirX, dirZ, k, omega, amplitude, phase: bin.phase, horizontalAmplitude };
});

function waveHeight(x, z, time) {
  let height = 0;
  for (const wave of OCEAN_WAVES) {
    const phase = wave.k * (x * wave.dirX + z * wave.dirZ) - wave.omega * time + wave.phase;
    height += wave.amplitude * Math.sin(phase);
  }
  const lateralX = (x - tideCenterX) / 780;
  const lateral = Math.exp(-Math.pow(lateralX, 8));
  const bend = Math.sin(x * 0.0035 + time * 0.13) * 0.13 +
    Math.sin(x * 0.010 - time * 0.21) * 0.055;
  const tidePhase = (z - tideFrontZ + bend * 110) * 0.0085 + Math.PI * 0.5;
  height += tideAmplitude * lateral *
    (26 * Math.sin(tidePhase) + 4.2 * Math.sin(2 * tidePhase - 0.42));
  return height;
}

function createSkyDome() {
  const geometry = new THREE.SphereGeometry(9000, 48, 32);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: [
      "varying vec3 vDir;",
      "void main(){",
      "vDir=normalize(position);",
      "gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);",
      "}"
    ].join("\n"),
    fragmentShader: [
      "uniform vec3 uSunDir;",
      "uniform float uTime;",
      "varying vec3 vDir;",
      "void main(){",
      "vec3 d=normalize(vDir);",
      "float h=clamp(d.y,0.0,1.0);",
      "vec3 horizon=vec3(0.72,0.60,0.47);",
      "vec3 zenith=vec3(0.045,0.13,0.20);",
      "vec3 sky=mix(horizon,zenith,pow(h,0.72));",
      "float haze=pow(1.0-abs(d.y),8.0);",
      "sky+=vec3(0.12,0.16,0.17)*haze;",
      "float sunDot=max(dot(d,normalize(uSunDir)),0.0);",
      "float disc=pow(sunDot,1150.0);",
      "float halo=pow(sunDot,35.0)*0.32;",
      "sky+=vec3(1.0,0.73,0.42)*disc*3.2;",
      "sky+=vec3(1.0,0.66,0.38)*halo;",
      "float cloud=sin(d.x*34.0+d.z*18.0+uTime*0.006)*sin(d.z*27.0-d.y*13.0);",
      "sky+=vec3(0.10,0.13,0.13)*max(cloud,0.0)*smoothstep(0.02,0.48,d.y)*0.12;",
      "gl_FragColor=vec4(sky,1.0);",
      "#include <tonemapping_fragment>",
      "#include <colorspace_fragment>",
      "}"
    ].join("\n"),
    uniforms: {
      uSunDir: { value: SUN_DIR.clone() },
      uTime: { value: 0 }
    },
    fog: false
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.renderOrder = -10;
  scene.add(sky);
  return sky;
}
const skyDome = createSkyDome();

function createOcean() {
  // Long gravity waves are geometry; short ripples are evaluated in the pixel shader.
  const segments = MOBILE ? 300 : 440;
  const geometry = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const vertexShader = [
    "uniform float uTime;",
    "uniform vec2 uOrigin;",
    "uniform float uTideZ;",
    "uniform float uTideX;",
    "uniform vec4 uWaveData[10];",
    "uniform vec4 uWaveMotion[10];",
    "varying vec3 vWorldPos;",
    "varying vec2 vWorldXZ;",
    "varying vec3 vWaveNormal;",
    "varying float vCompression;",
    "varying float vHeight;",
    "void evaluateOcean(vec2 p,float t,out vec2 displacement,out vec3 tangentX,out vec3 tangentZ,out float height,out float compression){",
    "displacement=vec2(0.0);",
    "float dXdx=1.0,dXdz=0.0,dZdx=0.0,dZdz=1.0,dYdx=0.0,dYdz=0.0;",
    "height=0.0;",
    "for(int i=0;i<10;i++){",
    "vec4 w=uWaveData[i];vec4 m=uWaveMotion[i];",
    "vec2 d=w.xy;float k=w.z,A=w.w,omega=m.x,phaseOffset=m.y,qA=m.z;",
    "float phase=k*dot(p,d)-omega*t+phaseOffset;",
    "float sn=sin(phase),cs=cos(phase);",
    "height+=A*sn;displacement+=d*qA*cs;",
    "dXdx-=qA*k*d.x*d.x*sn;dXdz-=qA*k*d.x*d.y*sn;",
    "dZdx-=qA*k*d.y*d.x*sn;dZdz-=qA*k*d.y*d.y*sn;",
    "dYdx+=A*k*d.x*cs;dYdz+=A*k*d.y*cs;",
    "}",
    "float lateralX=(p.x-uTideX)/780.0;",
    "float lateral=exp(-pow(lateralX,8.0));",
    "float bend=sin(p.x*0.0035+t*0.13)*0.13+sin(p.x*0.010-t*0.21)*0.055;",
    "float bendDx=cos(p.x*0.0035+t*0.13)*0.13*0.0035+cos(p.x*0.010-t*0.21)*0.055*0.010;",
    "float tideK=0.0085;",
    "float tidePhase=(p.y-uTideZ+bend*110.0)*tideK+1.5707963;",
    "float tideShape=26.0*sin(tidePhase)+4.2*sin(2.0*tidePhase-0.42);",
    "float tideSlope=26.0*cos(tidePhase)+8.4*cos(2.0*tidePhase-0.42);",
    "height+=lateral*tideShape;",
    "float lateralDx=-8.0*pow(lateralX,7.0)/780.0*lateral;",
    "dYdx+=lateralDx*tideShape+lateral*tideSlope*bendDx*110.0*tideK;",
    "dYdz+=lateral*tideSlope*tideK;",
    "tangentX=vec3(dXdx,dYdx,dZdx);",
    "tangentZ=vec3(dXdz,dYdz,dZdz);",
    "float jacobian=dXdx*dZdz-dXdz*dZdx;",
    "compression=clamp(1.0-jacobian,0.0,1.0);",
    "}",
    "void main(){",
    "vec3 p=position;vec2 baseXZ=vec2(p.x+uOrigin.x,p.z+uOrigin.y);",
    "vec2 displacement;vec3 tangentX,tangentZ;float height,compression;",
    "evaluateOcean(baseXZ,uTime,displacement,tangentX,tangentZ,height,compression);",
    "p.x+=displacement.x;p.z+=displacement.y;p.y=height;",
    "vec4 world=modelMatrix*vec4(p,1.0);",
    "vWorldPos=world.xyz;vWorldXZ=baseXZ+displacement;",
    "vWaveNormal=normalize(cross(tangentZ,tangentX));",
    "vCompression=compression;vHeight=height;",
    "gl_Position=projectionMatrix*viewMatrix*world;",
    "}"
  ].join("\n");

  const fragmentShader = [
    "uniform float uTime;",
    "uniform vec3 uSunDir;",
    "uniform float uTideZ;",
    "varying vec3 vWorldPos;",
    "varying vec2 vWorldXZ;",
    "varying vec3 vWaveNormal;",
    "varying float vCompression;",
    "varying float vHeight;",
    "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}",
    "float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float a=hash(i),b=hash(i+vec2(1.0,0.0)),c=hash(i+vec2(0.0,1.0)),d=hash(i+vec2(1.0,1.0));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}",
    "float fbm(vec2 p){float n=0.0,a=0.5;for(int i=0;i<3;i++){n+=a*noise(p);p=p*2.03+vec2(17.1,9.2);a*=0.5;}return n;}",
    "vec3 skyReflection(vec3 d){",
    "float h=clamp(d.y,0.0,1.0);",
    "vec3 sky=mix(vec3(0.66,0.60,0.51),vec3(0.045,0.12,0.17),pow(h,0.72));",
    "vec2 cloudUV=d.xz/(max(0.12,d.y+0.32))*3.8+vec2(uTime*0.0015,-uTime*0.0011);",
    "float cloudField=0.68*noise(cloudUV)+0.32*noise(cloudUV*2.7+vec2(3.1,7.4));",
    "float clouds=smoothstep(0.49,0.73,cloudField)*smoothstep(0.015,0.48,d.y);",
    "sky=mix(sky,vec3(0.75,0.79,0.76),clouds*0.38);",
    "float sun=max(dot(normalize(d),normalize(uSunDir)),0.0);",
    "sky+=vec3(1.0,0.78,0.56)*(pow(sun,620.0)*2.1+pow(sun,34.0)*0.30);",
    "return sky;}",
    "float distributionGGX(float nDotH,float roughness){float a=roughness*roughness;float a2=a*a;float d=nDotH*nDotH*(a2-1.0)+1.0;return a2/max(3.14159265*d*d,0.00001);}",
    "float geometrySchlickGGX(float nDotX,float roughness){float r=roughness+1.0;float k=r*r*0.125;return nDotX/max(nDotX*(1.0-k)+k,0.00001);}",
    "void main(){",
    "vec2 p=vWorldXZ;vec3 N=normalize(vWaveNormal);",
    // Small-scale travelling ripples influence the reflected highlights without overloading the mesh.
    "float ph1=dot(p,vec2(0.83,0.55))*0.90-uTime*2.85;",
    "float ph2=dot(p,vec2(-0.44,0.90))*1.42+uTime*4.05;",
    "float ph3=dot(p,vec2(0.96,-0.27))*2.15-uTime*6.10;",
    "float ph4=dot(p,vec2(-0.72,-0.69))*3.10+uTime*7.60;",
    "vec2 microSlope=vec2(-0.060*0.90*0.83*sin(ph1)-0.032*1.42*(-0.44)*sin(ph2)-0.014*2.15*0.96*sin(ph3)-0.007*3.10*(-0.72)*sin(ph4),",
    "0.060*0.90*0.55*cos(ph1)+0.032*1.42*0.90*cos(ph2)+0.014*2.15*(-0.27)*cos(ph3)+0.007*3.10*(-0.69)*cos(ph4));",
    "N=normalize(N+vec3(-microSlope.x,0.0,-microSlope.y));",
    "vec3 V=normalize(cameraPosition-vWorldPos);vec3 L=normalize(uSunDir);vec3 H=normalize(V+L);",
    "float nDotV=max(dot(N,V),0.001);float nDotL=max(dot(N,L),0.0);",
    "float nDotH=max(dot(N,H),0.0);float vDotH=max(dot(V,H),0.0);",
    "float fresnel=0.02037+(1.0-0.02037)*pow(1.0-nDotV,5.0);",
    "vec3 reflected=skyReflection(reflect(-V,N));",
    "float microRough=fbm(p*0.055+vec2(uTime*0.025,-uTime*0.018));",
    "float roughness=clamp(0.095+microRough*0.055+vCompression*0.075,0.075,0.29);",
    "float D=distributionGGX(nDotH,roughness);",
    "float G=geometrySchlickGGX(nDotV,roughness)*geometrySchlickGGX(max(nDotL,0.001),roughness);",
    "vec3 F=vec3(0.02037)+(vec3(1.0)-vec3(0.02037))*pow(1.0-vDotH,5.0);",
    "vec3 directSpec=D*G*F/max(4.0*nDotV*max(nDotL,0.001),0.001)*nDotL*vec3(1.0,0.86,0.68)*2.2;",
    // Beer-Lambert-inspired attenuation plus blue-green in-scattering color the transmitted light.
    "float opticalPath=2.8/max(nDotV,0.14);",
    "vec3 attenuation=exp(-vec3(0.23,0.075,0.030)*opticalPath);",
    "vec3 waterBody=mix(vec3(0.002,0.018,0.030),vec3(0.010,0.105,0.135),1.0-dot(attenuation,vec3(0.3333)));",
    "waterBody+=vec3(0.002,0.025,0.030)*nDotL;",
    "vec3 water=mix(waterBody,reflected,fresnel)+directSpec;",
    // Foam appears where the Gerstner mapping compresses and is carried by moving surface turbulence.
    "float foamNoise=fbm(p*0.026+vec2(-uTime*0.038,uTime*0.021));",
    "float foamGrain=noise(p*0.13+vec2(-uTime*0.12,uTime*0.075));",
    "float compressionFoam=smoothstep(0.13,0.47,vCompression);",
    "float tideFront=p.y-uTideZ+sin(p.x*0.0035+uTime*0.13)*14.0;",
    "float tideCrest=exp(-pow(tideFront/31.0,2.0));",
    "float crestFoam=tideCrest*smoothstep(0.34,0.68,foamNoise);",
    "float whitecap=clamp(compressionFoam*(0.20+0.80*smoothstep(0.34,0.73,foamNoise))+crestFoam*0.78,0.0,0.88);",
    "whitecap*=0.62+0.38*smoothstep(0.22,0.82,foamGrain);",
    "float bubbles=smoothstep(0.70,0.90,noise(p*0.22+vec2(-uTime*0.15,uTime*0.10)))*whitecap;",
    "vec3 foamColor=vec3(0.72,0.86,0.86)+vec3(0.10,0.10,0.08)*nDotL;",
    "water=mix(water,foamColor,clamp(whitecap+bubbles*0.24,0.0,0.92));",
    "float distanceToCamera=length(cameraPosition-vWorldPos);",
    "float fog=1.0-exp(-pow(distanceToCamera*0.00052,2.0));",
    "vec3 horizon=vec3(0.50,0.58,0.57);water=mix(water,horizon,clamp(fog,0.0,0.82));",
    "gl_FragColor=vec4(water,1.0);",
    "#include <tonemapping_fragment>",
    "#include <colorspace_fragment>",
    "}"
  ].join("\n");

  const waveUniforms = OCEAN_WAVES.map(w => new THREE.Vector4(w.dirX,w.dirZ,w.k,w.amplitude));
  const motionUniforms = OCEAN_WAVES.map(w => new THREE.Vector4(w.omega,w.phase,w.horizontalAmplitude,0));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector2(0, 0) },
      uTideZ: { value: -720 },
      uTideX: { value: 0 },
      uSunDir: { value: SUN_DIR.clone() },
      uWaveData: { value: waveUniforms },
      uWaveMotion: { value: motionUniforms }
    },
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide
  });
  const ocean = new THREE.Mesh(geometry, material);
  ocean.frustumCulled = false;
  ocean.renderOrder = 1;
  scene.add(ocean);
  return ocean;
}
const ocean = createOcean();



function createGargantua() {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(52, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0x010205 })
  );
  group.add(core);

  const ring1 = new THREE.Mesh(
    new THREE.TorusGeometry(78, 1.8, 10, 240),
    new THREE.MeshBasicMaterial({ color: 0xf8dfb7, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })
  );
  ring1.rotation.set(1.16, 0.18, -0.08);
  group.add(ring1);
  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(88, 0.65, 8, 240),
    new THREE.MeshBasicMaterial({ color: 0x82d6ee, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending })
  );
  ring2.rotation.set(1.16, 0.18, -0.08);
  group.add(ring2);
  const glowMaterial = new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: 0xffb979,
    transparent: true,
    opacity: 0.36,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const glow = new THREE.Sprite(glowMaterial);
  glow.scale.set(290, 170, 1);
  glow.position.z = -2;
  group.add(glow);
  scene.add(group);
  return { group, ring1, ring2 };
}
function makeGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(128,128,4,128,128,126);
  g.addColorStop(0,"rgba(255,240,210,.52)");
  g.addColorStop(0.18,"rgba(255,177,111,.28)");
  g.addColorStop(0.52,"rgba(102,166,190,.10)");
  g.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=g;ctx.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(canvas);
}
const gargantua = createGargantua();

function mat(color, roughness = 0.5, metalness = 0.1) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
function makeExplorer() {
  const root = new THREE.Group();
  const suit = mat(0xd9e4df, 0.42, 0.22);
  const dark = mat(0x1a2d37, 0.7, 0.1);
  const orange = mat(0xd18b4d, 0.48, 0.12);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x7ca7b7, metalness: 0.68, roughness: 0.12, transparent: true, opacity: 0.78, clearcoat: 1, clearcoatRoughness: 0.05 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x06121d, metalness: 0.92, roughness: 0.08 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x9deeff });

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.40,0.48,1.12,18,1), suit);
  torso.position.y = 1.66; root.add(torso);
  const upper = new THREE.Mesh(new THREE.SphereGeometry(0.42,20,16), suit);
  upper.position.set(0,2.12,0); upper.scale.set(1,0.52,0.92); root.add(upper);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.42,18,14), dark);
  pelvis.position.y=1.04;pelvis.scale.set(1,0.7,0.85);root.add(pelvis);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.405,0.055,8,32),orange);
  belt.position.y=1.17;root.add(belt);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.42,28,22),suit);
  helmet.position.y=2.72;root.add(helmet);
  const visorMesh = new THREE.Mesh(new THREE.SphereGeometry(0.335,28,20),glass);
  visorMesh.position.set(0,2.73,-0.16);visorMesh.scale.set(0.9,0.82,0.42);root.add(visorMesh);
  const visorLine = new THREE.Mesh(new THREE.TorusGeometry(0.365,0.025,8,36),orange);
  visorLine.position.set(0,2.73,-0.05);visorLine.scale.set(1,0.95,0.72);root.add(visorLine);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.04,0.34,8),dark);
  antenna.position.set(0.24,3.1,0.02);root.add(antenna);
  const antennaLight = new THREE.Mesh(new THREE.SphereGeometry(0.055,10,8),glow);
  antennaLight.position.set(0.24,3.28,0.02);root.add(antennaLight);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.72,0.92,0.36),orange);
  backpack.position.set(0,1.78,0.48);root.add(backpack);
  const packTop = new THREE.Mesh(new THREE.BoxGeometry(0.56,0.12,0.28),dark);
  packTop.position.set(0,2.26,0.48);root.add(packTop);
  for(let side of [-1,1]){
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.115,0.13,0.66,12),dark);
    tank.position.set(side*0.34,1.72,0.56);root.add(tank);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.25,16,12),orange);
    shoulder.position.set(side*0.52,2.02,0);root.add(shoulder);
  }

  const legPivots=[];
  for(const side of [-1,1]){
    const pivot=new THREE.Group();pivot.position.set(side*0.22,0.94,0);root.add(pivot);
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.18,0.72,14),suit);
    leg.position.y=-0.38;pivot.add(leg);
    const knee=new THREE.Mesh(new THREE.SphereGeometry(0.17,12,10),orange);
    knee.position.y=-0.72;pivot.add(knee);
    const boot=new THREE.Mesh(new THREE.BoxGeometry(0.32,0.24,0.48),dark);
    boot.position.set(0,-0.88,-0.06);pivot.add(boot);
    const bootStripe=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.045,0.12),glow);
    bootStripe.position.set(0,-0.82,-0.26);pivot.add(bootStripe);
    legPivots.push(pivot);
  }
  const armPivots=[];
  for(const side of [-1,1]){
    const pivot=new THREE.Group();pivot.position.set(side*0.48,2.0,0);root.add(pivot);
    const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.16,0.78,14),suit);
    arm.position.y=-0.36;pivot.add(arm);
    const elbow=new THREE.Mesh(new THREE.SphereGeometry(0.16,12,10),orange);
    elbow.position.y=-0.68;pivot.add(elbow);
    const glove=new THREE.Mesh(new THREE.SphereGeometry(0.17,12,10),dark);
    glove.position.set(0,-0.82,-0.03);glove.scale.set(0.85,1.0,0.9);pivot.add(glove);
    armPivots.push(pivot);
  }
  const chestLight=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.12,0.035),glow);
  chestLight.position.set(0,1.77,-0.43);
  const chestPanel=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.36,0.045),dark);
  chestPanel.position.set(0,1.72,-0.44);root.add(chestPanel);
  chestPanel.add(chestLight);
  chestLight.position.set(0,0.055,-0.03);
  player.add(root);
  return { root, legPivots, armPivots };
}
const explorer = makeExplorer();

function createParticleSystem(count) {
  const positions = new Float32Array(count*3);
  const velocities = new Float32Array(count*3);
  const life = new Float32Array(count);
  positions.fill(-10000);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.PointsMaterial({ color:0xc8faff, size:0.14, sizeAttenuation:true, transparent:true, opacity:0.88, blending:THREE.AdditiveBlending, depthWrite:false });
  const points = new THREE.Points(geometry,material);
  points.frustumCulled=false;
  scene.add(points);
  return { count, positions, velocities, life, geometry, points, cursor:0 };
}
const spray=createParticleSystem(MOBILE ? 130 : 280);
function spawnSpray(x,z,amount=9) {
  const y=waveHeight(x,z,simulationTime)+0.05;
  for(let j=0;j<amount;j++){
    const i=spray.cursor++%spray.count;
    spray.positions[3*i]=x+(Math.random()-.5)*0.7;
    spray.positions[3*i+1]=y+Math.random()*0.15;
    spray.positions[3*i+2]=z+(Math.random()-.5)*0.7;
    spray.velocities[3*i]=(Math.random()-.5)*2.4+velocity.x*0.18;
    spray.velocities[3*i+1]=1.2+Math.random()*2.4;
    spray.velocities[3*i+2]=(Math.random()-.5)*2.4+velocity.z*0.18;
    spray.life[i]=0.55+Math.random()*0.55;
  }
}
function updateSpray(dt) {
  for(let i=0;i<spray.count;i++){
    if(spray.life[i]<=0)continue;
    spray.life[i]-=dt;
    spray.positions[3*i]+=spray.velocities[3*i]*dt;
    spray.positions[3*i+1]+=spray.velocities[3*i+1]*dt;
    spray.positions[3*i+2]+=spray.velocities[3*i+2]*dt;
    spray.velocities[3*i+1]-=4.8*dt;
    if(spray.life[i]<=0)spray.positions[3*i+1]=-10000;
  }
  spray.geometry.attributes.position.needsUpdate=true;
}

const ripplePool=[];
for(let i=0;i<10;i++){
  const material=new THREE.MeshBasicMaterial({color:0xc8f8ff,transparent:true,opacity:0.0,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
  const mesh=new THREE.Mesh(new THREE.TorusGeometry(0.45,0.018,8,48),material);
  mesh.rotation.x=-Math.PI/2;
  mesh.visible=false;
  scene.add(mesh);
  ripplePool.push({mesh,material,life:0});
}
let rippleCursor=0;
function spawnRipple() {
  const x=player.position.x+(Math.random()-.5)*0.95;
  const z=player.position.z+(Math.random()-.5)*1.1;
  const r=ripplePool[rippleCursor++%ripplePool.length];
  r.life=1.0;r.mesh.visible=true;r.mesh.position.set(x,waveHeight(x,z,simulationTime)+0.025,z);r.mesh.scale.setScalar(0.18);r.material.opacity=0.54;r.mesh.rotation.z=Math.random()*Math.PI;
}
function updateRipples(dt) {
  for(const r of ripplePool){
    if(r.life<=0)continue;
    r.life-=dt*0.85;
    const age=1-r.life;
    r.mesh.scale.setScalar(0.18+age*3.0);
    r.material.opacity=Math.max(0,r.life)*0.54;
    if(r.life<=0)r.mesh.visible=false;
  }
}

function updatePlayer(dt) {
  const forwardInput = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const sideInput = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  const right = new THREE.Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
  const wish = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(sideInput));
  if (wish.lengthSq() > 1) wish.normalize();

  const tide = tideCycleAt(simulationTime);
  const pressure = 1 - THREE.MathUtils.smoothstep(tide.distance, 92, 340);
  const currentX = Math.sin(player.position.z * 0.008 + simulationTime * 0.19) * 0.34;
  const currentZ = Math.cos(player.position.x * 0.006 - simulationTime * 0.16) * 0.26;
  const tideFlow = tide.approaching ? pressure * 3.3 : -pressure * 0.65;
  const maxSpeed = (keys.ShiftLeft || keys.ShiftRight) ? 7.8 : 5.2;
  const targetX = wish.x * maxSpeed + currentX;
  const targetZ = wish.z * maxSpeed + currentZ + tideFlow;
  const response = wish.lengthSq() > 0 ? 3.7 : 1.35;
  velocity.x += (targetX - velocity.x) * Math.min(1, response * dt);
  velocity.z += (targetZ - velocity.z) * Math.min(1, response * dt);

  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  if (horizontalSpeed > 11.5) {
    velocity.multiplyScalar(11.5 / horizontalSpeed);
  }
  player.position.x += velocity.x * dt;
  player.position.z += velocity.z * dt;

  const diving = !!(keys.ControlLeft || keys.ControlRight);
  const surfaceY = waveHeight(player.position.x, player.position.z, simulationTime);
  const targetY = surfaceY - 1.16 - (diving ? 1.28 : 0);
  const buoyancyAcceleration = (targetY - player.position.y) * 9.4 - verticalVelocity * 4.25;
  verticalVelocity += buoyancyAcceleration * dt;
  if (spaceStrokeRequested) {
    verticalVelocity += diving ? 3.25 : 2.05;
    spaceStrokeRequested = false;
    spawnSpray(player.position.x, player.position.z, 16);
  }
  verticalVelocity = THREE.MathUtils.clamp(verticalVelocity, -4.8, 5.8);
  player.position.y += verticalVelocity * dt;

  if (horizontalSpeed > 0.16 || diving) {
    if (horizontalSpeed > 0.16) {
      const desiredYaw = Math.atan2(-velocity.x, -velocity.z);
      let difference = desiredYaw - explorer.root.rotation.y;
      difference = Math.atan2(Math.sin(difference), Math.cos(difference));
      explorer.root.rotation.y += difference * Math.min(1, dt * 7.5);
      walkPhase += dt * (2.3 + horizontalSpeed * 1.8);
    } else {
      walkPhase += dt * 2.1;
    }
    if (diving) {
      explorer.legPivots[0].rotation.x = Math.sin(walkPhase * 0.82) * 0.35;
      explorer.legPivots[1].rotation.x = -Math.sin(walkPhase * 0.82) * 0.35;
      explorer.armPivots[0].rotation.x = -0.28 + Math.sin(walkPhase) * 0.55;
      explorer.armPivots[1].rotation.x = -0.28 - Math.sin(walkPhase) * 0.55;
    } else {
      explorer.legPivots[0].rotation.x = Math.sin(walkPhase) * 0.48;
      explorer.legPivots[1].rotation.x = -Math.sin(walkPhase) * 0.48;
      explorer.armPivots[0].rotation.x = -Math.sin(walkPhase) * 0.30;
      explorer.armPivots[1].rotation.x = Math.sin(walkPhase) * 0.30;
    }
    explorer.root.position.y = Math.sin(walkPhase * 2) * (diving ? 0.065 : 0.045);
    splashTimer += dt;
    rippleTimer += dt;
    if (horizontalSpeed > 0.16 && splashTimer > 0.17) {
      spawnSpray(player.position.x, player.position.z, diving ? 7 : 5);
      splashTimer = 0;
    }
    if (rippleTimer > (diving ? 0.62 : 0.42)) {
      spawnRipple();
      rippleTimer = 0;
    }
  } else {
    explorer.legPivots.forEach(p => p.rotation.x *= Math.max(0, 1 - dt * 4));
    explorer.armPivots.forEach(p => p.rotation.x *= Math.max(0, 1 - dt * 4));
    explorer.root.position.y = Math.sin(simulationTime * 1.15) * 0.018;
    splashTimer = 0;
    rippleTimer = 0;
  }
  explorer.root.rotation.x += ((diving ? -0.13 : 0) - explorer.root.rotation.x) * Math.min(1, dt * 3.0);
  return horizontalSpeed;
}

const cameraTarget=new THREE.Vector3();
const cameraDesired=new THREE.Vector3();
function updateCamera(dt) {
  if (firstPerson) {
    const eyeY = player.position.y + 1.42;
    cameraDesired.set(player.position.x, eyeY, player.position.z);
    const lookDistance = 55;
    cameraTarget.set(
      player.position.x - Math.sin(cameraYaw) * Math.cos(cameraPitch) * lookDistance,
      eyeY + Math.sin(cameraPitch) * lookDistance,
      player.position.z - Math.cos(cameraYaw) * Math.cos(cameraPitch) * lookDistance
    );
  } else {
    const targetY = player.position.y + 1.6;
    const horizontal = cameraDistance * Math.cos(cameraPitch);
    cameraDesired.set(
      player.position.x + Math.sin(cameraYaw) * horizontal,
      targetY + Math.sin(cameraPitch) * cameraDistance,
      player.position.z + Math.cos(cameraYaw) * horizontal
    );
    cameraTarget.set(player.position.x, targetY, player.position.z);
  }
  camera.position.lerp(cameraDesired, Math.min(1, dt * (firstPerson ? 12 : 4.5)));
  camera.lookAt(cameraTarget);
  // Let the horizon gently respond to the passing swell instead of feeling locked in place.
  const leftHeight=waveHeight(player.position.x-2,player.position.z,simulationTime);
  const rightHeight=waveHeight(player.position.x+2,player.position.z,simulationTime);
  const seaSlope=(rightHeight-leftHeight)*0.25;
  const roll=THREE.MathUtils.clamp(-seaSlope*0.18,-0.035,0.035);
  camera.rotation.z=THREE.MathUtils.lerp(camera.rotation.z,roll,Math.min(1,dt*2.4));
}

function updateScene(dt, speed) {
  const tide = tideCycleAt(simulationTime);
  tideFrontZ = player.position.z - tide.distance;
  tideCenterX = player.position.x;
  tideAmplitude = 1;

  ocean.position.set(player.position.x, 0, player.position.z);
  ocean.material.uniforms.uOrigin.value.set(player.position.x, player.position.z);
  ocean.material.uniforms.uTideZ.value = tideFrontZ;
  ocean.material.uniforms.uTideX.value = tideCenterX;
  ocean.material.uniforms.uTime.value = simulationTime;
  skyDome.position.copy(camera.position);
  skyDome.material.uniforms.uTime.value = simulationTime;

  gargantua.group.position.set(player.position.x - 355, 170, player.position.z - 1650);
  gargantua.ring1.rotation.z = Math.sin(simulationTime * 0.012) * 0.025;
  gargantua.ring2.rotation.z = -Math.sin(simulationTime * 0.012) * 0.025;

  const sprayWindow = tide.approaching && tide.distance < 490;
  if (sprayWindow) {
    tideSprayTimer += dt;
    if (tideSprayTimer > 0.16) {
      const x = player.position.x + (Math.random() - 0.5) * 760;
      spawnSpray(x, tideFrontZ, MOBILE ? 3 : 5);
      tideSprayTimer = 0;
    }
  } else {
    tideSprayTimer = 0;
  }

  updateSpray(dt);
  updateRipples(dt);
  const surfaceY = waveHeight(player.position.x, player.position.z, simulationTime);
  const underwater = firstPerson && camera.position.y < surfaceY;
  underwaterOverlay.style.opacity = underwater ? "1" : "0";
  document.body.classList.toggle("tide-near", tide.distance < 260);

  telemetryTimer += dt;
  if (telemetryTimer > 0.12) {
    speedValue.textContent = speed.toFixed(1) + " m/s";
    waveValue.textContent = (surfaceY >= 0 ? "+" : "") + surfaceY.toFixed(2) + " m";
    tideValue.textContent = tide.approaching ? "ACERCÁNDOSE" : "RETIRÁNDOSE";
    tideDistanceValue.textContent = Math.round(tide.distance) + " m";
    stateValue.textContent = (keys.ControlLeft || keys.ControlRight) ? "SUMERGIDO" : "VADEANDO";
    const minutes = Math.floor(simulationTime / 60).toString().padStart(2, "0");
    const seconds = Math.floor(simulationTime % 60).toString().padStart(2, "0");
    clockLabel.textContent = "T+ " + minutes + ":" + seconds;
    telemetryTimer = 0;
  }
}

function startGame() {
  started=true;paused=false;
  intro.classList.add("hidden");pauseOverlay.classList.add("hidden");
  if(renderer.domElement.requestPointerLock){
    try{renderer.domElement.requestPointerLock();}catch(error){console.info("Se usará cámara con arrastre",error);}
  }
}
function pauseGame() {
  if(!started||paused)return;
  paused=true;pauseOverlay.classList.remove("hidden");
  if(document.pointerLockElement)document.exitPointerLock();
}
function resumeGame() {
  paused=false;pauseOverlay.classList.add("hidden");
  if(renderer.domElement.requestPointerLock){
    try{renderer.domElement.requestPointerLock();}catch(error){console.info("Cámara con arrastre activa",error);}
  }
}
startButton.addEventListener("click",startGame);
resumeButton.addEventListener("click",resumeGame);
recenterButton.addEventListener("click",()=>{cameraYaw=0.12;cameraPitch=0.19;});
document.addEventListener("pointerlockchange",()=>{
  pointerLocked=document.pointerLockElement===renderer.domElement;
  if(pointerLocked){hadPointerLock=true;}
  else if(hadPointerLock&&started&&!paused){pauseGame();}
});
window.addEventListener("keydown",event=>{
  if(event.code==="Escape"){
    if(started&&!paused)pauseGame();
    else if(started&&paused)resumeGame();
    return;
  }
  if (event.code === "KeyV" && !event.repeat && started && !paused) {
    firstPerson = !firstPerson;
    explorer.root.visible = !firstPerson;
    return;
  }
  if (event.code === "Space" && !keys.Space) {
    spaceStrokeRequested = true;
  }
  if (["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.code)) event.preventDefault();
  keys[event.code] = true;
});
window.addEventListener("keyup", event => {
  keys[event.code] = false;
});
window.addEventListener("blur",()=>{for(const k of Object.keys(keys))keys[k]=false;});
renderer.domElement.addEventListener("click",()=>{
  if(started&&!paused&&!pointerLocked&&renderer.domElement.requestPointerLock){
    try{renderer.domElement.requestPointerLock();}catch(error){/* drag camera remains available */}
  }
});
renderer.domElement.addEventListener("pointerdown",event=>{
  if(!started||paused||pointerLocked)return;
  dragging=true;lastPointer.x=event.clientX;lastPointer.y=event.clientY;
  try{renderer.domElement.setPointerCapture(event.pointerId);}catch(error){/* optional pointer capture */}
});
renderer.domElement.addEventListener("pointermove",event=>{
  if(!started||paused)return;
  let dx=0,dy=0;
  if(pointerLocked){dx=event.movementX||0;dy=event.movementY||0;}
  else if(dragging){dx=event.clientX-lastPointer.x;dy=event.clientY-lastPointer.y;lastPointer.x=event.clientX;lastPointer.y=event.clientY;}
  else return;
  cameraYaw-=dx*0.0028;
  cameraPitch=THREE.MathUtils.clamp(cameraPitch-dy*0.0018,-0.48,0.58);
});
renderer.domElement.addEventListener("pointerup",()=>{dragging=false;});
renderer.domElement.addEventListener("pointercancel",()=>{dragging=false;});

document.querySelectorAll(".touch-pad [data-key]").forEach(button=>{
  const code=button.dataset.key;
  button.addEventListener("pointerdown",event=>{event.preventDefault();keys[code]=true;});
  ["pointerup","pointerleave","pointercancel"].forEach(type=>button.addEventListener(type,()=>{keys[code]=false;}));
});

function resize() {
  camera.aspect=window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,MOBILE?1.15:1.55));
  renderer.setSize(window.innerWidth,window.innerHeight);
}
window.addEventListener("resize",resize);

let firstRender=true;
function animate() {
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),0.045);
  simulationTime+=dt;
  let speed=0;
  if(started&&!paused){speed=updatePlayer(dt);}
  updateCamera(dt);
  updateScene(dt,speed);
  renderer.render(scene,camera);
  if(firstRender){firstRender=false;document.body.dataset.ready="true";}
}
player.position.set(0,GROUND_Y,0);
explorer.root.rotation.y=0;
updateCamera(0.016);
animate();

renderer.domElement.addEventListener("webglcontextlost",event=>{
  event.preventDefault();
  intro.classList.remove("hidden");
  const description=intro.querySelector(".menu-desc");
  if(description)description.textContent="El navegador perdió el contexto gráfico. Recarga la página para volver a iniciar la expedición.";
});
window.addEventListener("error",event=>console.error("Miller game error:",event.message));

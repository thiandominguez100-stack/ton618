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
const WATER_DEPTH_MEAN = 1.23;
const WATER_LEVEL = GROUND_Y + WATER_DEPTH_MEAN;
const WATER_SIZE = 3000;
const CAMERA_GROUND_CLEARANCE = 0.24;
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
const OCEAN_DEPTH = WATER_DEPTH_MEAN;
const OCEAN_WIND_SPEED = 8.0;
const OCEAN_TARGET_SIGNIFICANT_HEIGHT = 0.28;
const OCEAN_WAVES_COUNT = 10;
const OCEAN_WAVE_BINS = [
  { wavelength: 60, angle: -8, phase: 0.4 },
  { wavelength: 44, angle: 5, phase: 2.2 },
  { wavelength: 33, angle: -14, phase: 4.1 },
  { wavelength: 25, angle: 12, phase: 1.5 },
  { wavelength: 19, angle: -21, phase: 3.2 },
  { wavelength: 15, angle: 22, phase: 5.1 },
  { wavelength: 12, angle: -28, phase: 0.9 },
  { wavelength: 9, angle: 29, phase: 2.8 },
  { wavelength: 6.5, angle: -35, phase: 4.7 },
  { wavelength: 4.5, angle: 34, phase: 1.9 }
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
  return Math.sqrt(2 * spectrum * (0.12 * omega));
}

const rawWaveAmplitudes = OCEAN_WAVE_BINS.map(bin => jonswapAmplitude(bin.wavelength));
const rawVariance = rawWaveAmplitudes.reduce((sum, amplitude) => sum + amplitude * amplitude * 0.5, 0);
const rawSignificantHeight = 4 * Math.sqrt(Math.max(rawVariance, 1e-8));
const waveEnergyScale = OCEAN_TARGET_SIGNIFICANT_HEIGHT / Math.max(rawSignificantHeight, 1e-5);

const OCEAN_WAVES = OCEAN_WAVE_BINS.map((bin, index) => {
  const angle = THREE.MathUtils.degToRad(bin.angle);
  const dirX = Math.sin(angle);
  const dirZ = -Math.cos(angle);
  const k = 2 * Math.PI / bin.wavelength;
  const omega = Math.sqrt(OCEAN_GRAVITY * k * Math.tanh(k * OCEAN_DEPTH));
  const amplitude = rawWaveAmplitudes[index] * waveEnergyScale;
  const horizontalAmplitude = 0.56 / (OCEAN_WAVES_COUNT * k);
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
  const front = z - tideFrontZ;
  const mainSwell = 0.62 * Math.exp(-Math.pow(front / 72, 2));
  const trailingSwell = 0.10 * Math.exp(-Math.pow((front + 105) / 85, 2)) *
    Math.sin(front * 0.024 - time * 0.55);
  height += tideAmplitude * lateral * (mainSwell + trailingSwell);
  const verticalLimit = 0.11;
  const boundedHeight = verticalLimit * Math.tanh(height / verticalLimit);
  return WATER_LEVEL + boundedHeight;
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
      "float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}",
      "float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float a=hash21(i),b=hash21(i+vec2(1.0,0.0)),c=hash21(i+vec2(0.0,1.0)),d=hash21(i+vec2(1.0,1.0));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}",
      "float fbm2(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*noise2(p);p=p*2.03+vec2(17.1,9.2);a*=0.5;}return v;}",
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
      "vec2 skyUV=d.xz/max(0.18,d.y+0.16)*2.05;",
      "vec2 wind=vec2(uTime*0.0032,-uTime*0.00135);",
      "float warpX=fbm2(skyUV*1.35+wind);",
      "float warpY=fbm2(skyUV*1.35+wind+vec2(13.7,5.2));",
      "vec2 warpedUV=skyUV+(vec2(warpX,warpY)-0.5)*0.72;",
      "float body=fbm2(warpedUV*3.15+wind*0.85);",
      "float billow=fbm2(warpedUV*6.8-wind*1.45);",
      "float erosion=fbm2(warpedUV*13.6+wind*2.4);",
      "float cloudDensity=body*0.72+billow*0.23+erosion*0.05;",
      "float cloudShape=smoothstep(0.505,0.665,cloudDensity-(erosion-0.5)*0.055);",
      "float cloudBand=smoothstep(-0.035,0.13,d.y)*(1.0-smoothstep(0.61,0.88,d.y));",
      "float cumulus=cloudShape*cloudBand;",
      "float highField=fbm2(skyUV*9.5+wind*0.34+vec2(31.0,8.0));",
      "float cirrus=smoothstep(0.61,0.75,highField)*smoothstep(0.08,0.48,d.y)*0.19;",
      "float cloudAlpha=clamp(cumulus*0.88+cirrus,0.0,0.94);",
      "float sunFacing=clamp(dot(normalize(vec3(d.x,max(d.y,0.12),d.z)),normalize(uSunDir)),0.0,1.0);",
      "vec3 cloudShade=mix(vec3(0.25,0.34,0.38),vec3(0.98,0.91,0.79),smoothstep(0.02,0.70,sunFacing));",
      "cloudShade+=vec3(0.12,0.15,0.17)*(1.0-smoothstep(0.0,0.38,d.y));",
      "float silverEdge=smoothstep(0.64,0.78,cloudDensity)*cloudBand*pow(sunDot,0.35)*0.22;",
      "sky=mix(sky,cloudShade,cloudAlpha);",
      "sky+=vec3(1.0,0.84,0.67)*silverEdge;",
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
    "float front=p.y-uTideZ;",
    "float g1=exp(-pow(front/72.0,2.0));",
    "float f2=front*0.024-t*0.55;",
    "float g2=exp(-pow((front+105.0)/85.0,2.0));",
    "float tideShape=0.62*g1+0.10*g2*sin(f2);",
    "float tideSlope=0.62*g1*(-2.0*front/(72.0*72.0))+0.10*g2*(-2.0*(front+105.0)/(85.0*85.0))*sin(f2)+0.10*g2*0.024*cos(f2);",
    "height+=lateral*tideShape;",
    "float lateralDx=-8.0*pow(lateralX,7.0)/780.0*lateral;",
    "dYdx+=lateralDx*tideShape;",
    "dYdz+=lateral*tideSlope;",
    "float softHeight=tanh(height/0.11);",
    "float verticalScale=1.0-softHeight*softHeight;",
    "height=0.11*softHeight;",
    "dYdx*=verticalScale;",
    "dYdz*=verticalScale;",
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
    "uniform float uWaterLevel;",
    "uniform float uWaterDepth;",
    "uniform float uUnderwaterView;",
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
    "vec2 cloudUV=d.xz/(max(0.18,d.y+0.16))*2.05+vec2(uTime*0.0032,-uTime*0.00135);",
    "float cloudWarp=fbm(cloudUV*1.35);",
    "float cloudBody=fbm(cloudUV*3.15+vec2(cloudWarp*0.6,-uTime*0.002));",
    "float cloudDetail=fbm(cloudUV*6.8+vec2(-uTime*0.004,uTime*0.0018));",
    "float cloudDensity=cloudBody*0.76+cloudDetail*0.24;",
    "float clouds=smoothstep(0.505,0.665,cloudDensity)*smoothstep(-0.035,0.13,d.y)*(1.0-smoothstep(0.61,0.88,d.y));",
    "float cirrus=smoothstep(0.61,0.75,fbm(cloudUV*9.5+vec2(31.0,8.0)))*smoothstep(0.08,0.48,d.y)*0.16;",
    "vec3 cloudColor=mix(vec3(0.25,0.34,0.38),vec3(0.98,0.91,0.79),smoothstep(0.0,0.62,dot(normalize(d),normalize(uSunDir))));",
    "sky=mix(sky,cloudColor,clamp(clouds*0.88+cirrus,0.0,0.94));",

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
    // Shallow transmitted view of the sand with refractive caustic light drifting across it.
    "vec2 sandUV=p*0.19;",
    "float sandRidge=0.5+0.5*sin(sandUV.y*13.0+sin(sandUV.x*4.2+uTime*0.08)*1.65);",
    "float sandGrain=fbm(sandUV*2.7+vec2(4.2,11.8));",
    "vec3 sandColor=mix(vec3(0.20,0.20,0.16),vec3(0.57,0.52,0.40),clamp(sandRidge*0.58+sandGrain*0.42,0.0,1.0));",
    "float causticA=sin(sandUV.x*8.1+sin(sandUV.y*5.3+uTime*1.25)*1.55);",
    "float causticB=sin(sandUV.y*7.4+sin(sandUV.x*4.6-uTime*1.05)*1.42);",
    "float causticVein=pow(clamp(1.0-abs(causticA*causticB),0.0,1.0),6.0);",
    "float causticSoft=fbm(sandUV*4.0+vec2(-uTime*0.11,uTime*0.07));",
    "float causticEnergy=clamp(causticVein*(0.70+causticSoft*0.65),0.0,1.2);",
    "vec3 sandLit=sandColor*(0.72+causticEnergy*1.15);",
    "float bottomVisibility=exp(-uWaterDepth*1.35/max(nDotV,0.18));",
    "float bottomMix=(1.0-fresnel)*bottomVisibility*0.34*uUnderwaterView;",
    "water=mix(water,sandLit,bottomMix);",
    // Foam appears where the Gerstner mapping compresses and is carried by moving surface turbulence.
    "float foamNoise=fbm(p*0.041+vec2(-uTime*0.055,uTime*0.031));",
    "float foamGrain=noise(p*0.19+vec2(-uTime*0.15,uTime*0.095));",
    "float compressionFoam=smoothstep(0.10,0.34,vCompression);",
    "float localCrest=smoothstep(0.10,0.18,vHeight);",
    "float tideFront=p.y-uTideZ;",
    "float tideCrest=exp(-pow(tideFront/22.0,2.0));",
    "float crestFoam=tideCrest*smoothstep(0.28,0.64,foamNoise);",
    "float foamRibbons=smoothstep(0.60,0.78,noise(p*0.075+vec2(-uTime*0.08,uTime*0.05)))*localCrest;",
    "float whitecap=clamp(compressionFoam*(0.18+0.82*smoothstep(0.30,0.70,foamNoise))+crestFoam*0.92+foamRibbons*0.18,0.0,0.86);",
    "whitecap*=0.48+0.52*smoothstep(0.18,0.84,foamGrain);",
    "float bubbles=smoothstep(0.68,0.91,noise(p*0.25+vec2(-uTime*0.18,uTime*0.12)))*whitecap;",
    "vec3 foamColor=vec3(0.72,0.86,0.86)+vec3(0.10,0.10,0.08)*nDotL;",
    "water=mix(water,foamColor,clamp(whitecap+bubbles*0.24,0.0,0.92));",
    "float underwaterView=uUnderwaterView;",
    "water=mix(water,vec3(0.018,0.115,0.145),underwaterView*0.44);",
    "float distanceToCamera=length(cameraPosition-vWorldPos);",
    "float fog=1.0-exp(-pow(distanceToCamera*0.00052,2.0));",
    "vec3 horizon=vec3(0.50,0.58,0.57);water=mix(water,horizon,clamp(fog,0.0,0.82));",
    "gl_FragColor=vec4(water,mix(1.0,0.42,uUnderwaterView));",
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
      uWaterLevel: { value: WATER_LEVEL },
      uWaterDepth: { value: WATER_DEPTH_MEAN },
      uUnderwaterView: { value: 0 },
      uSunDir: { value: SUN_DIR.clone() },
      uWaveData: { value: waveUniforms },
      uWaveMotion: { value: motionUniforms }
    },
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false
  });
  const ocean = new THREE.Mesh(geometry, material);
  ocean.frustumCulled = false;
  ocean.renderOrder = 1;
  scene.add(ocean);
  return ocean;
}
const ocean = createOcean();

function createSeabed() {
  const canvasSize = 512;
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = canvasSize;
  const colorContext = colorCanvas.getContext("2d");
  const colorImage = colorContext.createImageData(canvasSize, canvasSize);
  const heightCanvas = document.createElement("canvas");
  heightCanvas.width = heightCanvas.height = canvasSize;
  const heightContext = heightCanvas.getContext("2d");
  const heightImage = heightContext.createImageData(canvasSize, canvasSize);

  for (let y = 0; y < canvasSize; y++) {
    for (let x = 0; x < canvasSize; x++) {
      const index = (y * canvasSize + x) * 4;
      const ridge = Math.sin(y * 0.19 + Math.sin(x * 0.028) * 2.2 +
        Math.sin(y * 0.035 + x * 0.017) * 1.1);
      const grain = Math.sin(x * 12.9898 + y * 78.233) *
        Math.sin(x * 0.173 + y * 0.137);
      const patches = Math.sin(x * 0.036 + Math.sin(y * 0.022) * 1.6) * 0.5;
      const luminance = 116 + ridge * 10 + grain * 8 + patches * 7;
      colorImage.data[index] = luminance * 1.02;
      colorImage.data[index + 1] = luminance * 1.05;
      colorImage.data[index + 2] = luminance * 0.91;
      colorImage.data[index + 3] = 255;
      const relief = 128 + ridge * 34 + grain * 22 + patches * 14;
      heightImage.data[index] = relief;
      heightImage.data[index + 1] = relief;
      heightImage.data[index + 2] = relief;
      heightImage.data[index + 3] = 255;
    }
  }
  colorContext.putImageData(colorImage, 0, 0);
  heightContext.putImageData(heightImage, 0, 0);

  // Sparse stones and shell fragments break up the fine sand ripples.
  let seed = 9137;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 190; i++) {
    const x = random() * canvasSize;
    const y = random() * canvasSize;
    const radius = 1.0 + random() * 4.2;
    colorContext.beginPath();
    colorContext.fillStyle = random() > 0.48 ? "rgba(42,58,55,0.25)" : "rgba(221,213,184,0.22)";
    colorContext.ellipse(x, y, radius * (0.7 + random() * 0.8), radius, random() * Math.PI, 0, Math.PI * 2);
    colorContext.fill();
  }

  const colorTexture = new THREE.CanvasTexture(colorCanvas);
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.wrapS = colorTexture.wrapT = THREE.RepeatWrapping;
  colorTexture.repeat.set(52, 52);
  colorTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

  const heightTexture = new THREE.CanvasTexture(heightCanvas);
  heightTexture.wrapS = heightTexture.wrapT = THREE.RepeatWrapping;
  heightTexture.repeat.copy(colorTexture.repeat);
  heightTexture.anisotropy = colorTexture.anisotropy;

  const geometry = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0xa0a69a,
    map: colorTexture,
    bumpMap: heightTexture,
    bumpScale: 0.075,
    roughness: 0.96,
    metalness: 0.0,
    side: THREE.DoubleSide
  });
  const floor = new THREE.Mesh(geometry, material);
  floor.position.set(0, GROUND_Y, 0);
  floor.receiveShadow = true;
  floor.frustumCulled = false;
  scene.add(floor);
  return { mesh: floor, colorTexture, heightTexture };
}
const seabed = createSeabed();

function createCaustics() {
  const geometry = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector2(0, 0) },
      uVisibility: { value: 0 }
    },
    vertexShader: [
      "varying vec2 vUv;",
      "void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}"
    ].join("\n"),
    fragmentShader: [
      "uniform float uTime;",
      "uniform vec2 uOrigin;",
      "uniform float uVisibility;",
      "varying vec2 vUv;",
      "void main(){",
      "vec2 p=(vUv-0.5)*3000.0+uOrigin;",
      "vec2 q=p*0.105;",
      "float a=sin(q.x*8.1+sin(q.y*5.3+uTime*1.25)*1.55);",
      "float b=sin(q.y*7.4+sin(q.x*4.6-uTime*1.05)*1.42);",
      "float veins=pow(clamp(1.0-abs(a*b),0.0,1.0),6.0);",
      "float detail=0.65+0.35*sin(q.x*2.4+q.y*3.1+uTime*0.72);",
      "float intensity=clamp(veins*detail,0.0,1.0);",
      "gl_FragColor=vec4(vec3(0.46,0.83,0.83),intensity*0.27*uVisibility);",
      "}"
    ].join("\n"),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = GROUND_Y + 0.018;
  mesh.frustumCulled = false;
  mesh.renderOrder = 0.5;
  scene.add(mesh);
  return { mesh, material };
}
const caustics = createCaustics();

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
    const thigh=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.145,0.48,16),suit);
    thigh.position.y=-0.24;pivot.add(thigh);
    const knee=new THREE.Mesh(new THREE.SphereGeometry(0.145,14,12),orange);
    knee.position.y=-0.49;pivot.add(knee);
    const kneeGuard=new THREE.Mesh(new THREE.SphereGeometry(0.13,12,10),dark);
    kneeGuard.position.set(0,-0.48,-0.115);kneeGuard.scale.set(0.92,0.78,0.34);pivot.add(kneeGuard);
    const shin=new THREE.Mesh(new THREE.CylinderGeometry(0.125,0.15,0.49,14),suit);
    shin.position.y=-0.735;pivot.add(shin);
    const shinSeal=new THREE.Mesh(new THREE.TorusGeometry(0.132,0.027,7,18),orange);
    shinSeal.position.y=-0.89;pivot.add(shinSeal);
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
  const surfaceY = waveHeight(player.position.x, player.position.z, simulationTime);
  const waterDepth = THREE.MathUtils.clamp(surfaceY - GROUND_Y, 0.12, 1.30);
  const pressure = 1 - THREE.MathUtils.smoothstep(tide.distance, 45, 220);
  const currentX = Math.sin(player.position.z * 0.018 + simulationTime * 0.21) * 0.085;
  const currentZ = Math.cos(player.position.x * 0.015 - simulationTime * 0.18) * 0.075;
  const tideFlow = tide.approaching ? pressure * 0.72 : -pressure * 0.24;
  const maxSpeed = (keys.ShiftLeft || keys.ShiftRight) ? 2.65 : 1.95;
  const targetX = wish.x * maxSpeed + currentX;
  const targetZ = wish.z * maxSpeed + currentZ + tideFlow;
  const waterDragResponse = 3.2 / (1.0 + waterDepth * 0.8);
  const response = wish.lengthSq() > 0 ? waterDragResponse * 1.15 : waterDragResponse * 0.82;
  velocity.x += (targetX - velocity.x) * Math.min(1, response * dt);
  velocity.z += (targetZ - velocity.z) * Math.min(1, response * dt);

  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  const speedLimit = maxSpeed + 0.9;
  if (horizontalSpeed > speedLimit) velocity.multiplyScalar(speedLimit / horizontalSpeed);
  player.position.x += velocity.x * dt;
  player.position.z += velocity.z * dt;

  // Boots remain in contact with the seabed; only the suit's centre of mass bobs.
  player.position.y = GROUND_Y + 0.06;
  const lowView = firstPerson && !!(keys.ControlLeft || keys.ControlRight);
  if (spaceStrokeRequested) {
    velocity.x += forward.x * 0.9;
    velocity.z += forward.z * 0.9;
    spaceStrokeRequested = false;
    spawnSpray(player.position.x, player.position.z, 18);
    spawnRipple();
  }

  if (horizontalSpeed > 0.12) {
    const desiredYaw = Math.atan2(-velocity.x, -velocity.z);
    let difference = desiredYaw - explorer.root.rotation.y;
    difference = Math.atan2(Math.sin(difference), Math.cos(difference));
    explorer.root.rotation.y += difference * Math.min(1, dt * 6.8);
    walkPhase += dt * (2.2 + horizontalSpeed * 2.5);
    explorer.legPivots[0].rotation.x = Math.sin(walkPhase) * (lowView ? 0.26 : 0.42);
    explorer.legPivots[1].rotation.x = -Math.sin(walkPhase) * (lowView ? 0.26 : 0.42);
    explorer.armPivots[0].rotation.x = -Math.sin(walkPhase) * 0.22;
    explorer.armPivots[1].rotation.x = Math.sin(walkPhase) * 0.22;
    splashTimer += dt;
    rippleTimer += dt;
    if (splashTimer > (horizontalSpeed > 2.3 ? 0.23 : 0.34)) {
      spawnSpray(player.position.x, player.position.z, horizontalSpeed > 2.3 ? 8 : 5);
      splashTimer = 0;
    }
    if (rippleTimer > 0.46) {
      spawnRipple();
      rippleTimer = 0;
    }
  } else {
    explorer.legPivots.forEach(p => p.rotation.x *= Math.max(0, 1 - dt * 3.8));
    explorer.armPivots.forEach(p => p.rotation.x *= Math.max(0, 1 - dt * 3.8));
    splashTimer = 0;
    rippleTimer = 0;
  }

  const waveBob = THREE.MathUtils.clamp((surfaceY - WATER_LEVEL) * 0.18, -0.035, 0.035);
  const gaitBob = horizontalSpeed > 0.12 ? Math.abs(Math.sin(walkPhase * 2)) * 0.035 : 0;
  explorer.root.position.y = waveBob + gaitBob;
  explorer.root.rotation.x += ((lowView ? -0.10 : 0) - explorer.root.rotation.x) * Math.min(1, dt * 2.5);
  explorer.root.rotation.z += (THREE.MathUtils.clamp(-velocity.x * 0.025, -0.08, 0.08) - explorer.root.rotation.z) * Math.min(1, dt * 3.0);
  return horizontalSpeed;
}

const cameraTarget=new THREE.Vector3();
const cameraDesired=new THREE.Vector3();
function updateCamera(dt) {
  if (firstPerson) {
    const eyeY = player.position.y + ((keys.ControlLeft || keys.ControlRight) ? 0.30 : 1.42);
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
  cameraDesired.y = Math.max(cameraDesired.y, GROUND_Y + CAMERA_GROUND_CLEARANCE);
  camera.position.lerp(cameraDesired, Math.min(1, dt * (firstPerson ? 12 : 4.5)));
  camera.position.y = Math.max(camera.position.y, GROUND_Y + CAMERA_GROUND_CLEARANCE);
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

  ocean.position.set(player.position.x, WATER_LEVEL, player.position.z);
  seabed.mesh.position.set(player.position.x, GROUND_Y, player.position.z);
  caustics.mesh.position.set(player.position.x, GROUND_Y + 0.018, player.position.z);
  caustics.material.uniforms.uOrigin.value.set(player.position.x, player.position.z);
  caustics.material.uniforms.uTime.value = simulationTime;
  const seabedTileWorld = WATER_SIZE / 52;
  seabed.colorTexture.offset.set(player.position.x / seabedTileWorld, player.position.z / seabedTileWorld);
  seabed.heightTexture.offset.copy(seabed.colorTexture.offset);
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
  ocean.material.uniforms.uUnderwaterView.value = underwater ? 1 : 0;
  caustics.material.uniforms.uVisibility.value = underwater ? 1 : 0;
  underwaterOverlay.style.opacity = underwater ? "1" : "0";
  document.body.classList.toggle("tide-near", tide.distance < 260);

  telemetryTimer += dt;
  if (telemetryTimer > 0.12) {
    speedValue.textContent = speed.toFixed(1) + " m/s";
    const depthAboveSeabed = surfaceY - GROUND_Y;
    waveValue.textContent = depthAboveSeabed.toFixed(2) + " m";
    tideValue.textContent = tide.approaching ? "ACERCÁNDOSE" : "RETIRÁNDOSE";
    tideDistanceValue.textContent = Math.round(tide.distance) + " m";
    stateValue.textContent = (firstPerson && (keys.ControlLeft || keys.ControlRight)) ? "VISTA SUBMARINA" : "AGUA A LA CINTURA";
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
player.position.set(0,GROUND_Y+0.06,0);
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

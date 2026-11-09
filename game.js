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
const soundToggle = document.getElementById("soundToggle");
const journalToggle = document.getElementById("journalToggle");
const journalOverlay = document.getElementById("journal");
const journalClose = document.getElementById("journalClose");
const journalList = document.getElementById("journalList");
const journalProgress = document.getElementById("journalProgress");
const scanPrompt = document.getElementById("scanPrompt");
const scanTitle = document.getElementById("scanTitle");
const scanDetail = document.getElementById("scanDetail");
const scanAction = document.getElementById("scanAction");
const scanProgressWrap = document.getElementById("scanProgressWrap");
const scanProgressFill = document.getElementById("scanProgressFill");
const scanToast = document.getElementById("scanToast");
const scanToastTitle = document.getElementById("scanToastTitle");
const scanToastDetail = document.getElementById("scanToastDetail");
const signalNav = document.getElementById("signalNav");
const signalNavArrow = document.getElementById("signalNavArrow");
const signalNavTitle = document.getElementById("signalNavTitle");
const signalNavDistance = document.getElementById("signalNavDistance");

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
let journalOpen = false;
let pointerLocked = false;
let hadPointerLock = false;
let dragging = false;
let lastPointer = { x: 0, y: 0 };
let cameraYaw = 0.12;
let cameraPitch = 0.19;
const cameraDistance = 13.5;
const CAMERA_MOUSE_SENSITIVITY = 0.0046;
const CAMERA_PITCH_SENSITIVITY = 0.0032;
const CAMERA_THIRD_PERSON_RESPONSE = 11.5;
const CAMERA_FIRST_PERSON_RESPONSE = 22.0;
const CAMERA_LOOK_THIRD_RESPONSE = 14.5;
const CAMERA_LOOK_FIRST_RESPONSE = 23.0;
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
let ambientSprayTimer = 0;
let ambientMixTimer = 0;

const weatherState = {
  wind: 0.55,
  gust: 0,
  cloudCover: 0.42,
  mist: 0.16,
  windDirection: new THREE.Vector2(0.84,-0.54).normalize(),
  sunDirection: SUN_DIR.clone()
};

function updateWorldWeather(){
  const t=simulationTime;
  const slowWind=0.5+0.5*Math.sin(t*0.017-0.8);
  const gustWave=Math.max(0,Math.sin(t*0.105+0.7)*0.64+Math.sin(t*0.041-1.2)*0.36);
  const gust=Math.pow(gustWave,4.0);
  weatherState.gust=gust;
  weatherState.wind=THREE.MathUtils.clamp(0.32+slowWind*0.35+gust*0.55,0.24,1.24);
  weatherState.cloudCover=THREE.MathUtils.clamp(0.28+0.48*(0.5+0.5*Math.sin(t*0.013+1.6)),0.18,0.88);
  weatherState.mist=THREE.MathUtils.clamp(0.07+0.19*(0.5+0.5*Math.sin(t*0.021-0.5))+gust*0.07,0.05,0.36);
  weatherState.windDirection.set(
    0.84+Math.sin(t*0.009)*0.18,
    -0.54+Math.cos(t*0.007)*0.13
  ).normalize();
  weatherState.sunDirection.set(
    SUN_DIR.x+Math.sin(t*0.00115)*0.055,
    SUN_DIR.y+Math.sin(t*0.00165+0.7)*0.035,
    SUN_DIR.z
  ).normalize();
}

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
  { wavelength: 110, angle: -12, phase: 0.4 },
  { wavelength: 88, angle: 7, phase: 2.2 },
  { wavelength: 72, angle: -20, phase: 4.1 },
  { wavelength: 60, angle: 15, phase: 1.5 },
  { wavelength: 50, angle: -29, phase: 3.2 },
  { wavelength: 43, angle: 24, phase: 5.1 },
  { wavelength: 38, angle: -38, phase: 0.9 },
  { wavelength: 34, angle: 32, phase: 2.8 },
  { wavelength: 31, angle: -45, phase: 4.7 },
  { wavelength: 28, angle: 40, phase: 1.9 }
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
  const verticalLimit = 0.14;
  const normalizedHeight = height / verticalLimit;
  const boundedHeight = verticalLimit * normalizedHeight /
    Math.sqrt(1 + normalizedHeight * normalizedHeight);
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
      "uniform float uWindStrength;",
      "uniform vec2 uWindDirection;",
      "uniform float uCloudCover;",
      "uniform float uMist;",
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
      "vec2 wind=uWindDirection*uTime*(0.0014+uWindStrength*0.0021);",
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
      "float cloudAlpha=clamp(cumulus*(0.68+uCloudCover*0.34)+cirrus*(0.62+uCloudCover*0.22),0.0,0.96);",
      "float sunFacing=clamp(dot(normalize(vec3(d.x,max(d.y,0.12),d.z)),normalize(uSunDir)),0.0,1.0);",
      "vec3 cloudShade=mix(vec3(0.25,0.34,0.38),vec3(0.98,0.91,0.79),smoothstep(0.02,0.70,sunFacing));",
      "cloudShade+=vec3(0.12,0.15,0.17)*(1.0-smoothstep(0.0,0.38,d.y));",
      "float silverEdge=smoothstep(0.64,0.78,cloudDensity)*cloudBand*pow(sunDot,0.35)*0.22;",
      "sky=mix(sky,cloudShade,cloudAlpha);",
      "sky+=vec3(1.0,0.84,0.67)*silverEdge;",
      "float mistField=fbm2(skyUV*1.65+wind*1.75);",
      "float lowMist=(1.0-smoothstep(0.025,0.25,d.y))*smoothstep(0.32,0.62,mistField)*uMist;",
      "sky=mix(sky,vec3(0.61,0.70,0.70),clamp(lowMist*0.38,0.0,0.30));",
      "gl_FragColor=vec4(sky,1.0);",
      "#include <tonemapping_fragment>",
      "#include <colorspace_fragment>",
      "}"
    ].join("\n"),
    uniforms: {
      uSunDir: { value: SUN_DIR.clone() },
      uTime: { value: 0 },
      uWindStrength: { value: 0.55 },
      uWindDirection: { value: new THREE.Vector2(0.84,-0.54).normalize() },
      uCloudCover: { value: 0.42 },
      uMist: { value: 0.16 }
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
  const segments = MOBILE ? 360 : 560;
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
    "float waveRatio=height/0.14;",
    "float waveRoot=sqrt(1.0+waveRatio*waveRatio);",
    "float softHeight=waveRatio/waveRoot;",
    "float verticalScale=1.0/pow(1.0+waveRatio*waveRatio,1.5);",
    "height=0.14*softHeight;",
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
    "uniform float uWindStrength;",
    "uniform vec2 uWindDirection;",
    "uniform vec4 uWakeData[8];",
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
    "vec2 cloudUV=d.xz/(max(0.18,d.y+0.16))*2.05+uWindDirection*uTime*(0.0014+uWindStrength*0.0021);",
    "float cloudWarp=fbm(cloudUV*1.35);",
    "float cloudBody=fbm(cloudUV*3.15+vec2(cloudWarp*0.6,-uTime*0.002));",
    "float cloudDetail=fbm(cloudUV*6.8+vec2(-uTime*0.004,uTime*0.0018));",
    "float cloudDensity=cloudBody*0.76+cloudDetail*0.24;",
    "float clouds=smoothstep(0.505,0.665,cloudDensity)*smoothstep(-0.035,0.13,d.y)*(1.0-smoothstep(0.61,0.88,d.y));",
    "float cirrus=smoothstep(0.61,0.75,fbm(cloudUV*9.5+vec2(31.0,8.0)))*smoothstep(0.08,0.48,d.y)*0.16;",
    "vec3 cloudColor=mix(vec3(0.25,0.34,0.38),vec3(0.98,0.91,0.79),smoothstep(0.0,0.62,dot(normalize(d),normalize(uSunDir))));",
    "sky=mix(sky,cloudColor,clamp(clouds*0.88+cirrus,0.0,0.94));",
    "float sun=max(dot(normalize(d),normalize(uSunDir)),0.0);",
    "sky+=vec3(1.0,0.78,0.56)*(pow(sun,620.0)*2.1+pow(sun,34.0)*0.30);",
    "return sky;}",
    "float distributionGGX(float nDotH,float roughness){float a=roughness*roughness;float a2=a*a;float d=nDotH*nDotH*(a2-1.0)+1.0;return a2/max(3.14159265*d*d,0.00001);}",
    "float geometrySchlickGGX(float nDotX,float roughness){float r=roughness+1.0;float k=r*r*0.125;return nDotX/max(nDotX*(1.0-k)+k,0.00001);}",
    "void main(){",
    "vec2 p=vWorldXZ;vec3 N=normalize(vWaveNormal);",
    // Small-scale travelling ripples influence the reflected highlights without overloading the mesh.
    "float windRate=0.76+uWindStrength*0.58;",
    "float ph1=dot(p,vec2(0.83,0.55))*0.72+dot(p,uWindDirection)*0.035-uTime*1.90*windRate;",
    "float ph2=dot(p,vec2(-0.44,0.90))*1.35+uTime*3.20*windRate;",
    "float ph3=dot(p,vec2(0.96,-0.27))*2.25+dot(p,uWindDirection)*0.08-uTime*5.00*windRate;",
    "float ph4=dot(p,vec2(-0.72,-0.69))*3.75+uTime*7.10*windRate;",
    "float ph5=dot(p,vec2(0.18,0.98))*5.80+dot(p,uWindDirection)*0.12-uTime*9.40*windRate;",
    "float ph6=dot(p,vec2(-0.95,0.31))*8.20+uTime*12.30*windRate;",
    "vec2 microSlope=vec2(",
    "0.085*0.72*0.83*cos(ph1)+0.050*1.35*(-0.44)*cos(ph2)+0.025*2.25*0.96*cos(ph3)+0.012*3.75*(-0.72)*cos(ph4)+0.006*5.80*0.18*cos(ph5)+0.003*8.20*(-0.95)*cos(ph6),",
    "0.085*0.72*0.55*cos(ph1)+0.050*1.35*0.90*cos(ph2)+0.025*2.25*(-0.27)*cos(ph3)+0.012*3.75*(-0.69)*cos(ph4)+0.006*5.80*0.98*cos(ph5)+0.003*8.20*0.31*cos(ph6));",
    "vec2 windAxis=normalize(uWindDirection);",
    "vec2 crossAxis=vec2(-windAxis.y,windAxis.x);",
    "float capillaryA=dot(p,windAxis)*11.8+dot(p,crossAxis)*1.9-uTime*(7.4+uWindStrength*4.0);",
    "float capillaryB=dot(p,windAxis)*19.5-dot(p,crossAxis)*5.4+uTime*(10.8+uWindStrength*5.2);",
    "float capillaryC=dot(p,crossAxis)*14.0-dot(p,windAxis)*4.1-uTime*(8.6+uWindStrength*4.8);",
    "vec2 capillaryGradA=windAxis*11.8+crossAxis*1.9;",
    "vec2 capillaryGradB=windAxis*19.5-crossAxis*5.4;",
    "vec2 capillaryGradC=crossAxis*14.0-windAxis*4.1;",
    "vec2 capillarySlope=capillaryGradA*(0.007*cos(capillaryA))+capillaryGradB*(0.0035*cos(capillaryB))+capillaryGradC*(0.0045*cos(capillaryC));",
    "float capillaryGrain=0.5+0.5*sin(capillaryA*0.42+sin(capillaryB*0.28)*0.85);",
    "vec2 wakeSlope=vec2(0.0);",
    "float wakeFoam=0.0;",
    "for(int i=0;i<8;i++){",
    "vec4 wake=uWakeData[i];",
    "if(wake.w>0.001){",
    "vec2 offset=p-wake.xy;",
    "float radius=length(offset);",
    "float ringRadius=0.42+wake.z*3.35;",
    "float delta=radius-ringRadius;",
    "float envelope=exp(-delta*delta/0.48)*exp(-wake.z*0.92)*wake.w;",
    "float phase=delta*3.4;",
    "float derivative=0.105*envelope*(3.8*cos(phase)-(2.0*delta/0.48)*sin(phase));",
    "wakeSlope+=derivative*offset/max(radius,0.02);",
    "wakeFoam=max(wakeFoam,envelope);",
    "}",
    "}",
    "N=normalize(N+vec3(-microSlope.x-capillarySlope.x-wakeSlope.x,0.0,-microSlope.y-capillarySlope.y-wakeSlope.y));",
    "vec3 V=normalize(cameraPosition-vWorldPos);vec3 L=normalize(uSunDir);vec3 H=normalize(V+L);",
    "float nDotV=max(dot(N,V),0.001);float nDotL=max(dot(N,L),0.0);",
    "float nDotH=max(dot(N,H),0.0);float vDotH=max(dot(V,H),0.0);",
    "float fresnel=0.02037+(1.0-0.02037)*pow(1.0-nDotV,5.0);",
    "vec3 reflected=skyReflection(reflect(-V,N));",
    "float microRough=fbm(p*0.095+vec2(uTime*0.042,-uTime*0.031));",
    "float detailRough=fbm(p*0.24+vec2(-uTime*0.085,uTime*0.063));",
    "float slopeRough=length(microSlope);",
    "float roughness=clamp(0.145+microRough*0.10+detailRough*0.055+slopeRough*0.20+vCompression*0.095,0.13,0.46);",
    "float D=distributionGGX(nDotH,roughness);",
    "float G=geometrySchlickGGX(nDotV,roughness)*geometrySchlickGGX(max(nDotL,0.001),roughness);",
    "vec3 F=vec3(0.02037)+(vec3(1.0)-vec3(0.02037))*pow(1.0-vDotH,5.0);",
    "vec3 directSpec=D*G*F/max(4.0*nDotV*max(nDotL,0.001),0.001)*nDotL*vec3(1.0,0.86,0.68)*2.2;",
    "float mirrorSun=max(dot(reflect(-L,N),V),0.0);",
    "float sunStreak=pow(mirrorSun,78.0);",
    "float broadSun=pow(mirrorSun,20.0);",
    "float glintBreakup=0.42+0.98*noise(p*0.16+vec2(-uTime*0.12,uTime*0.08));",
    "float capillarySparkle=pow(max(mirrorSun,0.0),190.0)*smoothstep(0.38,0.92,capillaryGrain)*noise(p*0.72+vec2(-uTime*0.26,uTime*0.19));",
    "vec3 movingSunGlints=vec3(1.0,0.86,0.69)*(sunStreak*1.05+broadSun*0.11+capillarySparkle*0.34)*glintBreakup;",
    // Beer-Lambert-inspired attenuation plus blue-green in-scattering color the transmitted light.
    "float opticalPath=2.8/max(nDotV,0.14);",
    "vec3 attenuation=exp(-vec3(0.23,0.075,0.030)*opticalPath);",
    "vec3 waterBody=mix(vec3(0.006,0.065,0.082),vec3(0.040,0.235,0.275),1.0-dot(attenuation,vec3(0.3333)));",
    "waterBody+=vec3(0.014,0.060,0.072)*(0.38+0.62*nDotL);",
    "float reflectionWeight=clamp(fresnel,0.02037,0.96);",
    "vec3 water=mix(waterBody,reflected,reflectionWeight)+directSpec+movingSunGlints;",
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
    "vec2 foamFlow=p*0.052+uWindDirection*uTime*(0.025+uWindStrength*0.035);",
    "float foamNoise=fbm(foamFlow);",
    "float foamDetail=fbm(foamFlow*3.6+vec2(uTime*0.075,-uTime*0.052));",
    "float foamGrain=noise(p*0.22+vec2(-uTime*0.17,uTime*0.11));",
    "float compressionFoam=smoothstep(0.13,0.36,vCompression);",
    "float localCrest=smoothstep(0.035,0.115,vHeight);",
    "float tideFront=p.y-uTideZ;",
    "float tideCrest=exp(-pow(tideFront/22.0,2.0));",
    "float crestBreakup=smoothstep(0.43,0.69,foamNoise+0.18*(foamDetail-0.5));",
    "float crestFoam=localCrest*crestBreakup*0.28;",
    "float tideFoam=tideCrest*smoothstep(0.44,0.70,foamNoise)*0.36;",
    "float foamRibbons=smoothstep(0.58,0.78,noise(p*0.085+vec2(-uTime*0.095,uTime*0.064)))*localCrest*0.22;",
    "float whitecap=clamp(compressionFoam*(0.16+0.84*crestBreakup)+crestFoam+tideFoam+foamRibbons,0.0,0.82);",
    "whitecap*=0.42+0.58*smoothstep(0.16,0.86,foamGrain);",
    "float bubbles=smoothstep(0.68,0.91,noise(p*0.25+vec2(-uTime*0.18,uTime*0.12)))*whitecap;",
    "vec3 foamColor=vec3(0.72,0.86,0.86)+vec3(0.10,0.10,0.08)*nDotL;",
    "water=mix(water,foamColor,clamp(whitecap+bubbles*0.24,0.0,0.92));",
    "float wakeFoamNoise=noise(p*0.24+vec2(-uTime*0.18,uTime*0.13));",
    "float brokenWakeFoam=wakeFoam*smoothstep(0.31,0.66,wakeFoamNoise);",
    "float wakeFoamFlecks=noise(p*0.46+vec2(-uTime*0.22,uTime*0.17));",
    "float wakeFoamMask=brokenWakeFoam*smoothstep(0.28,0.76,wakeFoamFlecks);",
    "water=mix(water,vec3(0.86,0.96,0.96),clamp(wakeFoamMask*0.88,0.0,0.78));",
    "float underwaterView=uUnderwaterView;",
    "water=mix(water,vec3(0.018,0.115,0.145),underwaterView*0.44);",
    "float distanceToCamera=length(cameraPosition-vWorldPos);",
    "float fog=1.0-exp(-pow(distanceToCamera*0.00052,2.0));",
    "vec3 horizon=vec3(0.50,0.58,0.57);water=mix(water,horizon,clamp(fog,0.0,0.82));",
    "gl_FragColor=vec4(water,mix(1.0,0.58,uUnderwaterView));",
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
      uWindStrength: { value: 0.55 },
      uWindDirection: { value: new THREE.Vector2(0.84,-0.54).normalize() },
      uWakeData: { value: Array.from({length:8},()=>new THREE.Vector4(0,0,0,0)) },
      uSunDir: { value: SUN_DIR.clone() },
      uWaveData: { value: waveUniforms },
      uWaveMotion: { value: motionUniforms }
    },
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true
  });
  const ocean = new THREE.Mesh(geometry, material);
  ocean.frustumCulled = false;
  ocean.renderOrder = 1;
  scene.add(ocean);
  return ocean;
}
const ocean = createOcean();

function createOceanUnderlay() {
  const geometry = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x0b5b69,
    roughness: 0.30,
    metalness: 0.035,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = WATER_LEVEL - 0.16;
  mesh.frustumCulled = false;
  mesh.renderOrder = 0.8;
  scene.add(mesh);
  return mesh;
}
const oceanUnderlay = createOceanUnderlay();

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
  const trim = mat(0x9eafb0,0.34,0.48);
  const panel = mat(0x263d48,0.52,0.34);
  const rubber = mat(0x101c22,0.82,0.02);
  const amberGlow = new THREE.MeshBasicMaterial({color:0xffb66d});
  const softGlow = new THREE.MeshBasicMaterial({color:0x9deeff});
  const visorGlint = new THREE.MeshBasicMaterial({color:0xd9f7ff,transparent:true,opacity:0.34,depthWrite:false});

  const addPart=(geometry,material,position,parent=root)=>{
    const mesh=new THREE.Mesh(geometry,material);
    mesh.position.set(position[0],position[1],position[2]);
    parent.add(mesh);
    return mesh;
  };

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.40,0.48,1.12,18,1), suit);
  torso.position.y = 1.66; root.add(torso);
  const upper = new THREE.Mesh(new THREE.SphereGeometry(0.42,20,16), suit);
  upper.position.set(0,2.12,0); upper.scale.set(1,0.52,0.92); root.add(upper);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.42,18,14), dark);
  pelvis.position.y=1.04;pelvis.scale.set(1,0.7,0.85);root.add(pelvis);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.405,0.055,8,32),orange);
  belt.position.y=1.17;root.add(belt);

  const headPivot = new THREE.Group();
  headPivot.position.set(0,2.42,0);
  root.add(headPivot);
  const addHeadPart=(geometry,material,position)=>{
    const mesh=new THREE.Mesh(geometry,material);
    mesh.position.set(position[0],position[1]-2.42,position[2]);
    headPivot.add(mesh);
    return mesh;
  };
  const helmet = addHeadPart(new THREE.SphereGeometry(0.42,28,22),suit,[0,2.72,0]);
  const visorMesh = addHeadPart(new THREE.SphereGeometry(0.335,28,20),glass,[0,2.73,-0.16]);
  visorMesh.scale.set(0.9,0.82,0.42);
  const visorLine = addHeadPart(new THREE.TorusGeometry(0.365,0.025,8,36),orange,[0,2.73,-0.05]);
  visorLine.scale.set(1,0.95,0.72);
  const antenna = addHeadPart(new THREE.CylinderGeometry(0.025,0.04,0.34,8),dark,[0.24,3.1,0.02]);
  const antennaLight = addHeadPart(new THREE.SphereGeometry(0.055,10,8),glow,[0.24,3.28,0.02]);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.72,0.92,0.36),orange);
  backpack.position.set(0,1.78,0.48);root.add(backpack);
  const packTop = new THREE.Mesh(new THREE.BoxGeometry(0.56,0.12,0.28),dark);
  packTop.position.set(0,2.26,0.48);root.add(packTop);
  for(let side of [-1,1]){
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.115,0.13,0.66,12),dark);
    tank.position.set(side*0.34,1.72,0.56);root.add(tank);
    // Shoulder armor is attached to the articulated shoulder pivot below.
  }

  const neckSeal=addPart(new THREE.CylinderGeometry(0.315,0.34,0.16,24),rubber,[0,2.42,0]);
  const neckRing=addPart(new THREE.TorusGeometry(0.325,0.035,8,36),trim,[0,2.42,0]);
  neckRing.rotation.x=Math.PI/2;
  const helmetLowerRing=addPart(new THREE.TorusGeometry(0.375,0.022,8,40),orange,[0,2.47,0]);
  helmetLowerRing.rotation.x=Math.PI/2;

  for(const side of [-1,1]){
    const commPod=addHeadPart(new THREE.CylinderGeometry(0.105,0.12,0.16,14),panel,[side*0.39,2.72,0.035]);
    commPod.rotation.z=Math.PI/2;
    const commCap=addHeadPart(new THREE.SphereGeometry(0.09,12,10),orange,[side*0.47,2.72,0.035]);
    commCap.scale.set(0.45,1,1);
  }
  const visorReflection=addHeadPart(new THREE.SphereGeometry(0.12,16,12),visorGlint,[-0.12,2.83,-0.292]);
  visorReflection.scale.set(0.85,0.22,0.10);
  visorReflection.rotation.z=-0.28;
  const visorStatus=addHeadPart(new THREE.SphereGeometry(0.035,10,8),glow,[0.27,2.58,-0.285]);

  const chestSeal=addPart(new THREE.CylinderGeometry(0.37,0.39,0.13,24),rubber,[0,2.34,0]);
  const chestCollar=addPart(new THREE.TorusGeometry(0.36,0.028,8,40),trim,[0,2.35,0]);
  chestCollar.rotation.x=Math.PI/2;

  const chestArmor=addPart(new THREE.BoxGeometry(0.52,0.48,0.075),panel,[0,1.80,-0.445]);
  const chestArmorEdge=addPart(new THREE.BoxGeometry(0.46,0.045,0.025),orange,[0,2.045,-0.493]);
  const chestScreen=addPart(new THREE.BoxGeometry(0.27,0.17,0.025),dark,[0,1.84,-0.495]);
  const screenFace=addPart(new THREE.BoxGeometry(0.22,0.115,0.012),mat(0x315a62,0.28,0.2),[0,1.85,-0.512]);
  for(let n=0;n<3;n++){
    addPart(new THREE.BoxGeometry(0.035,0.018,0.009),n===0?amberGlow:softGlow,[-0.065+n*0.065,1.85,-0.522]);
  }
  addPart(new THREE.BoxGeometry(0.16,0.018,0.012),glow,[0,1.75,-0.522]);
  for(const side of [-1,1]){
    addPart(new THREE.SphereGeometry(0.055,12,10),side===-1?amberGlow:softGlow,[side*0.205,1.98,-0.49]);
    const harness=new THREE.Mesh(new THREE.BoxGeometry(0.075,0.75,0.045),orange);
    harness.position.set(side*0.24,1.78,-0.418);
    harness.rotation.z=side*-0.16;
    root.add(harness);
    const hipPouch=addPart(new THREE.BoxGeometry(0.20,0.24,0.18),panel,[side*0.39,1.18,-0.02]);
    const pouchLatch=addPart(new THREE.BoxGeometry(0.10,0.035,0.025),orange,[side*0.39,1.22,-0.122]);
    hipPouchParts.push(hipPouch,pouchLatch);
  }

  const packFrame=addPart(new THREE.BoxGeometry(0.79,0.98,0.12),rubber,[0,1.78,0.685]);
  const packAccess=addPart(new THREE.BoxGeometry(0.49,0.48,0.045),panel,[0,1.81,0.765]);
  const packDisplay=addPart(new THREE.BoxGeometry(0.32,0.18,0.02),dark,[0,1.91,0.792]);
  for(let n=0;n<4;n++){
    addPart(new THREE.BoxGeometry(0.31,0.027,0.018),trim,[0,1.69-n*0.055,0.793]);
  }
  for(const side of [-1,1]){
    const rail=addPart(new THREE.BoxGeometry(0.055,0.78,0.27),orange,[side*0.37,1.78,0.50]);
    const packLight=addPart(new THREE.BoxGeometry(0.035,0.10,0.018),glow,[side*0.30,2.16,0.80]);
    const regulator=addPart(new THREE.CylinderGeometry(0.075,0.075,0.11,12),trim,[side*0.34,1.36,0.55]);
    regulator.rotation.x=Math.PI/2;

    const hoseCurve=new THREE.CatmullRomCurve3([
      new THREE.Vector3(side*0.30,2.22,0.63),
      new THREE.Vector3(side*0.48,2.37,0.45),
      new THREE.Vector3(side*0.55,2.24,0.15),
      new THREE.Vector3(side*0.49,2.02,-0.04)
    ]);
    const hose=new THREE.Mesh(new THREE.TubeGeometry(hoseCurve,22,0.035,8,false),rubber);
    root.add(hose);
    const hoseCoupler=addPart(new THREE.CylinderGeometry(0.065,0.065,0.10,12),orange,[side*0.49,2.02,-0.04]);
    hoseCoupler.rotation.x=Math.PI/2;
  }

  const lowerChestPort=addPart(new THREE.CylinderGeometry(0.075,0.075,0.05,14),orange,[0,1.47,-0.43]);
  lowerChestPort.rotation.x=Math.PI/2;

  const legPivots=[],kneePivots=[],anklePivots=[],toePivots=[];
  const hipPouchParts=[];
  const hipJointMaterial=mat(0x425b63,0.38,0.62);
  const bearingMaterial=mat(0xc28b5a,0.34,0.58);
  for(const side of [-1,1]){
    const hip=new THREE.Group();hip.position.set(side*0.22,0.94,0);root.add(hip);
    const hipBearing=new THREE.Mesh(new THREE.SphereGeometry(0.17,16,12),hipJointMaterial);
    hipBearing.position.set(0,-0.035,0);hip.add(hipBearing);
    const thigh=new THREE.Mesh(new THREE.CylinderGeometry(0.145,0.13,0.45,18),suit);
    thigh.position.y=-0.225;hip.add(thigh);
    const thighShell=new THREE.Mesh(new THREE.SphereGeometry(0.16,16,12),suit);
    thighShell.position.set(0,-0.22,-0.025);thighShell.scale.set(1,1.45,0.82);hip.add(thighShell);

    const kneePivot=new THREE.Group();kneePivot.position.y=-0.45;hip.add(kneePivot);
    const knee=new THREE.Mesh(new THREE.SphereGeometry(0.145,18,14),bearingMaterial);
    kneePivot.add(knee);
    const kneeCap=new THREE.Mesh(new THREE.SphereGeometry(0.135,16,12),orange);
    kneeCap.position.set(0,0,-0.105);kneeCap.scale.set(0.94,0.90,0.42);kneePivot.add(kneeCap);
    const kneeRing=new THREE.Mesh(new THREE.TorusGeometry(0.135,0.022,7,24),trim);
    kneeRing.rotation.x=Math.PI/2;kneeRing.position.set(0,0,-0.12);kneePivot.add(kneeRing);

    const shin=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.145,0.46,18),suit);
    shin.position.y=-0.23;kneePivot.add(shin);
    const shinGuard=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.30,0.07),panel);
    shinGuard.position.set(0,-0.23,-0.132);kneePivot.add(shinGuard);
    const shinIndicator=new THREE.Mesh(new THREE.BoxGeometry(0.075,0.024,0.018),glow);
    shinIndicator.position.set(0,-0.18,-0.17);kneePivot.add(shinIndicator);

    const anklePivot=new THREE.Group();anklePivot.position.y=-0.46;kneePivot.add(anklePivot);
    const ankleJoint=new THREE.Mesh(new THREE.SphereGeometry(0.105,14,12),hipJointMaterial);
    ankleJoint.position.y=0.005;anklePivot.add(ankleJoint);
    const ankleSeal=new THREE.Mesh(new THREE.TorusGeometry(0.115,0.025,7,20),bearingMaterial);
    ankleSeal.rotation.x=Math.PI/2;ankleSeal.position.y=0.015;anklePivot.add(ankleSeal);
    const boot=new THREE.Mesh(new THREE.BoxGeometry(0.32,0.18,0.47),dark);
    boot.position.set(0,-0.055,-0.055);anklePivot.add(boot);
    const bootSole=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.055,0.49),rubber);
    bootSole.position.set(0,-0.112,-0.055);anklePivot.add(bootSole);
    const toeCap=new THREE.Mesh(new THREE.BoxGeometry(0.29,0.09,0.13),trim);
    toeCap.position.set(0,-0.065,-0.245);anklePivot.add(toeCap);
    const bootStripe=new THREE.Mesh(new THREE.BoxGeometry(0.25,0.035,0.09),glow);
    bootStripe.position.set(0,0.012,-0.23);anklePivot.add(bootStripe);
    const toePivot=new THREE.Group();
    toePivot.position.set(0,-0.065,-0.22);
    anklePivot.add(toePivot);
    anklePivot.updateMatrixWorld(true);
    toePivot.updateMatrixWorld(true);
    toePivot.attach(toeCap);
    toePivot.attach(bootStripe);

    legPivots.push(hip);
    kneePivots.push(kneePivot);
    anklePivots.push(anklePivot);
    toePivots.push(toePivot);
  }

  const armPivots=[],elbowPivots=[],wristPivots=[];
  const handFingerPivots=[[],[]];
  for(const side of [-1,1]){
    const sideIndex=side===-1?0:1;
    const shoulder=new THREE.Group();shoulder.position.set(side*0.48,2.0,0);root.add(shoulder);
    const shoulderCover=new THREE.Mesh(new THREE.SphereGeometry(0.25,16,12),orange);
    shoulderCover.position.set(side*0.04,-0.02,0);
    shoulderCover.scale.set(1.0,0.94,0.96);
    shoulder.add(shoulderCover);
    const shoulderBearing=new THREE.Mesh(new THREE.SphereGeometry(0.17,16,12),hipJointMaterial);
    shoulderBearing.position.set(0,-0.02,0);shoulder.add(shoulderBearing);
    const upperArm=new THREE.Mesh(new THREE.CylinderGeometry(0.145,0.125,0.42,16),suit);
    upperArm.position.y=-0.21;shoulder.add(upperArm);
    const upperShell=new THREE.Mesh(new THREE.SphereGeometry(0.145,16,12),suit);
    upperShell.position.set(0,-0.20,-0.02);upperShell.scale.set(1,1.48,0.86);shoulder.add(upperShell);

    const elbowPivot=new THREE.Group();elbowPivot.position.y=-0.42;shoulder.add(elbowPivot);
    const elbowBearing=new THREE.Mesh(new THREE.SphereGeometry(0.125,16,12),bearingMaterial);
    elbowPivot.add(elbowBearing);
    const elbowCap=new THREE.Mesh(new THREE.SphereGeometry(0.12,14,12),orange);
    elbowCap.position.set(0,0,-0.095);elbowCap.scale.set(0.92,0.90,0.40);elbowPivot.add(elbowCap);
    const forearm=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.15,0.42,16),suit);
    forearm.position.y=-0.21;elbowPivot.add(forearm);
    const forearmGuard=new THREE.Mesh(new THREE.BoxGeometry(0.21,0.27,0.075),panel);
    forearmGuard.position.set(0,-0.22,-0.13);elbowPivot.add(forearmGuard);

    const wristPivot=new THREE.Group();wristPivot.position.y=-0.42;elbowPivot.add(wristPivot);
    const wristBearing=new THREE.Mesh(new THREE.SphereGeometry(0.09,14,12),hipJointMaterial);
    wristPivot.add(wristBearing);
    const wristSeal=new THREE.Mesh(new THREE.TorusGeometry(0.12,0.025,7,20),orange);
    wristSeal.rotation.x=Math.PI/2;wristSeal.position.y=-0.015;wristPivot.add(wristSeal);
    const glove=new THREE.Mesh(new THREE.SphereGeometry(0.145,14,12),dark);
    glove.position.set(0,-0.105,-0.025);glove.scale.set(0.88,1.0,0.92);wristPivot.add(glove);
    const glovePlate=new THREE.Mesh(new THREE.BoxGeometry(0.145,0.065,0.095),trim);
    glovePlate.position.set(0,-0.105,-0.145);wristPivot.add(glovePlate);

    // Flexible glove digits: two links per finger plus an opposable thumb.
    const handDigits=[];
    const fingerOffsets=[-0.078,-0.027,0.027,0.078];
    const fingerLengths=[0.086,0.098,0.091,0.078];
    for(let fingerIndex=0;fingerIndex<4;fingerIndex++){
      const fingerBase=new THREE.Group();
      fingerBase.position.set(fingerOffsets[fingerIndex],-0.17,-0.025);
      wristPivot.add(fingerBase);
      const proximalLength=fingerLengths[fingerIndex];
      const proximal=new THREE.Mesh(new THREE.CylinderGeometry(0.024,0.029,proximalLength,9),rubber);
      proximal.position.y=-proximalLength*0.5;
      fingerBase.add(proximal);
      const fingerTip=new THREE.Group();
      fingerTip.position.y=-proximalLength;
      fingerBase.add(fingerTip);
      const distalLength=proximalLength*0.72;
      const distal=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.023,distalLength,9),rubber);
      distal.position.y=-distalLength*0.5;
      fingerTip.add(distal);
      const fingertip=new THREE.Mesh(new THREE.SphereGeometry(0.021,9,8),dark);
      fingertip.position.y=-distalLength;
      fingerTip.add(fingertip);
      handDigits.push({base:fingerBase,distal:fingerTip});
    }
    const thumbBase=new THREE.Group();
    thumbBase.position.set(side*0.12,-0.115,-0.025);
    thumbBase.rotation.z=-side*0.62;
    wristPivot.add(thumbBase);
    const thumbSegment=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.032,0.085,9),rubber);
    thumbSegment.position.set(side*0.018,-0.042,-0.008);
    thumbBase.add(thumbSegment);
    const thumbTip=new THREE.Group();
    thumbTip.position.set(side*0.035,-0.078,-0.01);
    thumbBase.add(thumbTip);
    const thumbDistal=new THREE.Mesh(new THREE.CylinderGeometry(0.019,0.025,0.065,9),rubber);
    thumbDistal.position.set(side*0.012,-0.032,-0.006);
    thumbTip.add(thumbDistal);
    handDigits.push({base:thumbBase,distal:thumbTip});
    handFingerPivots[sideIndex]=handDigits;

    armPivots.push(shoulder);
    elbowPivots.push(elbowPivot);
    wristPivots.push(wristPivot);
  }
  const chestLight=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.12,0.035),glow);
  chestLight.position.set(0,1.77,-0.43);
  const chestPanel=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.36,0.045),dark);
  chestPanel.position.set(0,1.72,-0.44);root.add(chestPanel);
  chestPanel.add(chestLight);
  chestLight.position.set(0,0.055,-0.03);

  // Pelvis -> lumbar spine -> thorax -> neck/head. Keep original world pose.
  const pelvisPivot=new THREE.Group();
  pelvisPivot.position.set(0,1.04,0);
  root.add(pelvisPivot);
  const spinePivot=new THREE.Group();
  pelvisPivot.add(spinePivot);
  const thoraxPivot=new THREE.Group();
  thoraxPivot.position.set(0,0.80,0);
  spinePivot.add(thoraxPivot);
  root.updateMatrixWorld(true);
  pelvisPivot.updateMatrixWorld(true);
  spinePivot.updateMatrixWorld(true);
  thoraxPivot.updateMatrixWorld(true);

  pelvisPivot.attach(pelvis);
  pelvisPivot.attach(belt);
  for(const part of hipPouchParts)pelvisPivot.attach(part);
  for(const hip of legPivots)pelvisPivot.attach(hip);

  const thoraxParts=new Set([upper,headPivot,...armPivots]);
  const pelvisParts=new Set([pelvis,belt,...hipPouchParts,...legPivots]);
  for(const child of [...root.children]){
    if(child===pelvisPivot||pelvisParts.has(child)||thoraxParts.has(child))continue;
    spinePivot.attach(child);
  }
  thoraxPivot.attach(upper);
  thoraxPivot.attach(headPivot);
  for(const shoulder of armPivots)thoraxPivot.attach(shoulder);
  const headBaseY=headPivot.position.y;

  // Spring-damped joints add controlled inertia and respect anatomical ranges.
  const createJoint=(pivot,limits,stiffness=44)=>{
    const target=new THREE.Vector3(pivot.rotation.x,pivot.rotation.y,pivot.rotation.z);
    const velocity=new THREE.Vector3();
    const minimum=new THREE.Vector3(limits[0][0],limits[1][0],limits[2][0]);
    const maximum=new THREE.Vector3(limits[0][1],limits[1][1],limits[2][1]);
    const damping=2*Math.sqrt(stiffness)*0.98;
    return {
      pivot,target,velocity,
      set(x,y,z){
        target.set(
          THREE.MathUtils.clamp(x,minimum.x,maximum.x),
          THREE.MathUtils.clamp(y,minimum.y,maximum.y),
          THREE.MathUtils.clamp(z,minimum.z,maximum.z)
        );
      },
      update(dt){
        const elapsed=THREE.MathUtils.clamp(dt,0,0.08);
        const steps=Math.max(1,Math.ceil(elapsed/0.016));
        const step=elapsed/steps;
        for(let n=0;n<steps;n++){
          for(const axis of ["x","y","z"]){
            const error=target[axis]-pivot.rotation[axis];
            const acceleration=error*stiffness-velocity[axis]*damping;
            velocity[axis]+=acceleration*step;
            let next=pivot.rotation[axis]+velocity[axis]*step;
            if(next<minimum[axis]){
              next=minimum[axis];
              if(velocity[axis]<0)velocity[axis]=0;
            }else if(next>maximum[axis]){
              next=maximum[axis];
              if(velocity[axis]>0)velocity[axis]=0;
            }
            pivot.rotation[axis]=next;
          }
        }
      }
    };
  };

  const joints={
    pelvis:createJoint(pelvisPivot,[[-0.28,0.28],[-0.24,0.24],[-0.22,0.22]],38),
    spine:createJoint(spinePivot,[[-0.34,0.34],[-0.22,0.22],[-0.26,0.26]],40),
    thorax:createJoint(thoraxPivot,[[-0.30,0.30],[-0.28,0.28],[-0.24,0.24]],44),
    neck:createJoint(headPivot,[[-0.52,0.52],[-0.78,0.78],[-0.46,0.46]],50),
    hips:legPivots.map(p=>createJoint(p,[[-0.88,0.88],[-0.46,0.46],[-0.42,0.42]],44)),
    knees:kneePivots.map(p=>createJoint(p,[[-0.12,1.32],[-0.10,0.10],[-0.12,0.12]],48)),
    ankles:anklePivots.map(p=>createJoint(p,[[-0.48,0.52],[-0.22,0.22],[-0.28,0.28]],46)),
    toes:toePivots.map(p=>createJoint(p,[[-0.34,0.62],[-0.12,0.12],[-0.12,0.12]],48)),
    shoulders:armPivots.map(p=>createJoint(p,[[-1.10,1.10],[-0.72,0.72],[-0.78,0.78]],42)),
    elbows:elbowPivots.map(p=>createJoint(p,[[-0.12,1.62],[-0.12,0.12],[-0.18,0.18]],48)),
    wrists:wristPivots.map(p=>createJoint(p,[[-0.70,0.70],[-0.62,0.62],[-0.56,0.56]],52)),
    fingers:handFingerPivots.map(hand=>hand.map(digit=>({
      base:createJoint(digit.base,[[-0.42,0.82],[-0.22,0.22],[-0.26,0.26]],56),
      distal:createJoint(digit.distal,[[-0.22,0.95],[-0.16,0.16],[-0.18,0.18]],58)
    })))
  };
  const allJointControllers=[
    joints.pelvis,joints.spine,joints.thorax,joints.neck,
    ...joints.hips,...joints.knees,...joints.ankles,...joints.toes,
    ...joints.shoulders,...joints.elbows,...joints.wrists,
    ...joints.fingers.flatMap(hand=>hand.flatMap(digit=>[digit.base,digit.distal]))
  ];

  player.add(root);
  return {
    root,pelvisPivot,spinePivot,thoraxPivot,headBaseY,joints,allJointControllers,
    legPivots,kneePivots,anklePivots,toePivots,
    armPivots,elbowPivots,wristPivots,headPivot,
    torso,upper,helmet,visorMesh,backpack,
    antennaLight,chestLight,visorReflection,packTop
  };
}
const explorer = makeExplorer();

const EXPEDITION_STORAGE_KEY = "miller-expedition-log-v1";
const expeditionRecords = [
  {
    id:"signal-a01",
    code:"BALIZA A-01",
    title:"La primera señal",
    region:"Sector de marea norte",
    detail:"La baliza confirma una corriente dominante que cruza el océano de oeste a este. La señal lleva mucho tiempo activa, esperando a alguien que la escuche.",
    position:new THREE.Vector3(-24,0,-76),
    color:0x9deeff,
    phase:0.2
  },
  {
    id:"foam-garden",
    code:"ANOMALÍA DE ESPUMA",
    title:"Jardín de espuma",
    region:"Cuenca de espuma",
    detail:"Las líneas de espuma convergen sobre una fractura del lecho. El patrón se repite con cada oleaje, como si el propio océano estuviera respirando.",
    position:new THREE.Vector3(112,0,-142),
    color:0xe7c58d,
    phase:1.7
  },
  {
    id:"gravity-echo",
    code:"ECO GRAVITACIONAL",
    title:"Eco de Gargantúa",
    region:"Meridiano exterior",
    detail:"Los instrumentos registran una variación gravitatoria lenta y periódica. Es demasiado tenue para sentirse, pero aparece una y otra vez en las mediciones.",
    position:new THREE.Vector3(-166,0,-42),
    color:0x9bc9ff,
    phase:3.1
  },
  {
    id:"deep-resonance",
    code:"RESONANCIA ABISAL",
    title:"Canto del fondo",
    region:"Límite de la plataforma",
    detail:"Una vibración grave llega desde una zona más profunda. No hay una fuente visible; solo una frecuencia que viaja por el agua y desaparece bajo el horizonte.",
    position:new THREE.Vector3(138,0,176),
    color:0x9de1c7,
    phase:4.4
  }
];

const discoveredIds = new Set();
try {
  const savedIds = JSON.parse(localStorage.getItem(EXPEDITION_STORAGE_KEY) || "[]");
  if (Array.isArray(savedIds)) {
    for (const id of savedIds) {
      if (expeditionRecords.some(record => record.id === id)) discoveredIds.add(id);
    }
  }
} catch (error) {
  console.info("El diario de expedición comenzará vacío en este navegador.", error);
}

const expeditionState = { nearest:null, active:null, progress:0 };
let scanToastTimer = 0;

function createExpeditionBeacon(record) {
  const group = new THREE.Group();
  const darkMetal = new THREE.MeshStandardMaterial({ color:0x203b48, metalness:0.72, roughness:0.32 });
  const safety = new THREE.MeshStandardMaterial({ color:0xc9824f, metalness:0.42, roughness:0.4 });
  const panelMat = new THREE.MeshStandardMaterial({ color:0x18313e, metalness:0.58, roughness:0.38 });
  const glowMat = new THREE.MeshStandardMaterial({
    color:record.color,
    emissive:record.color,
    emissiveIntensity:1.15,
    metalness:0.18,
    roughness:0.2
  });
  const beamMat = new THREE.MeshBasicMaterial({
    color:record.color,
    transparent:true,
    opacity:0.095,
    depthWrite:false,
    side:THREE.DoubleSide
  });

  const float = new THREE.Mesh(new THREE.CylinderGeometry(0.88,0.98,0.34,24), safety);
  float.position.y = -0.13;
  group.add(float);

  const floatBand = new THREE.Mesh(new THREE.TorusGeometry(0.84,0.065,8,48), darkMetal);
  floatBand.rotation.x = Math.PI / 2;
  floatBand.position.y = 0.015;
  group.add(floatBand);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.095,0.14,1.55,12), darkMetal);
  mast.position.y = 0.82;
  group.add(mast);

  const mastCollar = new THREE.Mesh(new THREE.TorusGeometry(0.17,0.035,8,28), safety);
  mastCollar.rotation.x = Math.PI / 2;
  mastCollar.position.y = 0.31;
  group.add(mastCollar);

  for (const side of [-1,1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.55,0.055,0.38), panelMat);
    panel.position.set(side*0.55,0.82,0.02);
    panel.rotation.z = side*-0.09;
    group.add(panel);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.045,0.10,0.08), safety);
    rail.position.set(side*0.34,0.84,0.02);
    group.add(rail);
  }

  const signal = new THREE.Mesh(new THREE.SphereGeometry(0.19,16,12), glowMat);
  signal.position.y = 1.63;
  group.add(signal);

  const signalRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.38,0.025,8,48),
    new THREE.MeshBasicMaterial({color:record.color,transparent:true,opacity:0.72})
  );
  signalRing.position.y = 1.63;
  group.add(signalRing);

  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.075,0.22,3.4,12,1,true), beamMat);
  beam.position.y = 3.30;
  group.add(beam);

  const waterHalo = new THREE.Mesh(
    new THREE.TorusGeometry(1.35,0.018,6,64),
    new THREE.MeshBasicMaterial({color:record.color,transparent:true,opacity:0.34,depthWrite:false})
  );
  waterHalo.rotation.x = Math.PI / 2;
  waterHalo.position.y = 0.06;
  group.add(waterHalo);

  const light = new THREE.PointLight(record.color,1.15,22,2);
  light.position.y = 1.55;
  group.add(light);

  scene.add(group);
  return {group,signal,signalRing,waterHalo,beam,light,glowMat};
}

for (const record of expeditionRecords) {
  record.view = createExpeditionBeacon(record);
}

function saveExpeditionLog() {
  try {
    localStorage.setItem(EXPEDITION_STORAGE_KEY,JSON.stringify([...discoveredIds]));
  } catch (error) {
    console.info("No se pudo guardar el diario en este navegador.", error);
  }
}

function renderExpeditionJournal() {
  if (!journalList) return;
  journalList.replaceChildren();
  journalProgress.textContent = discoveredIds.size + " / " + expeditionRecords.length + " REGISTROS";
  journalToggle.textContent = "◈ REGISTRO " + discoveredIds.size + "/" + expeditionRecords.length;

  expeditionRecords.forEach((record,index) => {
    const found = discoveredIds.has(record.id);
    const item = document.createElement("article");
    item.className = "journal-entry" + (found ? " discovered" : " undiscovered");

    const number = document.createElement("span");
    number.className = "journal-number";
    number.textContent = String(index+1).padStart(2,"0");

    const content = document.createElement("div");
    content.className = "journal-entry-copy";

    const code = document.createElement("span");
    code.className = "journal-entry-code";
    code.textContent = found ? record.code : "SEÑAL PENDIENTE";

    const title = document.createElement("strong");
    title.textContent = found ? record.title : "Registro sin identificar";

    const detail = document.createElement("p");
    detail.textContent = found ? record.detail : "Acércate a una señal de investigación y detente para completar el escaneo.";

    content.append(code,title,detail);
    item.append(number,content);
    journalList.append(item);
  });
}

function setJournalOpen(open) {
  journalOpen = !!open;
  journalOverlay.classList.toggle("hidden",!journalOpen);
  journalToggle.setAttribute("aria-expanded",journalOpen ? "true" : "false");
  if (journalOpen) renderExpeditionJournal();
}

function showDiscoveryToast(record) {
  if (!scanToast) return;
  scanToastTitle.textContent = record.title;
  scanToastDetail.textContent = record.region + " · REGISTRO GUARDADO";
  scanToast.classList.remove("show");
  void scanToast.offsetWidth;
  scanToast.classList.add("show");
  window.clearTimeout(scanToastTimer);
  scanToastTimer = window.setTimeout(() => scanToast.classList.remove("show"),5200);
}

function startExpeditionScan() {
  const target = expeditionState.nearest;
  if (!target || target.distance > 19 || expeditionState.active) return;
  expeditionState.active = target.record;
  expeditionState.progress = 0;
  scanPrompt.classList.add("visible");
  scanProgressWrap.classList.add("visible");
  scanAction.textContent = "ESCÁNER INICIADO · MANTENTE CERCA";
}

function completeExpeditionScan(record) {
  discoveredIds.add(record.id);
  saveExpeditionLog();
  renderExpeditionJournal();
  showDiscoveryToast(record);
  expeditionState.active = null;
  expeditionState.progress = 0;
  scanProgressWrap.classList.remove("visible");
  scanAction.textContent = "REGISTRO COMPLETADO";
}

function updateExpeditionSystem(dt,speed) {
  let nearest = null;
  for (const record of expeditionRecords) {
    const view = record.view;
    const wave = waveHeight(record.position.x,record.position.z,simulationTime);
    view.group.position.set(record.position.x,wave,record.position.z);
    view.group.rotation.x = Math.sin(simulationTime*0.54+record.phase)*0.018;
    view.group.rotation.z = Math.cos(simulationTime*0.47+record.phase)*0.016;
    view.group.rotation.y += dt*(0.08+weatherState.wind*0.035);
    const pulse = 0.88 + 0.12*(0.5+0.5*Math.sin(simulationTime*1.7+record.phase));
    view.signal.scale.setScalar(pulse);
    view.signalRing.rotation.y += dt*0.22;
    view.waterHalo.scale.setScalar(0.96+0.04*Math.sin(simulationTime*0.8+record.phase));
    view.light.intensity = discoveredIds.has(record.id) ? 0.32 : 0.75+pulse*0.58;

    if (!discoveredIds.has(record.id)) {
      const distance = Math.hypot(player.position.x-record.position.x,player.position.z-record.position.z);
      if (!nearest || distance < nearest.distance) nearest = {record,distance};
    }
  }
  expeditionState.nearest = nearest;

  if (nearest) {
    const dx = nearest.record.position.x-player.position.x;
    const dz = nearest.record.position.z-player.position.z;
    const distance = nearest.distance;
    const bearing = (Math.atan2(dx,-dz)+Math.PI*2)%(Math.PI*2);
    const desiredYaw = Math.atan2(-dx,-dz);
    const relativeYaw = Math.atan2(Math.sin(desiredYaw-cameraYaw),Math.cos(desiredYaw-cameraYaw));
    const compass = ["N","NE","E","SE","S","SO","O","NO"];
    const direction = compass[Math.round(bearing/(Math.PI/4))%8];
    signalNav.classList.add("active");
    signalNav.classList.toggle("near",distance<31);
    signalNavArrow.style.transform = "rotate("+(-relativeYaw)+"rad)";
    signalNavDistance.textContent = Math.round(distance)+" m · "+direction;
    signalNavTitle.textContent = distance < 31 ? "SEÑAL DETECTADA" : "SEÑAL MÁS CERCANA";
  } else {
    signalNav.classList.remove("active","near");
    signalNavTitle.textContent = "TODAS LAS SEÑALES REGISTRADAS";
    signalNavDistance.textContent = "EXPEDICIÓN COMPLETADA";
  }

  const activeRecord = expeditionState.active;
  if (activeRecord) {
    const distance = Math.hypot(player.position.x-activeRecord.position.x,player.position.z-activeRecord.position.z);
    if (distance > 23) {
      expeditionState.active = null;
      expeditionState.progress = 0;
      scanProgressWrap.classList.remove("visible");
      scanAction.textContent = "SEÑAL PERDIDA · ACÉRCATE DE NUEVO";
    } else {
      const canAdvanceScan = started && !paused && !journalOpen;
      const stable = speed < 0.58;
      if (stable && canAdvanceScan) expeditionState.progress = Math.min(1,expeditionState.progress+dt/3.1);
      scanTitle.textContent = activeRecord.title;
      scanDetail.textContent = !canAdvanceScan ? "Escaneo suspendido mientras consultas el diario o estás en pausa." : stable ? "Midiendo corrientes y resonancia local…" : "Detente para estabilizar el escáner.";
      scanAction.textContent = !canAdvanceScan ? "ANÁLISIS EN ESPERA" : stable ? "ANALIZANDO…" : "REDUCE EL MOVIMIENTO";
      scanProgressFill.style.width = (expeditionState.progress*100).toFixed(1)+"%";
      if (expeditionState.progress >= 1) completeExpeditionScan(activeRecord);
    }
  }

  if (!expeditionState.active && nearest && nearest.distance < 31) {
    scanPrompt.classList.add("visible");
    scanTitle.textContent = nearest.record.code;
    scanDetail.textContent = nearest.distance <= 19
      ? "Señal estable a " + Math.round(nearest.distance) + " m."
      : "Señal detectada a " + Math.round(nearest.distance) + " m. Acércate con calma.";
    scanAction.textContent = nearest.distance <= 19 ? "E · INICIAR ESCANEO" : "ACÉRCATE A LA BALIZA";
    scanProgressWrap.classList.remove("visible");
  } else if (!expeditionState.active) {
    scanPrompt.classList.remove("visible");
  }
}

renderExpeditionJournal();

function createParticleSystem(count) {
  const positions = new Float32Array(count*3);
  const velocities = new Float32Array(count*3);
  const life = new Float32Array(count);
  positions.fill(-10000);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.PointsMaterial({ color:0xe5fbff, size:0.19, sizeAttenuation:true, transparent:true, opacity:0.96, blending:THREE.AdditiveBlending, depthWrite:false, depthTest:true });
  const points = new THREE.Points(geometry,material);
  points.frustumCulled=false;
  points.renderOrder=3;
  scene.add(points);
  return { count, positions, velocities, life, geometry, points, cursor:0 };
}
const spray=createParticleSystem(MOBILE ? 130 : 280);
function spawnSpray(x,z,amount=9) {
  const y=waveHeight(x,z,simulationTime)+0.05;
  for(let j=0;j<amount;j++){
    const i=spray.cursor++%spray.count;
    spray.positions[3*i]=x+(Math.random()-.5)*0.7;
    spray.positions[3*i+1]=y+0.015+Math.random()*0.035;
    spray.positions[3*i+2]=z+(Math.random()-.5)*0.7;
    spray.velocities[3*i]=(Math.random()-.5)*1.85+velocity.x*0.28;
    spray.velocities[3*i+1]=0.48+Math.random()*1.35;
    spray.velocities[3*i+2]=(Math.random()-.5)*1.85+velocity.z*0.28;
    spray.life[i]=0.48+Math.random()*0.48;
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
for(let i=0;i<32;i++){
  const material=new THREE.MeshBasicMaterial({
    color:0xb9edf0,
    transparent:true,
    opacity:0.0,
    side:THREE.DoubleSide,
    depthTest:true,
    depthWrite:false,
    blending:THREE.AdditiveBlending
  });
  const mesh=new THREE.Mesh(new THREE.TorusGeometry(0.45,0.014,6,64),material);
  mesh.rotation.x=-Math.PI/2;
  mesh.visible=false;
  mesh.renderOrder=2;
  scene.add(mesh);
  ripplePool.push({mesh,material,life:0,age:0,x:0,z:0,baseScale:0.18,expandSpeed:2.2,baseOpacity:0.4});
}
let rippleCursor=0;
let wakeCursor=0;

function triggerLocalWake(x,z,strength=0.8){
  const wakeData=ocean.material.uniforms.uWakeData.value;
  const slot=wakeData[wakeCursor++%wakeData.length];
  slot.set(x,z,0,THREE.MathUtils.clamp(strength,0.25,1.4));
}

function spawnRipple(x=player.position.x,z=player.position.z,strength=0.8){
  triggerLocalWake(x,z,strength);
  for(let band=0;band<2;band++){
    const r=ripplePool[rippleCursor++%ripplePool.length];
    r.life=1.05;
    r.age=0;
    r.x=x;
    r.z=z;
    r.baseScale=band===0?0.19:0.31;
    r.expandSpeed=band===0?2.55:1.95;
    r.baseOpacity=(band===0?0.48:0.27)*strength;
    r.mesh.visible=true;
    r.mesh.position.set(x,waveHeight(x,z,simulationTime)+0.018+band*0.006,z);
    r.mesh.scale.setScalar(r.baseScale);
    r.mesh.rotation.z=Math.random()*Math.PI;
    r.material.opacity=r.baseOpacity;
  }
}

function updateWakeEvents(dt){
  for(const wake of ocean.material.uniforms.uWakeData.value){
    if(wake.w<=0)continue;
    wake.z+=dt;
    if(wake.z>1.9)wake.w=0;
  }
}

function updateRipples(dt){
  for(const r of ripplePool){
    if(r.life<=0)continue;
    r.age+=dt;
    r.life-=dt;
    const fade=THREE.MathUtils.clamp(r.life/1.05,0,1);
    r.mesh.position.y=waveHeight(r.x,r.z,simulationTime)+0.018;
    r.mesh.scale.setScalar(r.baseScale+r.age*r.expandSpeed);
    r.material.opacity=r.baseOpacity*Math.pow(fade,1.35);
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
  const currentX = Math.sin(player.position.z * 0.018 + simulationTime * 0.21) * 0.085 + weatherState.windDirection.x*weatherState.wind*0.035;
  const currentZ = Math.cos(player.position.x * 0.015 - simulationTime * 0.18) * 0.075 + weatherState.windDirection.y*weatherState.wind*0.035;
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
    const splashStrength=THREE.MathUtils.clamp(0.85+horizontalSpeed*0.18,0.85,1.35);
    spawnSpray(player.position.x,player.position.z,22);
    spawnRipple(player.position.x,player.position.z,splashStrength);
  }

  if (horizontalSpeed > 0.12) {
    const desiredYaw = Math.atan2(-velocity.x, -velocity.z);
    let difference = desiredYaw - explorer.root.rotation.y;
    difference = Math.atan2(Math.sin(difference), Math.cos(difference));
    explorer.root.rotation.y += difference * Math.min(1, dt * 6.8);
    walkPhase += dt * (2.2 + horizontalSpeed * 2.5);
    const gait=Math.sin(walkPhase);
    const oppositeGait=Math.sin(walkPhase+Math.PI);
    const stride=lowView?0.25:0.38;
    for(let side=0;side<2;side++){
      const legWave=side===0?gait:oppositeGait;
      const armWave=-legWave;
      const sideSign=side===0?-1:1;
      const recovery=Math.max(0,Math.cos(walkPhase+side*Math.PI));
      explorer.joints.hips[side].set(
        legWave*stride,
        Math.sin(walkPhase+side*Math.PI)*0.025,
        -sideSign*0.018
      );
      explorer.joints.knees[side].set(Math.max(0,legWave)*0.62+0.045,0,sideSign*0.008);
      explorer.joints.ankles[side].set(
        -legWave*0.22-Math.max(0,legWave)*0.12+recovery*0.035,
        0,
        -sideSign*0.012
      );
      explorer.joints.toes[side].set(0.18*recovery,0,0);
      explorer.joints.shoulders[side].set(armWave*0.28-0.04,sideSign*0.018,sideSign*0.035);
      explorer.joints.elbows[side].set(0.17+Math.max(0,armWave)*0.24,0,sideSign*0.02);
      explorer.joints.wrists[side].set(
        -0.08+Math.sin(walkPhase*0.5+side)*0.045,
        sideSign*0.015,
        Math.sin(walkPhase*0.5+side)*0.018
      );
      explorer.joints.fingers[side].forEach((digit,index)=>{
        const curl=0.10+0.025*Math.sin(walkPhase*2+side+index*0.35);
        digit.base.set(curl,0,0);
        digit.distal.set(curl*0.72,0,0);
      });
    }
    splashTimer += dt;
    rippleTimer += dt;
    if (splashTimer > (horizontalSpeed > 2.3 ? 0.25 : 0.34)) {
      const footSide=Math.sin(walkPhase)>=0?1:-1;
      const localFoot=new THREE.Vector3(footSide*0.22,0,-0.12)
        .applyAxisAngle(new THREE.Vector3(0,1,0),explorer.root.rotation.y);
      const stepX=player.position.x+localFoot.x;
      const stepZ=player.position.z+localFoot.z;
      const stepStrength=THREE.MathUtils.clamp(0.60+horizontalSpeed*0.28,0.65,1.28);
      spawnRipple(stepX,stepZ,stepStrength);
      spawnSpray(stepX,stepZ,horizontalSpeed>2.3?13:8);
      splashTimer=0;
    }
  } else {
    const settle=1-Math.exp(-dt*5.2);
    for(let side=0;side<2;side++){
      explorer.joints.hips[side].set(0,0,0);
      explorer.joints.knees[side].set(0.035,0,0);
      explorer.joints.ankles[side].set(0,0,0);
      explorer.joints.toes[side].set(0,0,0);
      explorer.joints.shoulders[side].set(0,0,0);
      explorer.joints.elbows[side].set(0.15,0,0);
      explorer.joints.wrists[side].set(0,0,0);
      explorer.joints.fingers[side].forEach(digit=>{
        digit.base.set(0.08,0,0);
        digit.distal.set(0.055,0,0);
      });
    }
    splashTimer = 0;
    rippleTimer = 0;
  }

  const waveBob = THREE.MathUtils.clamp((surfaceY - WATER_LEVEL) * 0.18, -0.035, 0.035);
  const gaitBob = horizontalSpeed > 0.12 ? Math.abs(Math.sin(walkPhase * 2)) * 0.035 : 0;
  explorer.root.position.y = waveBob + gaitBob;
  // The pelvis and spine handle balance independently; root yaw remains stable.
  const forwardLean=lowView?-0.10:THREE.MathUtils.clamp(-horizontalSpeed*0.035,-0.085,0);
  explorer.joints.spine.set(forwardLean,0,THREE.MathUtils.clamp(-velocity.x*0.025,-0.10,0.10));
  explorer.joints.thorax.set(-forwardLean*0.18,0,THREE.MathUtils.clamp(velocity.x*0.008,-0.035,0.035));
  explorer.joints.pelvis.set(0,0,THREE.MathUtils.clamp(velocity.x*0.012,-0.045,0.045));
  return horizontalSpeed;
}

function updateExplorerLife(dt,speed){
  const t=simulationTime;
  const idleAmount=1-THREE.MathUtils.smoothstep(speed,0.10,0.85);
  const breath=Math.sin(t*1.62)*0.58+Math.sin(t*0.79+0.6)*0.22;

  explorer.torso.scale.y=1.0+breath*0.007;
  explorer.upper.scale.y=0.52*(1.0+breath*0.012);
  explorer.headPivot.position.y=explorer.headBaseY+breath*0.010+Math.sin(t*0.42)*0.006*idleAmount;
  const spineTarget=explorer.joints.spine.target;
  explorer.joints.neck.set(
    -spineTarget.x*0.42+Math.sin(t*0.38+0.5)*0.028*idleAmount,
    Math.sin(t*0.24)*0.052*idleAmount,
    Math.sin(t*0.31+0.7)*0.012*idleAmount
  );
  explorer.backpack.position.y=1.78+breath*0.008;
  explorer.packTop.position.y=2.26+breath*0.008;

  const pulse=0.88+0.12*(0.5+0.5*Math.sin(t*2.4));
  explorer.antennaLight.scale.setScalar(pulse);
  explorer.chestLight.scale.x=1.0+0.12*Math.sin(t*2.0+0.4);
  explorer.chestLight.material.opacity=0.84+0.16*Math.sin(t*2.0);
  explorer.visorReflection.material.opacity=0.26+0.06*Math.sin(t*0.7);

  const idleSway=Math.sin(t*0.83)*0.026*idleAmount;
  for(let side=0;side<2;side++){
    const shoulderTarget=explorer.joints.shoulders[side].target;
    const elbowTarget=explorer.joints.elbows[side].target;
    const wristTarget=explorer.joints.wrists[side].target;
    explorer.joints.shoulders[side].set(
      shoulderTarget.x,shoulderTarget.y,
      THREE.MathUtils.lerp(shoulderTarget.z,side===0?idleSway:-idleSway*0.82,idleAmount)
    );
    explorer.joints.elbows[side].set(
      THREE.MathUtils.lerp(elbowTarget.x,0.16+Math.sin(t*0.64+side*0.8)*0.035,idleAmount),
      elbowTarget.y,elbowTarget.z
    );
    explorer.joints.wrists[side].set(
      wristTarget.x,wristTarget.y,
      THREE.MathUtils.lerp(wristTarget.z,Math.sin(t*0.55+side)*0.025,idleAmount)
    );
    explorer.joints.fingers[side].forEach((digit,index)=>{
      const curl=THREE.MathUtils.lerp(
        digit.base.target.x,
        0.08+Math.sin(t*0.72+side+index*0.42)*0.018,
        idleAmount
      );
      digit.base.set(curl,0,0);
      digit.distal.set(curl*0.68,0,0);
    });
  }
  const locomotionLean=THREE.MathUtils.clamp(-speed*0.035,-0.085,0);
  const breathingSway=Math.sin(t*0.52)*0.006*idleAmount;
  const sideBalance=THREE.MathUtils.clamp(-velocity.x*0.025,-0.10,0.10);
  explorer.joints.spine.set(locomotionLean+breathingSway,0,sideBalance);
  explorer.joints.thorax.set(-locomotionLean*0.18+breath*0.006,0,-sideBalance*0.32);
  explorer.joints.pelvis.set(
    Math.sin(walkPhase*2)*0.018*(1-idleAmount),
    0,
    THREE.MathUtils.clamp(velocity.x*0.012,-0.045,0.045)
  );
}

const cameraTarget=new THREE.Vector3();
const cameraDesired=new THREE.Vector3();
const cameraLookSmoothed=new THREE.Vector3();
let cameraLookReady=false;

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
  const safeDt=THREE.MathUtils.clamp(dt,0,0.05);
  const positionResponse=firstPerson?CAMERA_FIRST_PERSON_RESPONSE:CAMERA_THIRD_PERSON_RESPONSE;
  const positionAlpha=1-Math.exp(-positionResponse*safeDt);
  camera.position.lerp(cameraDesired,positionAlpha);
  camera.position.y=Math.max(camera.position.y,GROUND_Y+CAMERA_GROUND_CLEARANCE);
  if(!cameraLookReady){
    cameraLookSmoothed.copy(cameraTarget);
    cameraLookReady=true;
  }
  const lookResponse=firstPerson?CAMERA_LOOK_FIRST_RESPONSE:CAMERA_LOOK_THIRD_RESPONSE;
  const lookAlpha=1-Math.exp(-lookResponse*safeDt);
  cameraLookSmoothed.lerp(cameraTarget,lookAlpha);
  camera.lookAt(cameraLookSmoothed);
}

function updateScene(dt, speed) {
  updateWorldWeather();
  const tide = tideCycleAt(simulationTime);
  tideFrontZ = player.position.z - tide.distance;
  tideCenterX = player.position.x;
  tideAmplitude = 1;

  ocean.position.set(player.position.x, WATER_LEVEL, player.position.z);
  oceanUnderlay.position.set(player.position.x, WATER_LEVEL - 0.16, player.position.z);
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
  ocean.material.uniforms.uWindStrength.value = weatherState.wind;
  ocean.material.uniforms.uWindDirection.value.copy(weatherState.windDirection);
  skyDome.position.copy(camera.position);
  skyDome.material.uniforms.uTime.value = simulationTime;
  skyDome.material.uniforms.uWindStrength.value = weatherState.wind;
  skyDome.material.uniforms.uWindDirection.value.copy(weatherState.windDirection);
  skyDome.material.uniforms.uCloudCover.value = weatherState.cloudCover;
  skyDome.material.uniforms.uMist.value = weatherState.mist;
  skyDome.material.uniforms.uSunDir.value.copy(weatherState.sunDirection);
  ocean.material.uniforms.uSunDir.value.copy(weatherState.sunDirection);
  sunLight.position.copy(weatherState.sunDirection).multiplyScalar(800);
  sunLight.intensity=2.0-weatherState.cloudCover*0.62;
  fillLight.intensity=0.72+weatherState.mist*0.38;

  gargantua.group.position.set(player.position.x - 355, 170, player.position.z - 1650);
  gargantua.ring1.rotation.z = Math.sin(simulationTime * 0.012) * 0.025;
  gargantua.ring2.rotation.z = -Math.sin(simulationTime * 0.012) * 0.025;

  if(weatherState.gust>0.76){
    ambientSprayTimer+=dt;
    if(ambientSprayTimer>0.52){
      const offset=5+Math.random()*12;
      const x=player.position.x+weatherState.windDirection.x*offset+(Math.random()-0.5)*5;
      const z=player.position.z+weatherState.windDirection.y*offset+(Math.random()-0.5)*5;
      spawnSpray(x,z,2+Math.floor(weatherState.gust*3));
      ambientSprayTimer=0;
    }
  }else{
    ambientSprayTimer=0;
  }

  ambientMixTimer+=dt;
  if(ambientMixTimer>0.9){
    syncAmbientAudio();
    ambientMixTimer=0;
  }

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
  updateWakeEvents(dt);
  updateRipples(dt);
  updateExpeditionSystem(dt,speed);
  const surfaceY = waveHeight(player.position.x, player.position.z, simulationTime);
  const underwater = firstPerson && camera.position.y < surfaceY;
  ocean.material.uniforms.uUnderwaterView.value = underwater ? 1 : 0;
  if (ocean.material.transparent !== underwater) {
    ocean.material.transparent = underwater;
    ocean.material.depthWrite = !underwater;
    ocean.material.needsUpdate = true;
  }
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

let ambientAudio=null;
let ambientAudioEnabled=true;

function createAmbientAudio(){
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)return null;
  try{
    const context=new AudioContextClass();
    const master=context.createGain();
    master.gain.value=0.0001;
    master.connect(context.destination);

    const buffer=context.createBuffer(1,context.sampleRate*3,context.sampleRate);
    const channel=buffer.getChannelData(0);
    let brown=0;
    for(let i=0;i<channel.length;i++){
      brown=(brown+0.018*(Math.random()*2-1))*0.985;
      channel[i]=THREE.MathUtils.clamp(brown*3.2,-1,1);
    }

    const makeLayer=(type,frequency,q,level)=>{
      const source=context.createBufferSource();
      source.buffer=buffer;
      source.loop=true;
      const filter=context.createBiquadFilter();
      filter.type=type;
      filter.frequency.value=frequency;
      filter.Q.value=q;
      const gain=context.createGain();
      gain.gain.value=level;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start();
      return {source,filter,gain};
    };

    const wind=makeLayer("lowpass",520,0.55,0.26);
    const surf=makeLayer("lowpass",190,0.7,0.24);
    const spray=makeLayer("highpass",1150,0.45,0.045);

    const lfo=context.createOscillator();
    const lfoDepth=context.createGain();
    lfo.type="sine";
    lfo.frequency.value=0.055;
    lfoDepth.gain.value=0.055;
    lfo.connect(lfoDepth);
    lfoDepth.connect(surf.gain);
    lfo.start();

    const distant=context.createOscillator();
    const distantGain=context.createGain();
    distant.type="sine";
    distant.frequency.value=46;
    distantGain.gain.value=0.018;
    distant.connect(distantGain);
    distantGain.connect(master);
    distant.start();

    ambientAudio={context,master,wind,surf,spray,lfo,lfoDepth,distant,distantGain};
    context.resume().catch(()=>{});
    return ambientAudio;
  }catch(error){
    console.info("Audio ambiental no disponible en este navegador",error);
    return null;
  }
}

function syncAmbientAudio(){
  if(!ambientAudioEnabled||!ambientAudio){
    if(soundToggle){
      soundToggle.textContent="♪ SONIDO OFF";
      soundToggle.setAttribute("aria-pressed","false");
    }
    return;
  }
  const now=ambientAudio.context.currentTime;
  ambientAudio.wind.gain.gain.setTargetAtTime(0.22+weatherState.wind*0.12,now,0.8);
  ambientAudio.surf.gain.gain.setTargetAtTime(0.19+weatherState.gust*0.12,now,0.9);
  ambientAudio.spray.gain.gain.setTargetAtTime(0.035+weatherState.gust*0.065,now,0.7);
  ambientAudio.master.gain.setTargetAtTime(0.18,now,0.65);
  if(soundToggle){
    soundToggle.textContent="♪ SONIDO ON";
    soundToggle.setAttribute("aria-pressed","true");
  }
}

function startAmbientAudio(){
  if(!ambientAudio)createAmbientAudio();
  if(ambientAudio){
    ambientAudio.context.resume().catch(()=>{});
    syncAmbientAudio();
  }
}

function startGame() {
  started=true;paused=false;
  setJournalOpen(false);
  intro.classList.add("hidden");pauseOverlay.classList.add("hidden");
  if(ambientAudioEnabled)startAmbientAudio();
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
journalToggle.addEventListener("click",()=>setJournalOpen(!journalOpen));
journalClose.addEventListener("click",()=>setJournalOpen(false));
if(soundToggle){
  soundToggle.addEventListener("click",()=>{
    ambientAudioEnabled=!ambientAudioEnabled;
    if(ambientAudioEnabled){
      startAmbientAudio();
    }else if(ambientAudio){
      ambientAudio.master.gain.setTargetAtTime(0.0001,ambientAudio.context.currentTime,0.3);
      soundToggle.textContent="♪ SONIDO OFF";
      soundToggle.setAttribute("aria-pressed","false");
    }else{
      soundToggle.textContent="♪ SONIDO OFF";
      soundToggle.setAttribute("aria-pressed","false");
    }
  });
}
recenterButton.addEventListener("click",()=>{cameraYaw=0.12;cameraPitch=0.19;cameraLookReady=false;});
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
  if (event.code === "KeyJ" && !event.repeat && started && !paused) {
    setJournalOpen(!journalOpen);
    event.preventDefault();
    return;
  }
  if (event.code === "KeyE" && !event.repeat && started && !paused && !journalOpen) {
    if (expeditionState.active) {
      expeditionState.active = null;
      expeditionState.progress = 0;
      scanProgressWrap.classList.remove("visible");
      scanAction.textContent = "ESCANEO CANCELADO";
    } else {
      startExpeditionScan();
    }
    event.preventDefault();
    return;
  }
  if (event.code === "KeyV" && !event.repeat && started && !paused) {
    firstPerson = !firstPerson;
    cameraLookReady=false;
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
  dx=THREE.MathUtils.clamp(dx,-120,120);
  dy=THREE.MathUtils.clamp(dy,-120,120);
  cameraYaw-=dx*CAMERA_MOUSE_SENSITIVITY;
  cameraPitch=THREE.MathUtils.clamp(cameraPitch-dy*CAMERA_PITCH_SENSITIVITY,-0.58,0.68);
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
  if(started&&!paused&&!journalOpen){
    speed=updatePlayer(dt);
    updateExplorerLife(dt,speed);
    for(const joint of explorer.allJointControllers)joint.update(dt);
  }
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

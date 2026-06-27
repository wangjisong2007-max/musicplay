// MusicPlay Particle System — Final Implementation
// 10K vertex Fibonacci sphere + 2D periodic Perlin noise + IQ cosine palette + dual-layer Points
import * as THREE from 'three';

// IQ cosine palette presets: [a, b, c, d] vectors
export const PALETTES = [
  { name:'极光',   a:[0.5,0.5,0.5],  b:[0.5,0.5,0.5],  c:[1,1,1], d:[0.00,0.33,0.67] },
  { name:'暖金',   a:[0.8,0.7,0.6],  b:[0.2,0.2,0.2],  c:[1,1,1], d:[0.00,0.10,0.20] },
  { name:'深空',   a:[0.15,0.25,0.45],b:[0.15,0.15,0.2],c:[1,1,1], d:[0.00,0.10,0.20] },
  { name:'霓虹',   a:[0.5,0.5,0.5],  b:[0.5,0.5,0.5],  c:[1,1,1], d:[0.00,0.25,0.50] },
];

// 2D periodic Perlin noise (GLSL)
const PNOISE_GLSL = `
vec4 permute(vec4 x){return mod(((x*34.0)+10.0)*x,289.0);}
float pnoise(vec2 P,vec2 rep){
  vec4 Pi=floor(P.xyxy)+vec4(0,0,1,1);
  vec4 Pf=fract(P.xyxy)-vec4(0,0,1,1);
  Pi=mod(Pi,rep.xyxy);
  Pi=mod(Pi,289.0);
  vec4 ix=Pi.xzxz,iy=Pi.yyww;
  vec4 fx=Pf.xzxz,fy=Pf.yyww;
  vec4 i=permute(permute(ix)+iy);
  vec4 gx=2.0*fract(i*0.0243902439)-1.0;
  vec4 gy=abs(gx)-0.5;
  vec4 tx=floor(gx+0.5);gx=gx-tx;
  vec2 g00=vec2(gx.x,gy.x),g10=vec2(gx.y,gy.y),g01=vec2(gx.z,gy.z),g11=vec2(gx.w,gy.w);
  vec4 norm=1.79284291400159-0.85373472095314*vec4(dot(g00,g00),dot(g01,g01),dot(g10,g10),dot(g11,g11));
  g00*=norm.x;g01*=norm.y;g10*=norm.z;g11*=norm.w;
  float n00=dot(g00,vec2(fx.x,fy.x)),n10=dot(g10,vec2(fx.y,fy.y));
  float n01=dot(g01,vec2(fx.z,fy.z)),n11=dot(g11,vec2(fx.w,fy.w));
  vec2 fade_xy=Pf.xy*Pf.xy*Pf.xy*(Pf.xy*(Pf.xy*6.0-15.0)+10.0);
  vec2 n_x=mix(vec2(n00,n01),vec2(n10,n11),fade_xy.x);
  return 2.3*mix(n_x.x,n_x.y,fade_xy.y);
}
`;

// IQ cosine palette function (GLSL)
const PALETTE_GLSL = `
vec3 palette(float t,vec3 a,vec3 b,vec3 c,vec3 d){
  return a+b*cos(6.28318530718*(c*t+d));
}
vec3 getColor(float p,float idx){
  if(idx>0.5&&idx<1.5)return palette(p,vec3(0.8,0.7,0.6),vec3(0.2,0.2,0.2),vec3(1,1,1),vec3(0.0,0.1,0.2));
  if(idx>1.5&&idx<2.5)return palette(p,vec3(0.15,0.25,0.45),vec3(0.15,0.15,0.2),vec3(1,1,1),vec3(0.0,0.1,0.2));
  if(idx>2.5)return palette(p,vec3(0.5,0.5,0.5),vec3(0.5,0.5,0.5),vec3(1,1,1),vec3(0.0,0.25,0.5));
  return palette(p,vec3(0.5,0.5,0.5),vec3(0.5,0.5,0.5),vec3(1,1,1),vec3(0.0,0.33,0.67));
}
`;

// Vertex shader — main layer
const VS_MAIN = `
uniform float uTime,uBass,uMid,uTreble,uBeat;
uniform float uPaletteIndex;
uniform float uNoiseScale,uDisplacement,uPointScale;
attribute float aRand;
varying vec3 vColor;
varying float vAlpha,vSourceLum;
#define PI 3.14159265359

${PNOISE_GLSL}
${PALETTE_GLSL}

void main(){
  float theta=atan(position.z,position.x);
  float phi=asin(normalize(position).y);
  vec2 uv=vec2((theta/PI)*6.0,(phi/(PI/2.0))*6.0);
  float n=pnoise(uv*uNoiseScale+vec2(uTime*0.15,uTime*0.1),vec2(12.0));
  float amp=n*uDisplacement*(1.0+uBass*1.8+uBeat*1.5);
  vec3 np=position+normal*amp;
  vec4 mv=modelViewMatrix*vec4(np,1.0);
  gl_Position=projectionMatrix*mv;
  float sf=1.0+uBass*0.8+uBeat*1.2;
  gl_PointSize=uPointScale*sf/(-mv.z);
  float cp=(position.y/4.0)*0.5+0.5+n*0.25;
  vColor=getColor(fract(cp),uPaletteIndex);
  vSourceLum=0.3+uBass*0.4+uBeat*0.3;
  vAlpha=vSourceLum+sin(uTime*3.0+aRand*6.28)*0.05;
}
`;

// Vertex shader — glow layer
const VS_GLOW = `
uniform float uTime,uBass,uMid,uTreble,uBeat;
uniform float uPaletteIndex;
uniform float uNoiseScale,uDisplacement,uPointScale;
attribute float aRand;
varying vec3 vColor;
varying float vAlpha,vSourceLum;
#define PI 3.14159265359

${PNOISE_GLSL}
${PALETTE_GLSL}

void main(){
  float theta=atan(position.z,position.x);
  float phi=asin(normalize(position).y);
  vec2 uv=vec2((theta/PI)*6.0,(phi/(PI/2.0))*6.0);
  float n=pnoise(uv*uNoiseScale+vec2(uTime*0.15,uTime*0.1),vec2(12.0));
  float amp=n*uDisplacement*(1.2+uBass*2.0+uBeat*1.8);
  vec3 np=position+normal*(amp+0.1);
  vec4 mv=modelViewMatrix*vec4(np,1.0);
  float bl=0.2+uBass*0.5+uBeat*0.3;
  if(bl<0.15){gl_Position=vec4(9999,9999,9999,1);return;}
  gl_Position=projectionMatrix*mv;
  float sf=(1.5+uBass*1.0+uBeat*1.5)*1.5;
  gl_PointSize=uPointScale*sf/(-mv.z);
  float cp=(position.y/4.0)*0.5+0.5+n*0.25;
  vColor=getColor(fract(cp),uPaletteIndex);
  vSourceLum=bl;
  vAlpha=bl*0.5;
}
`;

// Fragment shader — main layer
const FS_MAIN = `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main(){
  float d=length(gl_PointCoord-vec2(0.5));
  if(d>0.5)discard;
  float edge=smoothstep(0.5,0.35,d);
  float rim=smoothstep(0.5,0.0,d);
  vec3 col=vColor*(0.5+rim*0.5);
  gl_FragColor=vec4(col,vAlpha*edge);
}
`;

// Fragment shader — glow layer
const FS_GLOW = `
precision highp float;
varying vec3 vColor;
varying float vAlpha,vSourceLum;
void main(){
  float d=length(gl_PointCoord-vec2(0.5));
  if(d>0.5)discard;
  if(vSourceLum<0.1)discard;
  float sg=exp(-d*5.0);
  vec3 col=vColor*1.8;
  gl_FragColor=vec4(col,vAlpha*sg);
}
`;

// Fibonacci sphere: 10K vertices, golden ratio sampling
function buildSphereGeo(vertexCount) {
  const N = vertexCount;
  const positions = new Float32Array(N * 3);
  const normals = new Float32Array(N * 3);
  const randoms = new Float32Array(N);
  const R = 4.0;

  for (let i = 0; i < N; i++) {
    const theta = Math.acos(1 - 2 * (i + 0.5) / N);
    const phi = Math.sqrt(N * Math.PI) * theta;
    const sinT = Math.sin(theta);
    const x = sinT * Math.cos(phi);
    const y = sinT * Math.sin(phi);
    const z = Math.cos(theta);
    positions[i * 3] = x * R;
    positions[i * 3 + 1] = y * R;
    positions[i * 3 + 2] = z * R;
    normals[i * 3] = x;
    normals[i * 3 + 1] = y;
    normals[i * 3 + 2] = z;
    randoms[i] = Math.random();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(randoms, 1));
  return geo;
}

export function createParticleSystem(scene, vertexCount = 10000) {
  const geo = buildSphereGeo(vertexCount);

  const uniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uBeat: { value: 0 },
    uPaletteIndex: { value: 0 },
    uNoiseScale: { value: 0.2 },
    uDisplacement: { value: 1.0 },
    uPointScale: { value: 100 },
  };

  // Main layer — NormalBlending
  const mainMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_MAIN,
    fragmentShader: FS_MAIN,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const mainPoints = new THREE.Points(geo, mainMat);
  mainPoints.frustumCulled = false;
  mainPoints.renderOrder = 1;
  scene.add(mainPoints);

  // Glow layer — AdditiveBlending
  const glowMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_GLOW,
    fragmentShader: FS_GLOW,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glowPoints = new THREE.Points(geo, glowMat);
  glowPoints.frustumCulled = false;
  glowPoints.renderOrder = 0;
  scene.add(glowPoints);

  return {
    uniforms,
    mainPoints,
    glowPoints,
    geo,
    setPalette(idx) {
      uniforms.uPaletteIndex.value = Math.min(3, Math.max(0, idx));
    },
    dispose() {
      mainPoints.geometry.dispose();
      mainMat.dispose();
      glowMat.dispose();
    }
  };
}

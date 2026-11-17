/**
 * Cena do orbe: geoide 3D girando devagar + partículas GPGPU saindo da superfície.
 * Carregado com import() dinâmico (Three.js fica fora do bundle inicial).
 *
 * Um único <canvas> é reaproveitado entre o orbe pequeno e o painel expandido:
 * muda só o tamanho, a câmera e o número de partículas ativas (drawRange).
 */
import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { orbPalette } from '@/lib/theme';
import { GEOID_FRAGMENT, GEOID_VERTEX, PARTICLE_FRAGMENT, PARTICLE_VERTEX, POSITION_SHADER, VELOCITY_SHADER } from './shaders';

export type OrbVisualState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
export type OrbMode = 'mini' | 'full';

export interface GeoidOptions {
  mobile: boolean;
  reducedMotion: boolean;
}

interface Params {
  speed: number;
  curl: number;
  orbit: number;
  condense: number;
  life: number;
  intensity: number;
  rot: number;
  pulse: number;
  desat: number;
}

const STATE_PARAMS: Record<OrbVisualState, Params> = {
  idle: { speed: 0.55, curl: 1.2, orbit: 0, condense: 0, life: 0.3, intensity: 0.85, rot: 0.05, pulse: 0, desat: 0 },
  connecting: { speed: 0.5, curl: 1.0, orbit: 0.2, condense: 0.25, life: 0.28, intensity: 0.75, rot: 0.08, pulse: 1, desat: 0 },
  listening: { speed: 0.7, curl: 1.4, orbit: 0, condense: 0, life: 0.34, intensity: 1, rot: 0.05, pulse: 0, desat: 0 },
  thinking: { speed: 0.9, curl: 0.9, orbit: 1.7, condense: 1.1, life: 0.45, intensity: 1.05, rot: 0.25, pulse: 0, desat: 0 },
  speaking: { speed: 0.75, curl: 1.4, orbit: 0.2, condense: 0, life: 0.36, intensity: 1.1, rot: 0.06, pulse: 0, desat: 0 },
  error: { speed: 0.3, curl: 0.6, orbit: 0, condense: 0.3, life: 0.2, intensity: 0.45, rot: 0.02, pulse: 0, desat: 0.75 },
};

const KEYS = Object.keys(STATE_PARAMS.idle) as (keyof Params)[];

/** Escala de partículas por dispositivo (lado da textura² = máximo de partículas). */
function tier(o: GeoidOptions) {
  if (o.reducedMotion) return { texSize: 112, miniFraction: 0.3, geoDetail: 26 }; // ~12,5k
  if (o.mobile) return { texSize: 144, miniFraction: 0.22, geoDetail: 30 }; // ~20,7k
  return { texSize: 224, miniFraction: 0.12, geoDetail: 44 }; // ~50k (orbe pequeno: ~6k)
}

const color = (hex: string) => new THREE.Color(hex);

export class GeoidScene {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  private group = new THREE.Group();
  private gpu: GPUComputationRenderer;
  private posVar: Variable;
  private velVar: Variable;
  private geoidMat: THREE.ShaderMaterial;
  private particleMat: THREE.ShaderMaterial;
  private particleGeo: THREE.BufferGeometry;
  private maxParticles: number;
  private miniFraction: number;
  private raf = 0;
  private last = 0;
  private time = 0;
  private level = 0;
  private levelSource: () => number = () => 0;
  private target: Params = { ...STATE_PARAMS.idle };
  private current: Params = { ...STATE_PARAMS.idle };
  private mode: OrbMode = 'mini';
  private camZ = 3.4;
  private reducedMotion: boolean;

  /** Cria a cena; devolve null se o navegador não tiver WebGL2. */
  static create(opts: GeoidOptions): GeoidScene | null {
    try {
      return new GeoidScene(opts);
    } catch (err) {
      console.warn('[voice] WebGL indisponível, usando orbe estático.', err);
      return null;
    }
  }

  private constructor(opts: GeoidOptions) {
    const t = tier(opts);
    this.reducedMotion = opts.reducedMotion;
    this.miniFraction = t.miniFraction;
    this.maxParticles = t.texSize * t.texSize;

    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(color(orbPalette.background), 1);
    this.scene.background = color(orbPalette.background);

    this.group.rotation.x = 0.32; // leve inclinação no eixo X
    this.scene.add(this.group);

    const colors = {
      uColA: { value: color(orbPalette.primary) },
      uColB: { value: color(orbPalette.cyan) },
      uColC: { value: color(orbPalette.violet) },
      uIntensity: { value: 1 },
      uDesat: { value: 0 },
    };

    // ---------------------------------------------------------------- geoide
    let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, t.geoDetail);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    geo = mergeVertices(geo);
    this.geoidMat = new THREE.ShaderMaterial({
      vertexShader: GEOID_VERTEX,
      fragmentShader: GEOID_FRAGMENT,
      uniforms: {
        ...THREE.UniformsUtils.clone(colors),
        uTime: { value: 0 },
        uAmp: { value: 0.14 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uPointSize: { value: 2 },
        uScale: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.group.add(new THREE.Points(geo, this.geoidMat));

    // ---------------------------------------------------------------- GPGPU
    this.gpu = new GPUComputationRenderer(t.texSize, t.texSize, this.renderer);
    if (opts.mobile) this.gpu.setDataType(THREE.HalfFloatType);
    const pos0 = this.gpu.createTexture();
    const vel0 = this.gpu.createTexture();
    const p = pos0.image.data as Float32Array;
    const v = vel0.image.data as Float32Array;
    for (let i = 0; i < this.maxParticles; i++) {
      const z = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      const rad = 1 + Math.random() * 0.4;
      p.set([r * Math.cos(th) * rad, z * rad, r * Math.sin(th) * rad, Math.random()], i * 4);
      v.set([0, 0, 0, Math.random()], i * 4);
    }
    this.posVar = this.gpu.addVariable('texturePosition', POSITION_SHADER, pos0);
    this.velVar = this.gpu.addVariable('textureVelocity', VELOCITY_SHADER, vel0);
    this.gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    this.gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);
    for (const variable of [this.posVar, this.velVar]) {
      Object.assign(variable.material.uniforms, {
        uTime: { value: 0 },
        uDt: { value: 0 },
        uSeed: { value: 0 },
        uLifeRate: { value: 0.3 },
        uAmp: { value: 0.14 },
        uSpeed: { value: 0.5 },
        uCurl: { value: 1 },
        uOrbit: { value: 0 },
        uCondense: { value: 0 },
      });
    }
    const err = this.gpu.init();
    if (err) throw new Error(err);

    // ---------------------------------------------------------------- partículas
    this.particleGeo = new THREE.BufferGeometry();
    const refs = new Float32Array(this.maxParticles * 2);
    const seeds = new Float32Array(this.maxParticles);
    for (let i = 0; i < this.maxParticles; i++) {
      refs[i * 2] = ((i % t.texSize) + 0.5) / t.texSize;
      refs[i * 2 + 1] = (Math.floor(i / t.texSize) + 0.5) / t.texSize;
      seeds[i] = Math.random();
    }
    // A posição real vem da textura; este atributo só define a contagem de vértices.
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxParticles * 3), 3));
    this.particleGeo.setAttribute('reference', new THREE.BufferAttribute(refs, 2));
    this.particleGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    this.particleGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    this.particleMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      uniforms: {
        ...THREE.UniformsUtils.clone(colors),
        uPositions: { value: null },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uSize: { value: 3 },
        uCamDist: { value: this.camZ },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(this.particleGeo, this.particleMat);
    points.frustumCulled = false;
    this.group.add(points);

    // ---------------------------------------------------------------- pós-processamento
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(72, 72), 0.6, 0.5, 0.12);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.setMode('mini');
  }

  setLevelSource(fn: () => number) {
    this.levelSource = fn;
  }

  setState(s: OrbVisualState) {
    this.target = { ...STATE_PARAMS[s] };
    if (this.reducedMotion) {
      this.target.rot *= 0.4;
      this.target.orbit *= 0.4;
      this.target.speed *= 0.6;
    }
  }

  setMode(mode: OrbMode) {
    this.mode = mode;
    const full = mode === 'full';
    this.camZ = full ? 4.6 : 3.35;
    this.camera.position.set(0, 0, this.camZ);
    this.camera.lookAt(0, 0, 0);
    this.particleMat.uniforms.uCamDist.value = this.camZ;
    this.particleMat.uniforms.uSize.value = full ? 2.4 : 1.8;
    this.geoidMat.uniforms.uPointSize.value = full ? 1.5 : 1.2;
    this.particleGeo.setDrawRange(0, full ? this.maxParticles : Math.floor(this.maxParticles * this.miniFraction));
    this.renderOnce();
  }

  setSize(w: number, h: number) {
    if (w < 1 || h < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.geoidMat.uniforms.uPixelRatio.value = dpr;
    this.particleMat.uniforms.uPixelRatio.value = dpr;
    this.renderOnce();
  }

  get running() {
    return this.raf !== 0;
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private renderOnce() {
    if (!this.raf) this.frame(0);
  }

  private frame(dt: number) {
    // Suavização (lerp exponencial) dos parâmetros do estado e da amplitude de áudio.
    const k = 1 - Math.exp(-dt * 3);
    for (const key of KEYS) this.current[key] += (this.target[key] - this.current[key]) * k;
    const raw = Math.max(0, Math.min(1, this.levelSource()));
    this.level += (raw - this.level) * (1 - Math.exp(-dt * (raw > this.level ? 14 : 5)));

    const c = this.current;
    const audio = this.level;
    this.time += dt;

    const amp = 0.14 + audio * 0.06;
    const pulse = 1 + c.pulse * 0.035 * Math.sin(this.time * 3.2);
    const intensity = c.intensity * (1 + audio * 0.35);

    for (const variable of [this.posVar, this.velVar]) {
      const u = variable.material.uniforms;
      u.uTime.value = this.time;
      u.uDt.value = dt;
      u.uSeed.value = Math.random() * 100;
      u.uLifeRate.value = c.life * (1 + audio * 1.8);
      u.uAmp.value = amp;
      u.uSpeed.value = c.speed * (1 + audio * 2.2);
      u.uCurl.value = c.curl;
      u.uOrbit.value = c.orbit;
      u.uCondense.value = c.condense;
    }
    if (dt > 0) this.gpu.compute();

    this.particleMat.uniforms.uPositions.value = this.gpu.getCurrentRenderTarget(this.posVar).texture;
    // No orbe pequeno a mesma malha cobre poucos pixels: reduz o ganho para não estourar.
    const full = this.mode === 'full';
    this.geoidMat.uniforms.uIntensity.value = intensity * (full ? 1 : 0.14);
    this.particleMat.uniforms.uIntensity.value = intensity * (full ? 1 : 0.6);
    for (const m of [this.particleMat, this.geoidMat]) m.uniforms.uDesat.value = c.desat;
    this.geoidMat.uniforms.uTime.value = this.time;
    this.geoidMat.uniforms.uAmp.value = amp;
    this.geoidMat.uniforms.uScale.value = pulse;

    this.group.rotation.y += c.rot * dt; // ~0,05 rad/s em repouso
    this.bloom.strength = (this.mode === 'full' ? 0.6 : 0.45) + audio * 0.35;
    this.composer.render(dt);
  }

  dispose() {
    this.stop();
    this.gpu.dispose();
    this.particleGeo.dispose();
    this.particleMat.dispose();
    this.geoidMat.dispose();
    this.group.traverse((o) => (o as THREE.Points).geometry?.dispose());
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

'use strict';

// ── System cząsteczek spalin silnika ──────────────────────────────────────────

class ExhaustParticles {
  constructor() {
    this.maxParts = 600;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.maxParts * 3);
    this.sizes     = new Float32Array(this.maxParts);
    this.alphas    = new Float32Array(this.maxParts);
    this.life      = new Float32Array(this.maxParts);
    this.vel       = new Float32Array(this.maxParts * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('size',     new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('alpha',    new THREE.BufferAttribute(this.alphas, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float size;attribute float alpha;varying float vAlpha;
        void main(){vAlpha=alpha;vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=size*(300.0/-mv.z);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `varying float vAlpha;
        void main(){float d=distance(gl_PointCoord,vec2(0.5));if(d>0.5)discard;
        float a=(1.0-d*2.0)*vAlpha;gl_FragColor=vec4(0.85,0.85,0.85,a);}`,
    });
    this.ps = new THREE.Points(geo, mat);
    this.ps.frustumCulled = false;
    scene.add(this.ps);
    this.idx = 0;
  }

  emit(pos, throttle, backDir) {
    if (throttle < 0.02) return;
    const count = Math.floor(throttle * 4);
    for (let c = 0; c < count; c++) {
      const i = this.idx % this.maxParts;
      this.positions[i * 3]     = pos.x + (Math.random() - .5) * 0.3;
      this.positions[i * 3 + 1] = pos.y + (Math.random() - .5) * 0.3;
      this.positions[i * 3 + 2] = pos.z + (Math.random() - .5) * 0.3;
      this.vel[i * 3]     = backDir.x * throttle * 0.8 + (Math.random() - .5) * 0.1;
      this.vel[i * 3 + 1] = 0.02 + Math.random() * 0.04;
      this.vel[i * 3 + 2] = backDir.z * throttle * 0.8 + (Math.random() - .5) * 0.1;
      this.life[i]   = 1.0;
      this.sizes[i]  = 1.5 + Math.random() * 2.5;
      this.alphas[i] = 0.35 * throttle;
      this.idx++;
    }
  }

  update(dt) {
    for (let i = 0; i < this.maxParts; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 0.9;
      this.positions[i * 3]     += this.vel[i * 3]     * dt * 60;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt * 60;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt * 60;
      this.sizes[i]  += dt * 8;
      this.alphas[i]  = Math.max(0, this.life[i] * 0.35);
    }
    this.ps.geometry.attributes.position.needsUpdate = true;
    this.ps.geometry.attributes.size.needsUpdate     = true;
    this.ps.geometry.attributes.alpha.needsUpdate    = true;
  }
}

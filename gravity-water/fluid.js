// fluid.js - High Performance WebGL Fluid Simulation
// Implementing a simplified Position Based Fluids (PBF) solver

const CONFIG = {
    particleCount: 1500, // Try 1500 for mobile balance
    radius: 12,          // Visual radius
    physRadius: 10,      // Physics collision radius
    gravityScale: 0.15,
    damping: 0.99,       // Friction
    stiffness: 0.08,     // How hard particles push apart (Pressure)
    stiffnessNear: 0.1,  // Near pressure
    restDensity: 5.0,    // Target density
    interactionRadius: 80,
    subSteps: 2          // Physics iterations per frame
};

// WebGL Globals
let gl;
let programs = {};
let buffers = {};
let textures = {};
let framebuffers = {};

// Physics Globals
let width, height;
let particles = {
    x: new Float32Array(CONFIG.particleCount),
    y: new Float32Array(CONFIG.particleCount),
    vx: new Float32Array(CONFIG.particleCount),
    vy: new Float32Array(CONFIG.particleCount),
    prevX: new Float32Array(CONFIG.particleCount),
    prevY: new Float32Array(CONFIG.particleCount)
};

// Spatial Hash Grid for collision optimization
const GRID_SIZE = CONFIG.physRadius * 2;
let grid = {}; // Hash map: key -> [particle_indices]

// State
let gravity = { x: 0, y: 1 };
let pointer = { x: -1000, y: -1000, down: false };
let isRunning = false;

// --- WebGL Helpers ---

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader Compile Error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vsSource, fsSource) {
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('Program Link Error:', gl.getProgramInfoLog(prog));
        return null;
    }
    return prog;
}

function initWebGL() {
    const canvas = document.getElementById('glcanvas');
    gl = canvas.getContext('webgl', { alpha: false, depth: false, antialias: false });
    
    if (!gl) {
        alert('WebGL not supported');
        return false;
    }

    // Extensions
    gl.getExtension('OES_texture_float'); // Ideally

    // Resize
    resize();
    window.addEventListener('resize', resize);

    // Compile Shaders
    const vsQuad = document.getElementById('vs-quad').textContent;
    const fsWater = document.getElementById('fs-water').textContent;
    const vsParticles = document.getElementById('vs-particles').textContent;
    const fsParticles = document.getElementById('fs-particles').textContent;

    programs.water = createProgram(gl, vsQuad, fsWater);
    programs.particles = createProgram(gl, vsParticles, fsParticles);

    // Buffers
    // Quad Buffer (for post-processing)
    const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    buffers.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.quad);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // Particles Buffer (Dynamic)
    buffers.particles = gl.createBuffer();
    // Size: x, y per particle
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.particles);
    gl.bufferData(gl.ARRAY_BUFFER, CONFIG.particleCount * 2 * 4, gl.DYNAMIC_DRAW);

    return true;
}

function createFramebuffer(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    
    return { tex, fb, width: w, height: h };
}

function resize() {
    const canvas = document.getElementById('glcanvas');
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    gl.viewport(0, 0, width, height);

    // Recreate Framebuffer for offscreen rendering (Water Surface)
    // We can downscale this for performance and "gooier" look
    const scale = 0.5; 
    framebuffers.water = createFramebuffer(width * scale, height * scale);
}

// --- Physics Engine (PBF Lite) ---

function initParticles() {
    const cols = Math.floor(Math.sqrt(CONFIG.particleCount));
    const spacing = CONFIG.physRadius * 2.2;
    const startX = (width - cols * spacing) / 2;
    const startY = height * 0.2;

    for (let i = 0; i < CONFIG.particleCount; i++) {
        let c = i % cols;
        let r = Math.floor(i / cols);
        particles.x[i] = startX + c * spacing;
        particles.y[i] = startY + r * spacing;
        particles.prevX[i] = particles.x[i];
        particles.prevY[i] = particles.y[i];
        particles.vx[i] = (Math.random() - 0.5) * 5;
        particles.vy[i] = (Math.random() - 0.5) * 5;
    }
}

// Spatial Hash Helper
function getGridKey(x, y) {
    const gx = Math.floor(x / GRID_SIZE);
    const gy = Math.floor(y / GRID_SIZE);
    return gx + "," + gy;
}

function updatePhysics() {
    // 1. Apply Gravity & External Forces
    for (let i = 0; i < CONFIG.particleCount; i++) {
        // Gravity
        particles.vx[i] += gravity.x * CONFIG.gravityScale;
        particles.vy[i] += gravity.y * CONFIG.gravityScale;

        // Mouse Interaction
        if (pointer.down) {
            const dx = particles.x[i] - pointer.x;
            const dy = particles.y[i] - pointer.y;
            const distSq = dx*dx + dy*dy;
            if (distSq < CONFIG.interactionRadius ** 2) {
                const dist = Math.sqrt(distSq);
                const force = (1 - dist / CONFIG.interactionRadius) * 2.0;
                const nx = dx / dist;
                const ny = dy / dist;
                particles.vx[i] += nx * force;
                particles.vy[i] += ny * force;
            }
        }

        // Prediction
        particles.prevX[i] = particles.x[i];
        particles.prevY[i] = particles.y[i];
        particles.x[i] += particles.vx[i];
        particles.y[i] += particles.vy[i];

        // Boundaries (Simple Box)
        const margin = CONFIG.radius;
        if (particles.x[i] < margin) particles.x[i] = margin;
        if (particles.x[i] > width - margin) particles.x[i] = width - margin;
        if (particles.y[i] < margin) particles.y[i] = margin;
        if (particles.y[i] > height - margin) particles.y[i] = height - margin;
    }

    // 2. Build Grid
    grid = {};
    for (let i = 0; i < CONFIG.particleCount; i++) {
        const key = getGridKey(particles.x[i], particles.y[i]);
        if (!grid[key]) grid[key] = [];
        grid[key].push(i);
    }

    // 3. Solve Constraints (Double Density Relaxation - PBF style)
    // This makes particles behave like a fluid (maintain density)
    for (let step = 0; step < CONFIG.subSteps; step++) {
        for (let i = 0; i < CONFIG.particleCount; i++) {
            let p_x = particles.x[i];
            let p_y = particles.y[i];
            
            // Find Neighbors
            let neighbors = [];
            const gx = Math.floor(p_x / GRID_SIZE);
            const gy = Math.floor(p_y / GRID_SIZE);
            
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const key = (gx + dx) + "," + (gy + dy);
                    const cell = grid[key];
                    if (cell) {
                        for (let k = 0; k < cell.length; k++) {
                            const j = cell[k];
                            if (i === j) continue;
                            const dx = particles.x[j] - p_x;
                            const dy = particles.y[j] - p_y;
                            const rSq = dx*dx + dy*dy;
                            if (rSq < GRID_SIZE * GRID_SIZE && rSq > 0.001) {
                                neighbors.push({ idx: j, dist: Math.sqrt(rSq), dx, dy });
                            }
                        }
                    }
                }
            }

            // Calculate Pressure
            let density = 0;
            let nearDensity = 0;
            
            for (let n of neighbors) {
                const q = 1 - (n.dist / GRID_SIZE);
                density += q * q;
                nearDensity += q * q * q;
            }

            // Equation of State
            const pressure = CONFIG.stiffness * (density - CONFIG.restDensity);
            const nearPressure = CONFIG.stiffnessNear * nearDensity;
            
            // Apply Displacements
            let dx = 0;
            let dy = 0;
            
            for (let n of neighbors) {
                const q = 1 - (n.dist / GRID_SIZE);
                // Displacement term
                const D = 0.5 * (pressure * q + nearPressure * q * q); // 0.5 is delta time squared approx
                
                const nx = n.dx / n.dist;
                const ny = n.dy / n.dist;
                
                const dispX = nx * D;
                const dispY = ny * D;
                
                // Apply half displacement to neighbor (Newton's 3rd law)
                particles.x[n.idx] += dispX;
                particles.y[n.idx] += dispY;
                
                dx -= dispX;
                dy -= dispY;
            }
            
            particles.x[i] += dx;
            particles.y[i] += dy;
        }
        
        // Enforce Boundaries again inside solver
        const margin = CONFIG.radius;
        for (let i = 0; i < CONFIG.particleCount; i++) {
             if (particles.x[i] < margin) particles.x[i] = margin;
             else if (particles.x[i] > width - margin) particles.x[i] = width - margin;
             if (particles.y[i] < margin) particles.y[i] = margin;
             else if (particles.y[i] > height - margin) particles.y[i] = height - margin;
        }
    }

    // 4. Update Velocities
    for (let i = 0; i < CONFIG.particleCount; i++) {
        let vx = (particles.x[i] - particles.prevX[i]);
        let vy = (particles.y[i] - particles.prevY[i]);
        
        // Explicitly damp velocity
        particles.vx[i] = vx * CONFIG.damping;
        particles.vy[i] = vy * CONFIG.damping;
    }
}

// --- Render Loop ---

function render() {
    if (!isRunning) return;

    updatePhysics();

    // 1. Draw Particles to Framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers.water.fb);
    gl.viewport(0, 0, framebuffers.water.width, framebuffers.water.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(programs.particles);
    
    // Update Buffer
    const positionData = new Float32Array(CONFIG.particleCount * 2);
    for (let i = 0; i < CONFIG.particleCount; i++) {
        positionData[i * 2] = particles.x[i];
        positionData[i * 2 + 1] = particles.y[i];
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.particles);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positionData);

    const aPos = gl.getAttribLocation(programs.particles, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(programs.particles, 'u_resolution');
    gl.uniform2f(uRes, framebuffers.water.width, framebuffers.water.height);
    
    const uSize = gl.getUniformLocation(programs.particles, 'u_pointSize');
    // Scale point size based on framebuffer scale
    gl.uniform1f(uSize, CONFIG.radius * 3.0); 

    // Enable Blending for "adding" particles (Metaball core)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for density accumulation

    gl.drawArrays(gl.POINTS, 0, CONFIG.particleCount);


    // 2. Draw Fullscreen Quad with Water Shader
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Screen
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.1, 0.1, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(programs.water);

    // Bind Quad Buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.quad);
    const aQuadPos = gl.getAttribLocation(programs.water, 'a_position');
    gl.enableVertexAttribArray(aQuadPos);
    gl.vertexAttribPointer(aQuadPos, 2, gl.FLOAT, false, 0, 0);

    // Bind Texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffers.water.tex);
    const uTex = gl.getUniformLocation(programs.water, 'u_texture');
    gl.uniform1i(uTex, 0);

    const uResWater = gl.getUniformLocation(programs.water, 'u_resolution');
    gl.uniform2f(uResWater, width, height);

    gl.disable(gl.BLEND); // Opaque water surface
    // Or enable for transparency:
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
    
    // Debug stats
    // document.getElementById('stats').innerText = `FPS: ${Math.round(1000/16)}`; 
}


// --- Interaction ---

function handleMotion(e) {
    let acc = e.accelerationIncludingGravity;
    if (acc) {
        // Mobile axes: X is left/right, Y is up/down
        // Screen axes: X is left/right, Y is down
        // Gravity pulls DOWN. If phone is upright, AccY is ~ -9.8 (on iOS) or +9.8 (Android)?
        // We will calibrate: Default upright = Gravity Y+ 
        
        // Let's assume standard behavior:
        // Tilt Right -> Gravity X+
        // Upright -> Gravity Y+
        
        const sensitivity = 0.5; // Stronger gravity
        
        // Invert X because usually tilting right gives negative or positive depending on device.
        // Let's try direct mapping. 
        // Note: accelerationIncludingGravity gives the force exerted BY the device to counter gravity?
        // Or the force OF gravity?
        
        // Usually: Upright -> y ~ 9.8. 
        // We map this to screen Y+
        gravity.x = -(acc.x || 0) * sensitivity;
        gravity.y = (acc.y || 0) * sensitivity;
    }
}

function start() {
    if (isRunning) return;
    
    document.getElementById('ui-layer').classList.add('hidden');
    
    if (initWebGL()) {
        initParticles();
        isRunning = true;
        render();

        // Sensors
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            DeviceMotionEvent.requestPermission().then(res => {
                if (res === 'granted') window.addEventListener('devicemotion', handleMotion);
            });
        } else {
            window.addEventListener('devicemotion', handleMotion);
        }
    }
}

// Listeners
document.getElementById('start-btn').addEventListener('click', start);

window.addEventListener('touchmove', e => {
    e.preventDefault();
    pointer.x = e.touches[0].clientX;
    pointer.y = e.touches[0].clientY;
    pointer.down = true;
}, { passive: false });
window.addEventListener('touchend', () => pointer.down = false);

window.addEventListener('mousemove', e => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.down = true;
});
window.addEventListener('mouseup', () => pointer.down = false);

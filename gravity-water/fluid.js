// fluid.js - Realistic AR Water Simulation

const CONFIG = {
    particleCount: 1500, 
    radius: 12,          
    physRadius: 10,      
    gravityScale: 0.15,
    damping: 0.985,      // Very low friction
    stiffness: 0.04,     // Softer water
    stiffnessNear: 0.1,  
    restDensity: 4.0,    
    interactionRadius: 80,
    subSteps: 3          
};

let gl;
let programs = {};
let buffers = {};
let textures = {};
let framebuffers = {};
let width, height;

// Physics State
let particles = {
    x: new Float32Array(CONFIG.particleCount),
    y: new Float32Array(CONFIG.particleCount),
    vx: new Float32Array(CONFIG.particleCount),
    vy: new Float32Array(CONFIG.particleCount),
    prevX: new Float32Array(CONFIG.particleCount),
    prevY: new Float32Array(CONFIG.particleCount)
};
const GRID_SIZE = CONFIG.physRadius * 2;
let grid = {};
let gravity = { x: 0, y: 1 };
let pointer = { x: -1000, y: -1000, down: false };
let isRunning = false;

// Camera State
let videoElement;
let isCameraActive = false;
let cameraReady = false;

// --- 1. System Initialization ---

function initWebGL() {
    const canvas = document.getElementById('glcanvas');
    gl = canvas.getContext('webgl', { alpha: false, depth: false, antialias: false });
    if (!gl) return false;

    gl.getExtension('OES_texture_float');

    resize();
    window.addEventListener('resize', resize);

    // Programs
    programs.water = createProgram(gl, 'vs-quad', 'fs-water');
    programs.particles = createProgram(gl, 'vs-particles', 'fs-particles');

    // Buffers
    buffers.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    buffers.particles = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.particles);
    gl.bufferData(gl.ARRAY_BUFFER, CONFIG.particleCount * 8, gl.DYNAMIC_DRAW);

    // Textures
    textures.bg = createDefaultTexture(gl); // Start with black/gradient
    textures.camera = gl.createTexture(); // Placeholder for video
    
    // Init Camera Texture params
    gl.bindTexture(gl.TEXTURE_2D, textures.camera);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return true;
}

function createProgram(gl, vsId, fsId) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, document.getElementById(vsId).textContent);
    gl.compileShader(vs);
    
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, document.getElementById(fsId).textContent);
    gl.compileShader(fs);

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
}

function resize() {
    const canvas = document.getElementById('glcanvas');
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    gl.viewport(0, 0, width, height);
    // Downscale water mask for performance and softness
    framebuffers.water = createFramebuffer(width * 0.5, height * 0.5);
}

function createFramebuffer(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, width: w, height: h };
}

function createDefaultTexture(gl) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    // Dark sleek gradient
    const grd = ctx.createLinearGradient(0,0,0,512);
    grd.addColorStop(0, '#111');
    grd.addColorStop(1, '#222');
    ctx.fillStyle = grd;
    ctx.fillRect(0,0,512,512);
    
    // Add some noise/pattern so water is visible even without camera
    ctx.fillStyle = '#333';
    for(let i=0; i<50; i++) {
        ctx.beginPath();
        ctx.arc(Math.random()*512, Math.random()*512, Math.random()*50, 0, Math.PI*2);
        ctx.fill();
    }

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
}

// --- 2. Camera Logic ---

async function toggleCamera() {
    const btn = document.getElementById('btn-cam');
    
    if (isCameraActive) {
        // Turn Off
        videoElement.srcObject.getTracks().forEach(t => t.stop());
        videoElement.srcObject = null;
        isCameraActive = false;
        cameraReady = false;
        btn.innerText = "Camera: OFF";
        btn.classList.remove('active');
    } else {
        // Turn On
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } // Rear camera preferred
            });
            videoElement.srcObject = stream;
            videoElement.play();
            isCameraActive = true;
            btn.innerText = "Camera: ON";
            btn.classList.add('active');
            
            videoElement.onplaying = () => {
                cameraReady = true;
            };
        } catch (e) {
            alert("Camera access failed or denied.");
            console.error(e);
        }
    }
}

// --- 3. Physics (PBF) ---

function initParticles() {
    const cols = Math.floor(Math.sqrt(CONFIG.particleCount));
    const spacing = CONFIG.physRadius * 2.2;
    const startX = (width - cols * spacing) / 2;
    for(let i=0; i<CONFIG.particleCount; i++){
        particles.x[i] = startX + (i%cols)*spacing;
        particles.y[i] = height*0.2 + Math.floor(i/cols)*spacing;
        particles.prevX[i] = particles.x[i];
        particles.prevY[i] = particles.y[i];
        particles.vx[i] = (Math.random()-0.5)*5;
        particles.vy[i] = (Math.random()-0.5)*5;
    }
}

function updatePhysics() {
    // 1. Gravity
    for(let i=0; i<CONFIG.particleCount; i++){
        particles.vx[i] += gravity.x * CONFIG.gravityScale;
        particles.vy[i] += gravity.y * CONFIG.gravityScale;
        
        if(pointer.down) {
            let dx = particles.x[i]-pointer.x;
            let dy = particles.y[i]-pointer.y;
            let d2 = dx*dx+dy*dy;
            if(d2 < CONFIG.interactionRadius**2){
                let d = Math.sqrt(d2);
                let f = (1 - d/CONFIG.interactionRadius)*3;
                particles.vx[i] += (dx/d)*f;
                particles.vy[i] += (dy/d)*f;
            }
        }
        
        particles.prevX[i] = particles.x[i];
        particles.prevY[i] = particles.y[i];
        particles.x[i] += particles.vx[i];
        particles.y[i] += particles.vy[i];
    }

    // 2. Constraints
    for(let s=0; s<CONFIG.subSteps; s++){
        // Build Grid
        grid = {};
        for(let i=0; i<CONFIG.particleCount; i++){
            let key = Math.floor(particles.x[i]/GRID_SIZE) + "," + Math.floor(particles.y[i]/GRID_SIZE);
            if(!grid[key]) grid[key]=[]; 
            grid[key].push(i);
        }

        for(let i=0; i<CONFIG.particleCount; i++){
            let neighbors = [];
            let px=particles.x[i], py=particles.y[i];
            let gx=Math.floor(px/GRID_SIZE), gy=Math.floor(py/GRID_SIZE);
            
            for(let x=gx-1; x<=gx+1; x++){
                for(let y=gy-1; y<=gy+1; y++){
                    let cell = grid[x+","+y];
                    if(cell){
                        for(let j of cell){
                            if(i===j) continue;
                            let dx=particles.x[j]-px;
                            let dy=particles.y[j]-py;
                            let d2=dx*dx+dy*dy;
                            if(d2 < GRID_SIZE*GRID_SIZE && d2>0.001){
                                neighbors.push({id:j, d:Math.sqrt(d2), dx, dy});
                            }
                        }
                    }
                }
            }
            
            let rho=0, rhoNear=0;
            for(let n of neighbors){
                let q = 1 - n.d/GRID_SIZE;
                rho += q*q;
                rhoNear += q*q*q;
            }
            
            let P = CONFIG.stiffness * (rho - CONFIG.restDensity);
            let PNear = CONFIG.stiffnessNear * rhoNear;
            let dx=0, dy=0;
            
            for(let n of neighbors){
                let q = 1 - n.d/GRID_SIZE;
                let D = 0.5 * (P*q + PNear*q*q);
                let ux = (n.dx/n.d)*D, uy = (n.dy/n.d)*D;
                particles.x[n.id] += ux; particles.y[n.id] += uy;
                dx -= ux; dy -= uy;
            }
            particles.x[i]+=dx; particles.y[i]+=dy;
        }

        const m=CONFIG.radius;
        for(let i=0; i<CONFIG.particleCount; i++){
            if(particles.x[i]<m) particles.x[i]=m;
            if(particles.x[i]>width-m) particles.x[i]=width-m;
            if(particles.y[i]<m) particles.y[i]=m;
            if(particles.y[i]>height-m) particles.y[i]=height-m;
        }
    }

    // 3. Update V
    for(let i=0; i<CONFIG.particleCount; i++){
        particles.vx[i] = (particles.x[i]-particles.prevX[i])*CONFIG.damping;
        particles.vy[i] = (particles.y[i]-particles.prevY[i])*CONFIG.damping;
    }
}

// --- 4. Render Loop ---

function render() {
    if(!isRunning) return;

    updatePhysics();

    // 1. Render Particles (Water Mask)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers.water.fb);
    gl.viewport(0, 0, framebuffers.water.width, framebuffers.water.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(programs.particles);

    const pos = new Float32Array(CONFIG.particleCount*2);
    for(let i=0; i<CONFIG.particleCount; i++){
        pos[i*2] = particles.x[i];
        pos[i*2+1] = particles.y[i];
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.particles);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    
    gl.enableVertexAttribArray(gl.getAttribLocation(programs.particles, 'a_position'));
    gl.vertexAttribPointer(gl.getAttribLocation(programs.particles, 'a_position'), 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(programs.particles, 'u_resolution'), framebuffers.water.width, framebuffers.water.height);
    gl.uniform1f(gl.getUniformLocation(programs.particles, 'u_pointSize'), CONFIG.radius * 3.0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, CONFIG.particleCount);

    // 2. Render Final Composition
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(programs.water);

    // Bind Water Mask
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffers.water.tex);
    gl.uniform1i(gl.getUniformLocation(programs.water, 'u_particles'), 0);

    // Bind Background (Camera or Default)
    gl.activeTexture(gl.TEXTURE1);
    if (isCameraActive && cameraReady) {
        gl.bindTexture(gl.TEXTURE_2D, textures.camera);
        // Upload video frame to texture
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);
    } else {
        gl.bindTexture(gl.TEXTURE_2D, textures.bg);
    }
    gl.uniform1i(gl.getUniformLocation(programs.water, 'u_bg'), 1);

    gl.uniform2f(gl.getUniformLocation(programs.water, 'u_resolution'), width, height);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.quad);
    gl.enableVertexAttribArray(gl.getAttribLocation(programs.water, 'a_position'));
    gl.vertexAttribPointer(gl.getAttribLocation(programs.water, 'a_position'), 2, gl.FLOAT, false, 0, 0);
    
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
}

// --- 5. Boot ---

videoElement = document.getElementById('cam-video');

document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('ui-layer').classList.add('hidden');
    document.getElementById('controls').classList.remove('hidden');
    
    if(initWebGL()) {
        initParticles();
        isRunning = true;
        render();

        // Motion Sensors
        if(typeof DeviceMotionEvent!=='undefined' && typeof DeviceMotionEvent.requestPermission==='function'){
            DeviceMotionEvent.requestPermission().then(r=>{if(r==='granted') window.addEventListener('devicemotion', handleMotion)});
        } else {
            window.addEventListener('devicemotion', handleMotion);
        }
    }
});

document.getElementById('btn-cam').addEventListener('click', toggleCamera);
document.getElementById('btn-reset').addEventListener('click', initParticles);

function handleMotion(e) {
    let acc = e.accelerationIncludingGravity;
    if (acc) {
        gravity.x = -(acc.x||0) * 0.5;
        gravity.y = (acc.y||0) * 0.5;
    }
}

// Interaction
window.addEventListener('touchmove', e=>{e.preventDefault(); pointer.x=e.touches[0].clientX; pointer.y=e.touches[0].clientY; pointer.down=true;}, {passive:false});
window.addEventListener('touchend', ()=>pointer.down=false);
window.addEventListener('mousemove', e=>{pointer.x=e.clientX; pointer.y=e.clientY; pointer.down=true;});
window.addEventListener('mouseup', ()=>pointer.down=false);

// fluid.js - Realistic AR Water (Debug Mode & Fixes)

const CONFIG = {
    particleCount: 1500,
    radius: 12,
    physRadius: 10,
    gravityScale: 0.15,
    damping: 0.985,
    stiffness: 0.04,
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

// Camera
let videoElement;
let isCameraActive = false;
let cameraReady = false;

// --- Debug Helper ---
function showError(msg) {
    alert("Error: " + msg);
    console.error(msg);
}

// --- 1. System Initialization ---

function initWebGL() {
    try {
        const canvas = document.getElementById('glcanvas');
        // Try getting context with fallback
        gl = canvas.getContext('webgl', { alpha: false, depth: false }) || 
             canvas.getContext('experimental-webgl');

        if (!gl) {
            showError("WebGL not supported on this device.");
            return false;
        }

        // Extensions
        const ext = gl.getExtension('OES_texture_float');
        if (!ext) console.warn("Float textures not supported, water might look glitchy.");

        resize();
        window.addEventListener('resize', resize);

        // Compile Programs
        programs.water = createProgram(gl, 'vs-quad', 'fs-water');
        programs.particles = createProgram(gl, 'vs-particles', 'fs-particles');

        if (!programs.water || !programs.particles) return false;

        // Buffers
        buffers.quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        buffers.particles = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.particles);
        // Size: Count * 2 floats * 4 bytes
        gl.bufferData(gl.ARRAY_BUFFER, CONFIG.particleCount * 8, gl.DYNAMIC_DRAW);

        // Textures
        textures.bg = createDefaultTexture(gl);
        textures.camera = gl.createTexture();
        
        gl.bindTexture(gl.TEXTURE_2D, textures.camera);
        // Use NEAREST/LINEAR based on needs
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // Upload a single black pixel to avoid warning if rendered before video
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));

        return true;
    } catch (e) {
        showError("Init Failed: " + e.message);
        return false;
    }
}

function createProgram(gl, vsId, fsId) {
    try {
        const vsEl = document.getElementById(vsId);
        const fsEl = document.getElementById(fsId);
        
        if (!vsEl || !fsEl) throw new Error(`Shader script missing: ${vsId} or ${fsId}`);

        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsEl.textContent);
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            throw new Error("VS Compile: " + gl.getShaderInfoLog(vs));
        }
        
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsEl.textContent);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            throw new Error("FS Compile: " + gl.getShaderInfoLog(fs));
        }

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error("Link: " + gl.getProgramInfoLog(prog));
        }
        return prog;
    } catch (e) {
        showError(e.message);
        return null;
    }
}

function resize() {
    if (!gl) return;
    const canvas = document.getElementById('glcanvas');
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    gl.viewport(0, 0, width, height);
    
    // Water Mask FBO
    // 0.5 scale for performance and better "blob" look
    framebuffers.water = createFramebuffer(Math.floor(width * 0.5), Math.floor(height * 0.5));
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
    
    // Gradient Background
    const grd = ctx.createLinearGradient(0,0,0,512);
    grd.addColorStop(0, '#1a1a1a');
    grd.addColorStop(1, '#000000');
    ctx.fillStyle = grd;
    ctx.fillRect(0,0,512,512);
    
    // Grid Lines for Refraction Reference
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    for(let i=0; i<512; i+=40) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
    }
    
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
}

// --- 2. Camera ---
async function toggleCamera() {
    const btn = document.getElementById('btn-cam');
    
    if (isCameraActive) {
        if (videoElement.srcObject) {
            videoElement.srcObject.getTracks().forEach(t => t.stop());
        }
        videoElement.srcObject = null;
        isCameraActive = false;
        cameraReady = false;
        btn.innerText = "Camera: OFF";
        btn.classList.remove('active');
    } else {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } 
            });
            videoElement.srcObject = stream;
            videoElement.play();
            isCameraActive = true;
            btn.innerText = "Camera: ON";
            btn.classList.add('active');
            
            videoElement.onplaying = () => { cameraReady = true; };
        } catch (e) {
            alert("Camera Error: " + e.message);
        }
    }
}

// --- 3. Physics ---
function initParticles() {
    const cols = Math.floor(Math.sqrt(CONFIG.particleCount));
    const spacing = CONFIG.physRadius * 2.2;
    const startX = (width - cols * spacing) / 2;
    for(let i=0; i<CONFIG.particleCount; i++){
        particles.x[i] = startX + (i%cols)*spacing;
        particles.y[i] = height*0.3 + Math.floor(i/cols)*spacing;
        particles.prevX[i] = particles.x[i];
        particles.prevY[i] = particles.y[i];
        particles.vx[i] = (Math.random()-0.5)*5;
        particles.vy[i] = (Math.random()-0.5)*5;
    }
}

function updatePhysics() {
    // Gravity
    for(let i=0; i<CONFIG.particleCount; i++){
        particles.vx[i] += gravity.x * CONFIG.gravityScale;
        particles.vy[i] += gravity.y * CONFIG.gravityScale;
        
        // Touch Repel
        if(pointer.down) {
            let dx = particles.x[i]-pointer.x;
            let dy = particles.y[i]-pointer.y;
            let d2 = dx*dx+dy*dy;
            if(d2 < CONFIG.interactionRadius**2){
                let d = Math.sqrt(d2);
                let f = (1 - d/CONFIG.interactionRadius)*4.0;
                particles.vx[i] += (dx/d)*f;
                particles.vy[i] += (dy/d)*f;
            }
        }
        
        particles.prevX[i] = particles.x[i];
        particles.prevY[i] = particles.y[i];
        particles.x[i] += particles.vx[i];
        particles.y[i] += particles.vy[i];
    }

    // Solve Constraints (PBF)
    for(let s=0; s<CONFIG.subSteps; s++){
        grid = {};
        for(let i=0; i<CONFIG.particleCount; i++){
            let k = Math.floor(particles.x[i]/GRID_SIZE) + "," + Math.floor(particles.y[i]/GRID_SIZE);
            if(!grid[k]) grid[k]=[]; grid[k].push(i);
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

        const m = CONFIG.radius;
        for(let i=0; i<CONFIG.particleCount; i++){
            if(particles.x[i]<m) particles.x[i]=m;
            if(particles.x[i]>width-m) particles.x[i]=width-m;
            if(particles.y[i]<m) particles.y[i]=m;
            if(particles.y[i]>height-m) particles.y[i]=height-m;
        }
    }

    for(let i=0; i<CONFIG.particleCount; i++){
        particles.vx[i] = (particles.x[i]-particles.prevX[i])*CONFIG.damping;
        particles.vy[i] = (particles.y[i]-particles.prevY[i])*CONFIG.damping;
    }
}

// --- 4. Render ---
function render() {
    if(!isRunning) return;
    updatePhysics();

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

    // Final Pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(programs.water);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffers.water.tex);
    gl.uniform1i(gl.getUniformLocation(programs.water, 'u_particles'), 0);

    gl.activeTexture(gl.TEXTURE1);
    if (isCameraActive && cameraReady) {
        gl.bindTexture(gl.TEXTURE_2D, textures.camera);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);
        } catch(e) { /* ignore texture upload errors if frame not ready */ }
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
window.addEventListener('load', () => {
    videoElement = document.getElementById('cam-video');
    const startBtn = document.getElementById('start-btn');
    const camBtn = document.getElementById('btn-cam');
    const resetBtn = document.getElementById('btn-reset');

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            try {
                document.getElementById('ui-layer').classList.add('hidden');
                document.getElementById('controls').classList.remove('hidden');
                
                if(initWebGL()) {
                    initParticles();
                    isRunning = true;
                    render();
                    
                    if(typeof DeviceMotionEvent!=='undefined' && typeof DeviceMotionEvent.requestPermission==='function'){
                        DeviceMotionEvent.requestPermission()
                            .then(r => { 
                                if(r==='granted') window.addEventListener('devicemotion', handleMotion);
                                else showError("Sensor permission denied");
                            })
                            .catch(e => showError("Sensor Error: " + e.message));
                    } else {
                        window.addEventListener('devicemotion', handleMotion);
                    }
                }
            } catch (e) {
                showError("Start Error: " + e.message);
            }
        });
    }

    if(camBtn) camBtn.addEventListener('click', toggleCamera);
    if(resetBtn) resetBtn.addEventListener('click', initParticles);
    
    // Interaction
    window.addEventListener('touchmove', e=>{e.preventDefault(); pointer.x=e.touches[0].clientX; pointer.y=e.touches[0].clientY; pointer.down=true;}, {passive:false});
    window.addEventListener('touchend', ()=>pointer.down=false);
    window.addEventListener('mousemove', e=>{pointer.x=e.clientX; pointer.y=e.clientY; pointer.down=true;});
    window.addEventListener('mouseup', ()=>pointer.down=false);
});

function handleMotion(e) {
    let acc = e.accelerationIncludingGravity;
    if (acc) {
        // Sensitivity
        gravity.x = -(acc.x||0) * 0.5;
        gravity.y = (acc.y||0) * 0.5;
    }
}
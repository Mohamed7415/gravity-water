// fluid.js - Realistic AR Water V5 (Volumetric Thickness)

const CONFIG = {
    particleCount: 900,
    radius: 20,          // Even fatter particles for volumetric look
    physRadius: 15,
    gravityScale: 0.18,
    damping: 0.96,
    stiffness: 0.02,     // Softer = more stacking = more thickness
    stiffnessNear: 0.1,
    restDensity: 3.0,
    interactionRadius: 120, // Interaction radius
    subSteps: 2
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

// --- Debug System ---
function log(msg) {
    console.log(msg);
    const el = document.getElementById('debug-console');
    if(el) {
        el.innerHTML = `> ${msg}<br>` + el.innerHTML;
        if(el.innerHTML.length > 500) el.innerHTML = el.innerHTML.slice(0, 500);
    }
}
function showError(msg) { log("[ERROR] " + msg); alert(msg); }

// --- 1. WebGL Core ---
function initWebGL() {
    log("Init WebGL V5...");
    try {
        const canvas = document.getElementById('glcanvas');
        gl = canvas.getContext('webgl', { alpha: false, depth: false }) || canvas.getContext('experimental-webgl');
        if (!gl) throw new Error("WebGL fail");
        
        // High DPI Support
        const dpr = window.devicePixelRatio || 1;
        const effectiveDPR = Math.min(dpr, 2.0);
        
        canvas.width = window.innerWidth * effectiveDPR;
        canvas.height = window.innerHeight * effectiveDPR;
        width = canvas.width;
        height = canvas.height;

        if (!gl.getExtension('OES_texture_float')) log("WARN: No float textures");

        programs.water = createProgram(gl, 'vs-quad', 'fs-water');
        programs.particles = createProgram(gl, 'vs-particles', 'fs-particles');
        if (!programs.water || !programs.particles) throw new Error("Shader error");

        buffers.quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        buffers.particles = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.particles);
        gl.bufferData(gl.ARRAY_BUFFER, CONFIG.particleCount * 8, gl.DYNAMIC_DRAW);

        textures.bg = createDefaultTexture(gl);
        textures.camera = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, textures.camera);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));

        // Water Mask FBO: 0.8 scale for better volume
        framebuffers.water = createFramebuffer(Math.floor(width * 0.8), Math.floor(height * 0.8));

        return true;
    } catch (e) {
        showError(e.message);
        return false;
    }
}

function createProgram(gl, vsId, fsId) {
    try {
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, document.getElementById(vsId).textContent);
        gl.compileShader(vs);
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, document.getElementById(fsId).textContent);
        gl.compileShader(fs);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        return prog;
    } catch (e) { return null; }
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
    const grd = ctx.createLinearGradient(0,0,0,512);
    grd.addColorStop(0, '#222'); grd.addColorStop(1, '#000');
    ctx.fillStyle = grd; ctx.fillRect(0,0,512,512);
    
    // Colorful dots for refraction test
    for(let i=0; i<100; i++) {
        ctx.fillStyle = `hsl(${Math.random()*360}, 80%, 60%)`;
        ctx.beginPath();
        ctx.arc(Math.random()*512, Math.random()*512, Math.random()*5+2, 0, Math.PI*2);
        ctx.fill();
    }
    
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return tex;
}

// --- Camera ---
async function toggleCamera() {
    const btn = document.getElementById('btn-cam');
    if (isCameraActive) {
        if(videoElement.srcObject) videoElement.srcObject.getTracks().forEach(t=>t.stop());
        videoElement.srcObject=null; isCameraActive=false; cameraReady=false;
        btn.innerText = "Camera: OFF"; btn.classList.remove('active');
    } else {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            videoElement.srcObject = stream; videoElement.play();
            isCameraActive=true; btn.innerText="Camera: ON"; btn.classList.add('active');
            videoElement.onplaying = () => cameraReady = true;
        } catch (e) { alert("Camera Fail: "+e.message); }
    }
}

// --- Physics (Optimized) ---
function initParticles() {
    const cols = Math.floor(Math.sqrt(CONFIG.particleCount));
    const spacing = CONFIG.physRadius * 2.2;
    const startX = (width/window.devicePixelRatio - cols * spacing) / 2; 
    for(let i=0; i<CONFIG.particleCount; i++){
        particles.x[i] = startX + (i%cols)*spacing;
        particles.y[i] = height*0.1 + Math.floor(i/cols)*spacing;
        particles.prevX[i] = particles.x[i]; particles.prevY[i] = particles.y[i];
        particles.vx[i]=0; particles.vy[i]=0;
    }
}

function updatePhysics() {
    const dpr = width / window.innerWidth;
    for(let i=0; i<CONFIG.particleCount; i++){
        particles.vx[i] += gravity.x * CONFIG.gravityScale;
        particles.vy[i] += gravity.y * CONFIG.gravityScale;
        
        if(pointer.down) {
            let dx = particles.x[i] - pointer.x * dpr;
            let dy = particles.y[i] - pointer.y * dpr;
            let d2 = dx*dx+dy*dy;
            let iR = CONFIG.interactionRadius * dpr;
            if(d2 < iR*iR){
                let d = Math.sqrt(d2);
                let f = (1 - d/iR)*4.0;
                particles.vx[i] += (dx/d)*f;
                particles.vy[i] += (dy/d)*f;
            }
        }
        particles.prevX[i] = particles.x[i]; particles.prevY[i] = particles.y[i];
        particles.x[i] += particles.vx[i]; particles.y[i] += particles.vy[i];
    }

    const boundW = width; 
    const boundH = height;
    
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
                            let dx=particles.x[j]-px, dy=particles.y[j]-py, d2=dx*dx+dy*dy;
                            if(d2 < GRID_SIZE*GRID_SIZE && d2>0.001) neighbors.push({id:j, d:Math.sqrt(d2), dx, dy});
                        }
                    }
                }
            }
            let rho=0, rhoNear=0;
            for(let n of neighbors){ let q=1-n.d/GRID_SIZE; rho+=q*q; rhoNear+=q*q*q; }
            let P=CONFIG.stiffness*(rho-CONFIG.restDensity), PNear=CONFIG.stiffnessNear*rhoNear;
            let dx=0, dy=0;
            for(let n of neighbors){
                let q=1-n.d/GRID_SIZE, D=0.5*(P*q+PNear*q*q);
                let ux=(n.dx/n.d)*D, uy=(n.dy/n.d)*D;
                particles.x[n.id]+=ux; particles.y[n.id]+=uy; dx-=ux; dy-=uy;
            }
            particles.x[i]+=dx; particles.y[i]+=dy;
        }
        const m = CONFIG.radius;
        for(let i=0; i<CONFIG.particleCount; i++){
            if(particles.x[i]<m) particles.x[i]=m;
            if(particles.x[i]>boundW-m) particles.x[i]=boundW-m;
            if(particles.y[i]<m) particles.y[i]=m;
            if(particles.y[i]>boundH-m) particles.y[i]=boundH-m;
        }
    }

    for(let i=0; i<CONFIG.particleCount; i++){
        particles.vx[i] = (particles.x[i]-particles.prevX[i])*CONFIG.damping;
        particles.vy[i] = (particles.y[i]-particles.prevY[i])*CONFIG.damping;
    }
}

// --- Render ---
function render() {
    if(!isRunning) return;
    updatePhysics();

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers.water.fb);
    gl.viewport(0, 0, framebuffers.water.width, framebuffers.water.height);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(programs.particles);

    const pos = new Float32Array(CONFIG.particleCount*2);
    for(let i=0; i<CONFIG.particleCount; i++){ pos[i*2]=particles.x[i]; pos[i*2+1]=particles.y[i]; }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.particles);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    
    gl.enableVertexAttribArray(gl.getAttribLocation(programs.particles, 'a_position'));
    gl.vertexAttribPointer(gl.getAttribLocation(programs.particles, 'a_position'), 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(programs.particles, 'u_resolution'), framebuffers.water.width, framebuffers.water.height);
    gl.uniform1f(gl.getUniformLocation(programs.particles, 'u_pointSize'), CONFIG.radius * 3.0); 
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, CONFIG.particleCount);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(programs.water);

    // Get Slider Values
    const thickVal = document.getElementById('val-thickness').value;
    const densVal = document.getElementById('val-density').value;

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, framebuffers.water.tex);
    gl.uniform1i(gl.getUniformLocation(programs.water, 'u_particles'), 0);

    gl.activeTexture(gl.TEXTURE1);
    if (isCameraActive && cameraReady) {
        gl.bindTexture(gl.TEXTURE_2D, textures.camera);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement); } catch(e){}
    } else {
        gl.bindTexture(gl.TEXTURE_2D, textures.bg);
    }
    gl.uniform1i(gl.getUniformLocation(programs.water, 'u_bg'), 1);
    gl.uniform2f(gl.getUniformLocation(programs.water, 'u_resolution'), width, height);
    
    // Pass Uniforms
    gl.uniform1f(gl.getUniformLocation(programs.water, 'u_refractionStr'), parseFloat(thickVal));
    gl.uniform1f(gl.getUniformLocation(programs.water, 'u_density'), parseFloat(densVal));

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.quad);
    gl.enableVertexAttribArray(gl.getAttribLocation(programs.water, 'a_position'));
    gl.vertexAttribPointer(gl.getAttribLocation(programs.water, 'a_position'), 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
}

// --- Boot ---
function startGame(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (isRunning) return;
    
    document.getElementById('ui-layer').classList.add('hidden');
    document.getElementById('controls').classList.remove('hidden');

    if (initWebGL()) {
        initParticles();
        isRunning = true;
        render();
        
        if(typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'){
            DeviceMotionEvent.requestPermission()
                .then(r => { if (r === 'granted') window.addEventListener('devicemotion', handleMotion); })
                .catch(err => log("Sensors: " + err));
        } else {
            window.addEventListener('devicemotion', handleMotion);
        }
    }
}

window.addEventListener('load', () => {
    videoElement = document.getElementById('cam-video');
    const startBtn = document.getElementById('start-btn');
    if(startBtn) {
        startBtn.addEventListener('touchend', startGame);
        startBtn.addEventListener('click', startGame);
    }
    document.body.addEventListener('click', (e) => {
        // Only trigger global start if not clicking UI controls
        if (!isRunning && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') startGame(e);
    });
    document.getElementById('btn-cam').addEventListener('click', toggleCamera);
    document.getElementById('btn-reset').addEventListener('click', initParticles);
    
    window.addEventListener('touchmove', e=>{e.preventDefault(); pointer.x=e.touches[0].clientX; pointer.y=e.touches[0].clientY; pointer.down=true;}, {passive:false});
    window.addEventListener('touchend', ()=>pointer.down=false);
    window.addEventListener('mousemove', e=>{pointer.x=e.clientX; pointer.y=e.clientY; pointer.down=true;});
    window.addEventListener('mouseup', ()=>pointer.down=false);
});

function handleMotion(e) {
    let acc = e.accelerationIncludingGravity;
    if (acc) { gravity.x = -(acc.x||0) * 0.5; gravity.y = (acc.y||0) * 0.5; }
}

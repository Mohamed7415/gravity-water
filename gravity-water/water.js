// Configuration
const CONFIG = {
    particleCount: 200, // Increased count
    particleRadius: 15, 
    gravityScale: 0.5,
    damping: 0.96, 
    interactionRadius: 100,
    repulsionStrength: 2,
    color: '#00ccff'
};

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let width, height;

// Gravity Vector
let gravity = { x: 0, y: 1 }; // Default downwards
let useSensorGravity = false;

// Interaction
let pointer = { x: -1000, y: -1000, active: false };

class Particle {
    constructor() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10;
        this.radius = CONFIG.particleRadius * (0.8 + Math.random() * 0.4);
    }

    update() {
        // Apply Gravity
        this.vx += gravity.x * CONFIG.gravityScale;
        this.vy += gravity.y * CONFIG.gravityScale;

        // Apply Mouse/Touch Repulsion
        if (pointer.active) {
            const dx = this.x - pointer.x;
            const dy = this.y - pointer.y;
            const distSq = dx * dx + dy * dy;
            const minDist = CONFIG.interactionRadius * CONFIG.interactionRadius;

            if (distSq < minDist) {
                const dist = Math.sqrt(distSq);
                const force = (CONFIG.interactionRadius - dist) / CONFIG.interactionRadius;
                const angle = Math.atan2(dy, dx);
                
                this.vx += Math.cos(angle) * force * CONFIG.repulsionStrength * 5;
                this.vy += Math.sin(angle) * force * CONFIG.repulsionStrength * 5;
            }
        }

        // Apply Velocity
        this.x += this.vx;
        this.y += this.vy;

        // Damping
        this.vx *= CONFIG.damping;
        this.vy *= CONFIG.damping;

        // Screen Boundaries
        const bounce = -0.7;
        
        if (this.x < this.radius) {
            this.x = this.radius;
            this.vx *= bounce;
        } else if (this.x > width - this.radius) {
            this.x = width - this.radius;
            this.vx *= bounce;
        }

        if (this.y < this.radius) {
            this.y = this.radius;
            this.vy *= bounce;
        } else if (this.y > height - this.radius) {
            this.y = height - this.radius;
            this.vy *= bounce;
        }
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = CONFIG.color;
        ctx.fill();
        ctx.closePath();
    }
}

let particles = [];
let animationId;

function init() {
    onResize();
    // Create particles
    particles = [];
    for (let i = 0; i < CONFIG.particleCount; i++) {
        particles.push(new Particle());
    }
    
    if (!animationId) {
        animate();
    }
}

function animate() {
    ctx.clearRect(0, 0, width, height);

    // Simple particle-particle collision (Brute Force optimized)
    for (let i = 0; i < particles.length; i++) {
        let p1 = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
            let p2 = particles[j];
            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let distSq = dx*dx + dy*dy;
            let minDist = (p1.radius + p2.radius);
            
            if (distSq < minDist * minDist) {
                let dist = Math.sqrt(distSq);
                // Push apart
                let overlap = minDist - dist;
                let nx = dx / dist;
                let ny = dy / dist;
                
                // Separate slightly
                let separateCoeff = 0.5; 
                p1.x -= nx * overlap * separateCoeff;
                p1.y -= ny * overlap * separateCoeff;
                p2.x += nx * overlap * separateCoeff;
                p2.y += ny * overlap * separateCoeff;
            }
        }
        p1.update();
        p1.draw();
    }

    animationId = requestAnimationFrame(animate);
}

function onResize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}

// Sensor Logic
function handleMotion(event) {
    let acc = event.accelerationIncludingGravity;
    if (!acc) return;

    // Map accelerometer to gravity vector
    // Standard Mobile:
    // X: Left(-)/Right(+)
    // Y: Down(-)/Up(+)  (Note: depends on device, usually Up is positive)
    
    // We want: 
    // Phone tilted Right -> Gravity flows Right (X+)
    // Phone Upright -> Gravity flows Down (Y+)
    
    // Adjust sensitivity and direction based on empirical testing
    // Usually on Android/iOS Web:
    // Holding upright: Y is ~ -9.8 (or +9.8 depending on browser)
    // Let's assume inverted Y for screen coordinates.
    
    // Simple Mapping:
    gravity.x = -(acc.x || 0); 
    gravity.y = (acc.y || 0);
}

function startApp() {
    // 1. Hide Overlay
    document.getElementById('start-overlay').style.display = 'none';
    document.getElementById('instructions').classList.remove('hidden');

    // 2. Request Permission (iOS 13+)
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission()
            .then(response => {
                if (response === 'granted') {
                    window.addEventListener('devicemotion', handleMotion);
                } else {
                    alert('Gravity sensor permission denied. Using mouse/touch only.');
                }
            })
            .catch(console.error);
    } else {
        // Non-iOS 13+ devices
        window.addEventListener('devicemotion', handleMotion);
    }

    // 3. Init
    init();
}

// Event Listeners
window.addEventListener('resize', onResize);

// Mouse Interaction
window.addEventListener('mousemove', e => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
    document.getElementById('instructions').classList.add('hidden');
});
window.addEventListener('mousedown', () => pointer.active = true);
window.addEventListener('mouseup', () => pointer.active = false);

// Touch Interaction
window.addEventListener('touchmove', e => {
    e.preventDefault();
    pointer.x = e.touches[0].clientX;
    pointer.y = e.touches[0].clientY;
    pointer.active = true;
    document.getElementById('instructions').classList.add('hidden');
}, { passive: false });
window.addEventListener('touchend', () => pointer.active = false);

// Start Button
document.getElementById('start-btn').addEventListener('click', startApp);

// Initial Resize (but don't start loop yet)
onResize();
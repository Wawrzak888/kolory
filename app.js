
// State
const state = {
    isPlaying: false,
    currentLevel: 0,
    currentTarget: null, // 'red', 'green', 'blue', 'yellow'
    score: 0,
    lastMatchTime: 0
};

// Config
const COLORS = {
    'red': { h: [345, 15], s: [20, 100], l: [15, 85], name: 'czerwony', hex: '#ff4757' },
    'green': { h: [75, 150], s: [20, 100], l: [15, 85], name: 'zielony', hex: '#2ecc71' },
    'blue': { h: [190, 250], s: [20, 100], l: [15, 85], name: 'niebieski', hex: '#3742fa' },
    'yellow': { h: [45, 70], s: [20, 100], l: [15, 85], name: 'żółty', hex: '#f1c40f' }
};

// DOM Elements
const video = document.getElementById('camera-feed');
const canvas = document.getElementById('process-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const uiStart = document.getElementById('start-screen');
const uiPermission = document.getElementById('permission-screen');
const uiTarget = document.getElementById('target-display');
const targetIcon = document.getElementById('target-icon');
const instructionText = document.getElementById('instruction-text');
const uiFeedback = document.getElementById('feedback-overlay');
const startBtn = document.getElementById('start-btn');
const permBtn = document.getElementById('perm-btn');

// Audio / TTS
let polishVoice = null;
const synth = window.speechSynthesis;

// -------------------------------------------------------------------------
// 1. Initialization & Permissions
// -------------------------------------------------------------------------

async function init() {
    startBtn.addEventListener('click', () => {
        uiStart.classList.add('hidden');
        uiPermission.classList.remove('hidden');
    });

    permBtn.addEventListener('click', async () => {
        await startCamera();
        uiPermission.classList.add('hidden');
        startGame();
    });

    // Handle visibility change for iOS camera resume
    document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible") {
            if (!video.srcObject || !video.srcObject.active) {
                console.log("Restarting camera stream...");
                await startCamera();
            }
            video.play();
        }
    });

    // Initialize TTS
    if (synth.onvoiceschanged !== undefined) {
        synth.onvoiceschanged = loadVoices;
    }
    loadVoices();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker failed', err));
    }
}

async function startCamera() {
    try {
        const constraints = {
            audio: false,
            video: {
                facingMode: 'environment', // Rear camera
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            // Adjust canvas size to match video
            canvas.width = 300; // Downscale for performance
            canvas.height = 300 * (video.videoHeight / video.videoWidth);
        };
    } catch (err) {
        console.error("Camera error:", err);
        alert("Nie udało się uruchomić kamery. Sprawdź uprawnienia.");
    }
}

// -------------------------------------------------------------------------
// 2. Audio & TTS
// -------------------------------------------------------------------------

function loadVoices() {
    const voices = synth.getVoices();
    // Prefer local polish voice, then any polish voice
    polishVoice = voices.find(v => v.lang === 'pl-PL' && v.localService) 
               || voices.find(v => v.lang === 'pl-PL');
    console.log("Selected Voice:", polishVoice ? polishVoice.name : "None");
}

function speak(text) {
    if (!polishVoice) {
        loadVoices(); // Try again
        if (!polishVoice) return; // Fallback to silent or beep?
    }
    
    // Cancel previous speech
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = polishVoice;
    utterance.rate = 1.0;
    utterance.pitch = 1.1; // Slightly higher for kids
    synth.speak(utterance);
}

// -------------------------------------------------------------------------
// 3. Color Detection Logic (HSL)
// -------------------------------------------------------------------------

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s * 100, l * 100];
}

function isColorMatch(h, s, l, targetKey) {
    // Basic validation
    if (s < 20 || l < 15 || l > 85) return false;

    const target = COLORS[targetKey];
    if (!target) return false;

    // Check hue
    let hueMatch = false;
    // Handle red wrap-around
    if (targetKey === 'red') {
        hueMatch = (h >= target.h[0] || h <= target.h[1]);
    } else {
        hueMatch = (h >= target.h[0] && h <= target.h[1]);
    }

    return hueMatch;
}

// -------------------------------------------------------------------------
// 4. Game Loop
// -------------------------------------------------------------------------

function startGame() {
    state.isPlaying = true;
    pickNewTarget();
    requestAnimationFrame(gameLoop);
}

function pickNewTarget() {
    const keys = Object.keys(COLORS);
    const nextKey = keys[Math.floor(Math.random() * keys.length)];
    state.currentTarget = nextKey;
    
    // Update UI
    uiTarget.classList.remove('hidden');
    targetIcon.style.backgroundColor = COLORS[nextKey].hex;
    instructionText.innerText = `Znajdź ${COLORS[nextKey].name}`;
    
    // Speak
    speak(`Znajdź kolor ${COLORS[nextKey].name}`);
}

function handleSuccess() {
    const now = Date.now();
    if (now - state.lastMatchTime < 3000) return; // Cooldown
    state.lastMatchTime = now;

    // Feedback
    speak("Brawo! To ten kolor!");
    
    // Visuals
    uiFeedback.classList.remove('hidden');
    confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
    });

    // Haptic
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    setTimeout(() => {
        uiFeedback.classList.add('hidden');
        pickNewTarget();
    }, 2000);
}

function gameLoop() {
    if (!state.isPlaying) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // Draw current video frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Analyze center area (e.g. 50x50 pixels in the middle)
        const centerX = Math.floor(canvas.width / 2);
        const centerY = Math.floor(canvas.height / 2);
        const size = 50;
        const frame = ctx.getImageData(centerX - size/2, centerY - size/2, size, size);
        const data = frame.data;
        
        let matchCount = 0;
        const totalPixels = data.length / 4;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            
            const [h, s, l] = rgbToHsl(r, g, b);
            if (isColorMatch(h, s, l, state.currentTarget)) {
                matchCount++;
            }
        }

        // If > 30% pixels match, trigger success
        if (matchCount > totalPixels * 0.3) {
            handleSuccess();
        }
    }

    requestAnimationFrame(gameLoop);
}

// Start
init();

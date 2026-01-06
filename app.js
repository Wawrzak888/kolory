
// State
const state = {
    isPlaying: false,
    currentLevel: 0,
    currentTarget: null, // 'red', 'green', 'blue', 'yellow'
    score: 0,
    lastMatchTime: 0,
    playerName: '',
    playerGender: 'MALE', // 'MALE' | 'FEMALE'
    confidence: 0.0 // 0.0 - 1.0
};

// Config
const CONFIDENCE_THRESHOLD = 1.0;
const CHARGE_SPEED = 0.04;
const DECAY_SPEED = 0.08;

const COLORS = {
    'red': { 
        ranges: [
            { h: [345, 360], s: [20, 100], l: [15, 85] },
            { h: [0, 15], s: [20, 100], l: [15, 85] }
        ],
        name: 'czerwony', hex: '#ff4757' 
    },
    'green': { 
        ranges: [{ h: [75, 150], s: [20, 100], l: [15, 85] }],
        name: 'zielony', hex: '#2ecc71' 
    },
    'blue': { 
        ranges: [{ h: [190, 250], s: [20, 100], l: [15, 85] }],
        name: 'niebieski', hex: '#3742fa' 
    },
    'yellow': { 
        ranges: [{ h: [45, 70], s: [20, 100], l: [15, 85] }],
        name: 'żółty', hex: '#f1c40f' 
    },
    'orange': { 
        ranges: [{ h: [15, 45], s: [20, 100], l: [15, 85] }],
        name: 'pomarańczowy', hex: '#e67e22' 
    },
    'purple': { 
        ranges: [{ h: [250, 290], s: [20, 100], l: [15, 85] }],
        name: 'fioletowy', hex: '#9b59b6' 
    },
    'pink': { 
        ranges: [{ h: [290, 345], s: [20, 100], l: [15, 85] }],
        name: 'różowy', hex: '#ff6b81' 
    },
    'cyan': { 
        ranges: [{ h: [150, 190], s: [20, 100], l: [15, 85] }],
        name: 'turkusowy', hex: '#00cec9' 
    },
    'white': { 
        ranges: [{ h: [0, 360], s: [0, 20], l: [80, 100] }],
        name: 'biały', hex: '#ffffff' 
    },
    'black': { 
        ranges: [{ h: [0, 360], s: [0, 100], l: [0, 15] }],
        name: 'czarny', hex: '#2f3542' 
    },
    'gray': { 
        ranges: [{ h: [0, 360], s: [0, 20], l: [15, 80] }],
        name: 'szary', hex: '#a4b0be' 
    },
    'brown': {
        ranges: [{ h: [10, 40], s: [20, 60], l: [10, 40] }],
        name: 'brązowy', hex: '#795548'
    }
};

// -------------------------------------------------------------------------
// 0. Gender Detector Logic
// -------------------------------------------------------------------------
class GenderDetector {
    constructor() {
        this.MALE_EXCEPTIONS_ENDING_A = new Set(['kuba', 'barnaba', 'bonawentura', 'jarema', 'kosma']);
        this.FEMALE_EXCEPTIONS_NO_A = new Set([
            'beatrycze', 'inez', 'noemi', 'nel', 'karmen', 'miriam', 
            'nicole', 'abigail', 'rut', 'iris', 'lili', 'vivi'
        ]);
    }

    normalize(name) {
        if (!name) return '';
        return name.trim().toLowerCase().replace(/[^a-zęóąśłżźćń]/g, '');
    }

    predictGender(rawName) {
        const name = this.normalize(rawName);
        if (!name) return 'MALE';

        if (this.MALE_EXCEPTIONS_ENDING_A.has(name)) return 'MALE';
        if (this.FEMALE_EXCEPTIONS_NO_A.has(name)) return 'FEMALE';
        if (name.endsWith('u')) return 'MALE'; // Wołacz: Adasiu
        if (name.endsWith('a')) return 'FEMALE';

        return 'MALE';
    }
}
const genderDetector = new GenderDetector();

// -------------------------------------------------------------------------
// 0. Audio Engine (Web Audio API)
// -------------------------------------------------------------------------
let audioCtx = null;
let oscillator = null;
let gainNode = null;

function initAudioEngine() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function updateSoundFeedback(confidence) {
    if (!audioCtx) return;

    if (confidence <= 0.05 || confidence >= 1.0) {
        if (oscillator) {
            const now = audioCtx.currentTime;
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
            oscillator.stop(now + 0.1);
            oscillator = null;
        }
        return;
    }

    if (!oscillator) {
        oscillator = audioCtx.createOscillator();
        gainNode = audioCtx.createGain();
        
        oscillator.type = 'sine';
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        const now = audioCtx.currentTime;
        oscillator.start(now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.3, now + 0.1);
    }

    // Rising Pitch: 200Hz -> 600Hz
    const baseFreq = 200;
    const maxFreq = 600;
    const targetFreq = baseFreq + (confidence * (maxFreq - baseFreq));
    oscillator.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.1);
}

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
const nameInput = document.getElementById('player-name-input');
const feedbackText = document.getElementById('feedback-text');
const feedbackImg = document.getElementById('feedback-snapshot');
const skipBtn = document.getElementById('skip-btn');

// Audio / TTS
let polishVoice = null;
const synth = window.speechSynthesis;

// -------------------------------------------------------------------------
// 1. Initialization & Permissions
// -------------------------------------------------------------------------

async function init() {
    // Check local storage for name
    const savedName = localStorage.getItem('lowcy_player_name');
    if (savedName) {
        nameInput.value = savedName;
    }

    startBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) {
            alert("Proszę wpisz swoje imię!");
            return;
        }
        state.playerName = name;
        state.playerGender = genderDetector.predictGender(name);
        console.log(`Detected gender for ${name}: ${state.playerGender}`);
        
        localStorage.setItem('lowcy_player_name', name);
        
        // Initialize Audio Engine & Resume Context (iOS)
        initAudioEngine();
        if (audioCtx && audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        // Warm up TTS immediately on click
        speak(`Cześć ${name}!`);

        uiStart.classList.add('hidden');
        uiPermission.classList.remove('hidden');
    });

    permBtn.addEventListener('click', async () => {
        // Ensure TTS is ready
        speak("Uruchamiam kamerę.");
        
        await startCamera();
        uiPermission.classList.add('hidden');
        startGame();
    });

    if (skipBtn) {
        skipBtn.addEventListener('click', skipTarget);
    }

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
    // Try to find exact PL match, or any PL match
    polishVoice = voices.find(v => v.lang === 'pl-PL') 
               || voices.find(v => v.lang.startsWith('pl'));
    
    if (polishVoice) {
        console.log("Selected Voice:", polishVoice.name);
    } else {
        console.log("No specific Polish voice found, relying on lang tag.");
    }
}

function speak(text) {
    // Cancel previous speech to prevent queue buildup
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pl-PL'; // Ensure browser knows it's Polish
    
    // If we found a specific nice voice, use it
    if (!polishVoice) {
        loadVoices(); 
    }
    if (polishVoice) {
        utterance.voice = polishVoice;
    }

    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    
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
    const target = COLORS[targetKey];
    if (!target) return false;

    // Special logic for achromatics (white, black, gray)
    if (targetKey === 'white' || targetKey === 'black' || targetKey === 'gray') {
        // Ignore hue for these, check only Saturation and Lightness
        const sMatch = (s >= target.s[0] && s <= target.s[1]);
        const lMatch = (l >= target.l[0] && l <= target.l[1]);
        return sMatch && lMatch;
    }

    // Basic validation for chromatic colors
    // Must have some saturation and not be too dark/light
    if (s < 20 || l < 15 || l > 85) return false;

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

function skipTarget() {
    // Reset confidence
    state.confidence = 0;
    const ring = document.querySelector('.ring-progress');
    const wrapper = document.getElementById('crosshair-wrapper');
    if (ring) {
        ring.style.strokeDashoffset = 377;
        ring.style.stroke = 'white';
    }
    if (wrapper) wrapper.classList.remove('detecting');

    // Pick new target excluding current
    const keys = Object.keys(COLORS);
    const availableKeys = keys.filter(k => k !== state.currentTarget);
    const nextKey = availableKeys[Math.floor(Math.random() * availableKeys.length)];
    state.currentTarget = nextKey;

    // Update UI
    targetIcon.style.backgroundColor = COLORS[nextKey].hex;
    instructionText.innerText = `Znajdź ${COLORS[nextKey].name}`;

    // Speak special message
    // "Kornelia, poszukamy innym razem. Znajdź teraz [kolor]."
    const text = `${state.playerName}, poszukamy innym razem. Znajdź teraz ${COLORS[nextKey].name}.`;
    speak(text);
}

function handleSuccess() {
    const now = Date.now();
    if (now - state.lastMatchTime < 4000) return; // Increased cooldown for snapshot viewing
    state.lastMatchTime = now;

    // Use Gender Detector for Correct Inflection
    // Znalazł (MALE) / Znalazła (FEMALE)
    const verb = (state.playerGender === 'FEMALE') ? 'znalazłaś' : 'znalazłeś';
    const praiseText = `Brawo ${state.playerName}, ${verb} kolor!`;

    // Capture Snapshot
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = video.videoWidth;
    snapCanvas.height = video.videoHeight;
    const snapCtx = snapCanvas.getContext('2d');
    
    // Draw video frame
    snapCtx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
    
    // Optional: Draw a "target circle" on the snapshot to show what was found
    const cx = snapCanvas.width / 2;
    const cy = snapCanvas.height / 2;
    snapCtx.beginPath();
    snapCtx.arc(cx, cy, 50, 0, 2 * Math.PI);
    snapCtx.lineWidth = 10;
    snapCtx.strokeStyle = 'white';
    snapCtx.stroke();
    
    feedbackImg.src = snapCanvas.toDataURL('image/jpeg');

    // Feedback
    speak(praiseText);
    
    // Visuals
    uiFeedback.classList.remove('hidden');
    feedbackText.innerText = `BRAWO ${state.playerName.toUpperCase()}!`;
    
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
    }, 3500); // Longer delay to admire the photo
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

        // --- Confidence Accumulation Logic ---
        // If > 30% pixels match, consider it a match frame
        const isMatch = (matchCount > totalPixels * 0.3);
        const ring = document.querySelector('.ring-progress');
        const wrapper = document.getElementById('crosshair-wrapper');
        
        if (isMatch) {
            // Charging
            state.confidence = Math.min(state.confidence + CHARGE_SPEED, CONFIDENCE_THRESHOLD);
            wrapper.classList.add('detecting');
            // Set ring color to target hex
            const targetColor = COLORS[state.currentTarget];
            if(targetColor) ring.style.stroke = targetColor.hex;

        } else {
            // Decaying
            state.confidence = Math.max(state.confidence - DECAY_SPEED, 0);
            if (state.confidence <= 0) {
                wrapper.classList.remove('detecting');
                ring.style.stroke = 'white'; // Reset
            }
        }

        // Update UI (Progress Ring)
        // Circumference ≈ 377
        const maxOffset = 377;
        const currentOffset = maxOffset - (state.confidence * maxOffset);
        ring.style.strokeDashoffset = currentOffset;

        // Audio Feedback (Sonification)
        updateSoundFeedback(state.confidence);

        // Success Condition
        if (state.confidence >= CONFIDENCE_THRESHOLD) {
            handleSuccess();
            state.confidence = 0; // Reset
            ring.style.strokeDashoffset = maxOffset; // Visually reset
            wrapper.classList.remove('detecting');
        }
    }

    requestAnimationFrame(gameLoop);
}

// Start
init();

// app.js

// --- CONFIG ---
const WS_URL = 'wss://my-screen-share-app.onrender.com';
const RTC_CONFIG = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// --- STATE ---
let socket = null;
let peerConnection = null;
let localStream = null;
let currentRoomId = null;
let role = null; // 'host' or 'viewer'

// --- UI ELEMENTS ---
const views = {
    home: document.getElementById('view-home'),
    host: document.getElementById('view-host'),
    viewer: document.getElementById('view-viewer')
};

const statusIndicator = document.getElementById('connection-status');
const hostStatusText = document.getElementById('host-status-text');
const hostRoomDisplay = document.getElementById('host-room-display');
const hostRoomCode = document.getElementById('host-room-code');
const hostStartBtn = document.getElementById('btn-start-hosting');
const hostStopBtn = document.getElementById('btn-stop-hosting');
const remoteVideo = document.getElementById('remote-video');

// --- NAVIGATION ---
function switchView(viewName) {
    Object.values(views).forEach(el => el.classList.remove('active'));
    views[viewName].classList.add('active');
}

// Updated to use CARD clicks instead of buttons
document.getElementById('card-host').addEventListener('click', () => switchView('host'));
document.getElementById('card-viewer').addEventListener('click', () => switchView('viewer'));

document.getElementById('back-from-host').addEventListener('click', () => switchView('home'));
document.getElementById('back-from-viewer').addEventListener('click', () => switchView('home'));


// --- WEBSOCKET CONNECTION ---
function connectSocket(onOpenCallback) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        if (onOpenCallback) onOpenCallback();
        return;
    }

    statusIndicator.innerText = "Connecting...";
    statusIndicator.className = "status-indicator warning";

    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        statusIndicator.innerText = "Connected";
        statusIndicator.className = "status-indicator success";
        if (onOpenCallback) onOpenCallback();
    };

    socket.onclose = () => {
        statusIndicator.innerText = "Disconnected";
        statusIndicator.className = "status-indicator error";
    };

    socket.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        handleSignalingMessage(data);
    };
}


// --- HOST LOGIC ---

document.getElementById('btn-start-hosting').addEventListener('click', async () => {
    const customRoomId = document.getElementById('host-room-id').value.trim();

    // 1. Get Screen Media
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                displaySurface: "monitor",
                resizeMode: "none", // Prevent downscaling
                width: { ideal: 3840, max: 3840 }, // 'min' not supported in getDisplayMedia
                height: { ideal: 2160, max: 2160 },
                frameRate: { ideal: 60, max: 60 }
            },
            audio: document.getElementById('audio-toggle').checked
        });

        localStream = stream;

        // Handle stream stop from browser UI
        stream.getVideoTracks()[0].onended = stopHostingSession;

        // 2. Connect and Create Room
        connectSocket(() => {
            role = 'host';
            socket.send(JSON.stringify({
                type: 'create-room',
                roomId: customRoomId
            }));
            hostStatusText.innerText = "Creating Room...";
        });

    } catch (err) {
        console.error("Error: " + err);
        if (err.name === 'NotAllowedError') {
            stopHostingSession("Screen selection cancelled.");
        } else if (err.name === 'TypeError' && err.message.includes('min')) {
            stopHostingSession("Error: Browser doesn't support 'min' constraints.");
        } else {
            stopHostingSession("Capture failed: " + err.message);
        }
    }
});


document.getElementById('btn-stop-hosting').addEventListener('click', stopHostingSession);

function stopHostingSession(statusMsg) {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (socket) {
        socket.close(); // Or send 'leave-room'
        socket = null;
    }
    socket = null; // Reset for valid reconnection

    // UI Reset
    hostStartBtn.style.display = 'inline-block';
    hostStopBtn.style.display = 'none';
    hostRoomDisplay.style.display = 'none';
    document.getElementById('host-output').style.display = 'none';
    hostRoomDisplay.style.display = 'none';
    document.getElementById('host-output').style.display = 'none';

    // Check if statusMsg is a string (custom message), otherwise default
    if (typeof statusMsg === 'string') {
        hostStatusText.innerText = statusMsg;
    } else {
        hostStatusText.innerText = "Session Stopped";
    }

    document.getElementById('host-description').innerText = "Click the button below to start sharing your screen.";
    document.getElementById('host-description').innerText = "Click the button below to start sharing your screen.";
    document.getElementById('host-room-id').disabled = false;
}


// --- VIEWER LOGIC ---

document.getElementById('btn-start-viewing').addEventListener('click', () => {
    const roomId = document.getElementById('viewer-room-id').value.trim();
    if (!roomId) return;

    connectSocket(() => {
        role = 'viewer';
        currentRoomId = roomId;
        socket.send(JSON.stringify({ type: 'join-room', roomId: roomId }));
        document.getElementById('viewer-setup').style.display = 'none';
        document.getElementById('video-area').style.display = 'flex';
    });
});

document.getElementById('btn-viewer-disconnect').addEventListener('click', () => {
    document.body.classList.remove('full-window-mode'); // Exit full window
    if (document.fullscreenElement) document.exitFullscreen(); // Exit native full screen if active

    if (peerConnection) peerConnection.close();
    if (socket) socket.close();
    location.reload(); // Simple reset
});

document.getElementById('btn-fullscreen').addEventListener('click', () => {
    remoteVideo.requestFullscreen();
});


// --- SIGNALING & WEBRTC ---

async function handleSignalingMessage(data) {
    console.log("Msg:", data.type);

    switch (data.type) {
        case 'room-created':
            currentRoomId = data.roomId;
            hostRoomCode.innerText = currentRoomId;
            document.getElementById('host-output').style.display = 'flex'; // Show the output container
            hostRoomDisplay.style.display = 'flex';
            hostStartBtn.style.display = 'none';
            hostStopBtn.style.display = 'inline-block';
            document.getElementById('host-room-id').disabled = true;
            hostStatusText.innerText = "Live & Hosting";
            document.getElementById('host-description').innerText = "Sharing your screen now";
            break;

        case 'error':
            alert(data.message);
            document.body.classList.remove('full-window-mode');
            if (role === 'host') stopHostingSession();
            if (role === 'viewer') location.reload();
            break;

        case 'viewer-joined':
            // Host creates offer for new viewer
            createPeerConnection(data.viewerId);
            break;

        case 'offer':
            handleOffer(data);
            break;

        case 'answer':
            handleAnswer(data);
            break;

        case 'candidate':
            handleCandidate(data);
            break;

        case 'viewer-settings':
            if (role === 'host' && localStream) {
                applyDynamicQuality(data.width, data.height);
            }
            break;
    }
}

async function applyDynamicQuality(width, height) {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    const capabilities = track.getCapabilities();

    console.log("Adjusting quality to target:", width, "x", height);

    // Check if device supports the resolution before applying
    // Note: 'ideal' is soft, but we can be more specific if we want.
    // We stick to the max potential of the screen but try to match aspect ratio/size of viewer.

    try {
        await track.applyConstraints({
            width: { ideal: width, max: 3840 },
            height: { ideal: height, max: 2160 },
            frameRate: { ideal: 60 }
        });
        console.log("Quality constraints applied successfully.");
    } catch (err) {
        console.warn("Failed to apply dynamic constraints:", err);
    }
}

// HOST: Create PC and Offer
const peerConnections = {}; // viewerId -> PC (For Host)

async function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnections[targetId] = pc;

    // Add Tracks
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // ICE
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: 'candidate',
                candidate: event.candidate,
                target: targetId
            }));
        }
    };

    // Create Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.send(JSON.stringify({
        type: 'offer',
        sdp: offer.sdp,
        target: targetId
    }));
}

// VIEWER: Handle Offer
async function handleOffer(data) {
    peerConnection = new RTCPeerConnection(RTC_CONFIG);

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        // AUTO FULL SCREEN (CSS Mode)
        document.body.classList.add('full-window-mode');
        // Try native fullscreen (might block, but worth a shot)
        remoteVideo.requestFullscreen().catch(err => console.log("Auto-fullscreen blocked:", err));
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: 'candidate',
                candidate: event.candidate,
                target: data.sender
            }));
        }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.send(JSON.stringify({
        type: 'answer',
        sdp: answer.sdp,
        target: data.sender
    }));

    // Send Viewer Screen Settings for Quality Optimization
    const screenWidth = window.screen.width * (window.devicePixelRatio || 1);
    const screenHeight = window.screen.height * (window.devicePixelRatio || 1);

    socket.send(JSON.stringify({
        type: 'viewer-settings',
        width: Math.round(screenWidth),
        height: Math.round(screenHeight),
        target: data.sender
    }));
}

async function handleAnswer(data) {
    const pc = peerConnections[data.sender];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
    }
}

async function handleCandidate(data) {
    if (role === 'host') {
        const pc = peerConnections[data.sender];
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } else {
        if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
}

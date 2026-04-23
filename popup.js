// popup.js

// --- NAVIGATION ---
const views = {
    home: document.getElementById('view-home'),
    host: document.getElementById('view-host'),
    viewer: document.getElementById('view-viewer')
};

function switchView(viewName) {
    Object.values(views).forEach(el => el.classList.remove('active'));
    views[viewName].classList.add('active');
}

// Restore State on Load
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
    if (state && state.isSharing) {
        switchView('host');
        updateHostUI(true, state.roomId);
    }
});

document.getElementById('btn-go-host').addEventListener('click', () => switchView('host'));
document.getElementById('btn-go-viewer').addEventListener('click', () => switchView('viewer'));
document.getElementById('back-from-host').addEventListener('click', () => switchView('home'));
document.getElementById('back-from-viewer').addEventListener('click', () => switchView('home'));


// --- HOST LOGIC ---

const startHostingBtn = document.getElementById('start-hosting-btn');
const stopHostingBtn = document.getElementById('stop-hosting-btn');
const hostStatus = document.getElementById('host-status');
const hostRoomInput = document.getElementById('host-room-id');

startHostingBtn.addEventListener('click', () => {
    const roomId = hostRoomInput.value.trim();
    if (!roomId) {
        hostStatus.innerText = "Please enter a Room ID!";
        hostStatus.style.color = "#cf6679";
        return;
    }

    hostStatus.innerText = "Requesting screen access...";
    hostStatus.style.color = "#ccc";

    // 1. Request Screen Access
    chrome.desktopCapture.chooseDesktopMedia(
        ['screen', 'window', 'tab', 'audio'],
        null,
        (streamId, options) => {
            if (chrome.runtime.lastError) {
                hostStatus.innerText = "Error: " + chrome.runtime.lastError.message;
                return;
            }
            if (!streamId || !options.canRequestAudioTrack) {
                if (!streamId) {
                    hostStatus.innerText = "Selection cancelled.";
                    return;
                }
            }

            hostStatus.innerText = "Starting signaling...";

            // 2. Notify Background to start Offscreen Intermediary
            chrome.runtime.sendMessage({
                type: 'START_SHARE',
                streamId: streamId,
                roomId: roomId,
                wsUrl: 'ws://localhost:3000'
            }, (response) => {
                if (chrome.runtime.lastError) {
                    hostStatus.innerText = "BG Error: " + chrome.runtime.lastError.message;
                } else if (response && response.success) {
                    // Wait for actual room creation confirmation via listener
                    hostStatus.innerText = "Connecting to server...";
                } else {
                    hostStatus.innerText = "Failed to start offscreen doc.";
                }
            });
        }
    );
});

stopHostingBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_SHARE' });
    updateHostUI(false);
});

function updateHostUI(isSharing, roomId) {
    if (isSharing) {
        startHostingBtn.style.display = 'none';
        stopHostingBtn.style.display = 'block';
        hostRoomInput.disabled = true;
        hostStatus.innerText = `Hosting Room: ${roomId}`;
        hostStatus.style.color = "#03DAC6";
    } else {
        startHostingBtn.style.display = 'block';
        stopHostingBtn.style.display = 'none';
        hostRoomInput.disabled = false;
        hostStatus.innerText = "Ready to create room";
        hostStatus.style.color = "#aaa";
    }
}

// --- VIEWER LOGIC ---

const startViewingBtn = document.getElementById('start-viewing-btn');
const viewerRoomInput = document.getElementById('viewer-room-id');
const viewerStatus = document.getElementById('viewer-status');

startViewingBtn.addEventListener('click', () => {
    const roomId = viewerRoomInput.value.trim();
    if (!roomId) {
        viewerStatus.innerText = "Please enter a Room ID!";
        return;
    }

    const viewerUrl = `http://localhost:3000/?room=${roomId}`;
    chrome.tabs.create({ url: viewerUrl });
});


// --- GLOBAL LISTENERS ---

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'ROOM_CREATED') {
        updateHostUI(true, msg.roomId);
    }
    if (msg.type === 'ERROR') {
        hostStatus.innerText = "Error: " + msg.message;
        hostStatus.style.color = "#cf6679";
        updateHostUI(false);
    }
    if (msg.type === 'STOPPED') {
        updateHostUI(false);
        hostStatus.innerText = "Session stopped.";
    }
});

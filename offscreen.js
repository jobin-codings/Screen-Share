// offscreen.js

let socket;
let peerConnection;
let localStream;
let roomId;
const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'INIT_WEBRTC') {
        initWebRTC(msg.streamId, msg.wsUrl, msg.roomId);
    }
});

async function initWebRTC(streamId, wsUrl, customRoomId) {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: streamId
                }
            },
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: streamId,
                    maxWidth: 1920,
                    maxHeight: 1080
                }
            }
        });

        localStream = stream;

        // Handle stream ending (user clicks "Stop sharing" chrome bar)
        stream.getVideoTracks()[0].onended = () => {
            closeSession();
            chrome.runtime.sendMessage({ type: 'STOPPED' });
        };

        connectWebSocket(wsUrl, customRoomId);
    } catch (e) {
        console.error('getUserMedia failed:', e);
    }
}

function connectWebSocket(url, customRoomId) {
    if (socket) socket.close();
    socket = new WebSocket(url);

    socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'create-room', roomId: customRoomId }));
    };

    socket.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        switch (data.type) {
            case 'room-created':
                roomId = data.roomId;
                chrome.runtime.sendMessage({ type: 'ROOM_CREATED', roomId: roomId });
                break;

            case 'viewer-joined':
                // New viewer, create a PEER CONNECTION for them
                // Note: For multiple viewers, we need a map of peerConnections = { viewerId: pc }
                // For MVP, we'll support one active connection or manage multiple if needed.
                // Let's implement multiple viewer support.
                createPeerConnection(data.viewerId);
                break;

            case 'answer': // Answer from a specific viewer
                handleAnswer(data);
                break;

            case 'candidate':
                handleCandidate(data);
                break;

            case 'viewer-left':
                closePeerConnection(data.viewerId);
                break;
        }
    };
}

const peerConnections = {}; // viewerId -> RTCPeerConnection

async function createPeerConnection(viewerId) {
    console.log('Creating PC for viewer:', viewerId);
    const pc = new RTCPeerConnection(config);
    peerConnections[viewerId] = pc;

    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: 'candidate',
                candidate: event.candidate,
                target: viewerId
            }));
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.send(JSON.stringify({
        type: 'offer',
        sdp: offer.sdp,
        target: viewerId
    }));
}

async function handleAnswer(data) {
    const pc = peerConnections[data.sender];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
    }
}

async function handleCandidate(data) {
    const pc = peerConnections[data.sender];
    if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
}

function closePeerConnection(viewerId) {
    const pc = peerConnections[viewerId];
    if (pc) {
        pc.close();
        delete peerConnections[viewerId];
    }
}

function closeSession() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    Object.keys(peerConnections).forEach(closePeerConnection);
    if (socket) socket.close();
}

const App = (() => {

  let socket     = null;
  let roomId     = null;
  let myName     = null;
  let mySocketId = null;
  let micOn      = true;
  let camOn      = true;
  let screenOn   = false;

  function init() {
    UI.init();
    connectSocket();
    handleURLRoom();

    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      if (document.getElementById('landing').style.display === 'none') return;
      const joinId = document.getElementById('join-room-id').value.trim();
      if (joinId) joinRoom();
      else createRoom();
    });
  }

  function handleURLRoom() {
    const params = new URLSearchParams(window.location.search);
    const room   = params.get('room');
    if (room) {
      document.getElementById('join-room-id').value = room.toUpperCase();
      UI.toast('Room ID filled from link — enter your name to join');
    }
  }

  function connectSocket() {
    socket = io({ transports: ['websocket', 'polling'] });
    WebRTC.init(socket);

    socket.on('connect', () => {
      UI.setServerStatus('connected');
    });

    socket.on('disconnect', () => {
      UI.setServerStatus('error');
      UI.setConnectionStatus('', 'Disconnected — reconnecting...');
    });

    socket.on('connect_error', () => {
      UI.setServerStatus('error');
    });

    socket.on('room-joined', async ({ roomId: rid, peers, mySocketId: sid }) => {
      mySocketId = sid;
      UI.setConnectionStatus('connected', `In room · ${peers.length} other${peers.length !== 1 ? 's' : ''}`);
      UI.setMyInfo(sid, myName);
      for (const peer of peers) {
        UI.addParticipant(peer.socketId, peer.name);
        await WebRTC.callPeer(peer.socketId, peer.name);
      }
      updateParticipantCount();
    });

    socket.on('peer-joined', async ({ socketId, name }) => {
      UI.addParticipant(socketId, name);
      UI.addMessage('SYSTEM', `${name} joined the call`, false, true);
      updateParticipantCount();
    });

    socket.on('offer', async ({ from, fromName, offer }) => {
      await WebRTC.handleOffer(from, fromName, offer);
    });

    socket.on('answer', async ({ from, answer }) => {
      await WebRTC.handleAnswer(from, answer);
    });

    socket.on('ice-candidate', async ({ from, candidate }) => {
      await WebRTC.handleIceCandidate(from, candidate);
    });

    socket.on('peer-left', ({ socketId, name }) => {
      WebRTC.removePeer(socketId);
      UI.removeRemoteTile(socketId);
      UI.removeParticipant(socketId);
      UI.addMessage('SYSTEM', `${name || 'Someone'} left the call`, false, true);
      updateParticipantCount();
      updateConnectionStatus();
    });

    socket.on('chat-message', ({ name, text }) => {
      UI.addMessage(name, text, false);
    });

    socket.on('peer-media-state', ({ socketId, audio, video }) => {
      UI.setPeerMediaState(socketId, audio, video);
    });

    WebRTC.onTrack((socketId, name, stream) => {
      UI.addRemoteTile(socketId, name, stream);
      updateParticipantCount();
      updateConnectionStatus();
    });

    WebRTC.onPeerLeave((socketId) => {
      UI.removeRemoteTile(socketId);
      UI.removeParticipant(socketId);
      updateParticipantCount();
    });
  }

  async function createRoom() {
    const name = getDisplayName();
    if (!name) return;
    await startCall(genRoomId(), name);
  }

  async function joinRoom() {
    const name = getDisplayName();
    if (!name) return;
    const id = document.getElementById('join-room-id').value.trim().toUpperCase();
    if (!id) { UI.toast('Enter a Room ID'); return; }
    await startCall(id, name);
  }

  async function startCall(rid, name) {
    myName = name;
    roomId = rid;

    const stream = await getMedia();
    WebRTC.setLocalStream(stream);
    UI.setLocalStream(stream);

    UI.showCallScreen(roomId, myName);
    UI.setConnectionStatus('', 'Joining room...');
    socket.emit('join-room', { roomId, name });

    const url = new URL(window.location);
    url.searchParams.set('room', roomId);
    window.history.replaceState({}, '', url);
  }

  async function getMedia() {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
      try {
        UI.toast('Camera unavailable — audio only');
        return await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      } catch (e2) {
        UI.toast('No media access — joining without A/V');
        return new MediaStream();
      }
    }
  }

  const Media = {
    toggleMic() {
      const stream = WebRTC.getLocalStream();
      if (!stream) return;
      micOn = !micOn;
      stream.getAudioTracks().forEach(t => t.enabled = micOn);
      UI.setMicState(micOn);
      socket.emit('media-state', { audio: micOn, video: camOn });
      UI.toast(micOn ? 'Mic on' : 'Mic muted');
    },

    toggleCam() {
      const stream = WebRTC.getLocalStream();
      if (!stream) return;
      camOn = !camOn;
      stream.getVideoTracks().forEach(t => t.enabled = camOn);
      UI.setCamState(camOn);
      socket.emit('media-state', { audio: micOn, video: camOn });
      UI.toast(camOn ? 'Camera on' : 'Camera off');
    },

    async toggleScreen() {
      if (!screenOn) {
        const stream = await WebRTC.startScreenShare();
        if (stream) {
          screenOn = true;
          UI.setScreenState(true);
          UI.toast('Screen sharing started');
          document.getElementById('local-video').srcObject = stream;
        }
      } else {
        await WebRTC.stopScreenShare();
        screenOn = false;
        UI.setScreenState(false);
        UI.toast('Screen sharing stopped');
        const stream = WebRTC.getLocalStream();
        if (stream) document.getElementById('local-video').srcObject = stream;
      }
    }
  };

  function sendChat() {
    const text = UI.getChatInputValue();
    if (!text) return;
    UI.clearChatInput();
    UI.addMessage(myName, text, true);
    socket.emit('chat-message', { roomId, text });
  }

  function leaveCall() {
    socket.emit('leave-room');
    const stream = WebRTC.getLocalStream();
    if (stream) stream.getTracks().forEach(t => t.stop());
    WebRTC.stopScreenShare();

    UI.hideCallScreen();
    UI.setConnectionStatus('', 'Waiting...');
    window.history.replaceState({}, '', '/call');

    micOn = true; camOn = true; screenOn = false;
    UI.setMicState(true); UI.setCamState(true); UI.setScreenState(false);
    roomId = null; myName = null; mySocketId = null;
  }

  function getDisplayName() {
    const name = document.getElementById('display-name').value.trim();
    if (!name) { UI.toast('Enter your name first'); return null; }
    return name.substring(0, 30);
  }

  function genRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function updateParticipantCount() {
    UI.updateParticipantCount(1 + WebRTC.getPeerCount());
  }

  function updateConnectionStatus() {
    const peers = WebRTC.getPeers();
    const total = Object.keys(peers).length;
    if (total === 0) {
      UI.setConnectionStatus('', 'Waiting for participants...');
    } else {
      const connected = Object.values(peers).filter(p => p.pc.connectionState === 'connected').length;
      UI.setConnectionStatus('connected', `${connected}/${total} connected`);
    }
  }

  return { init, createRoom, joinRoom, leaveCall, sendChat, Media };
})();

const Media = App.Media;
document.addEventListener('DOMContentLoaded', () => App.init());

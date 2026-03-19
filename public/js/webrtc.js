/**
 * WebRTC.js — Peer connection manager for NEXUS
 * Handles all WebRTC logic: offer/answer, ICE candidates, track management
 */
const WebRTC = (() => {

  // ── Config ───────────────────────────────────────────────────────────────
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      // Free TURN from Metered.ca — replace with your own for production
      // { urls: 'turn:your-turn-server.com:3478', username: 'user', credential: 'pass' }
    ],
    iceCandidatePoolSize: 10
  };

  // ── State ────────────────────────────────────────────────────────────────
  const peers = {};         // socketId -> { pc, name, audioMuted, videoMuted }
  let localStream = null;
  let screenStream = null;
  let socket = null;
  let onTrackCallback = null;
  let onPeerLeaveCallback = null;
  let onPeerMediaStateCallback = null;

  // ── Init socket reference ────────────────────────────────────────────────
  function init(socketInstance) {
    socket = socketInstance;
  }

  // ── Set callbacks ────────────────────────────────────────────────────────
  function onTrack(cb) { onTrackCallback = cb; }
  function onPeerLeave(cb) { onPeerLeaveCallback = cb; }
  function onPeerMediaState(cb) { onPeerMediaStateCallback = cb; }

  // ── Get/set local stream ─────────────────────────────────────────────────
  function setLocalStream(stream) { localStream = stream; }
  function getLocalStream() { return localStream; }

  // ── Create a PeerConnection for a remote peer ────────────────────────────
  function createPeerConnection(socketId, peerName) {
    if (peers[socketId]) return peers[socketId].pc;

    const pc = new RTCPeerConnection(ICE_CONFIG);
    peers[socketId] = { pc, name: peerName, audioMuted: false, videoMuted: false };

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // ICE candidate → send via socket
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socket.emit('ice-candidate', { to: socketId, candidate });
      }
    };

    // Connection state
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] ${socketId} connection: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        pc.restartIce();
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        removePeer(socketId);
        if (onPeerLeaveCallback) onPeerLeaveCallback(socketId);
      }
    };

    // Remote track received
    pc.ontrack = ({ streams }) => {
      if (streams && streams[0]) {
        if (onTrackCallback) onTrackCallback(socketId, peerName, streams[0]);
      }
    };

    return pc;
  }

  // ── Initiate call to a peer (we send offer) ──────────────────────────────
  async function callPeer(socketId, peerName) {
    const pc = createPeerConnection(socketId, peerName);

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pc.setLocalDescription(offer);
      socket.emit('offer', { to: socketId, offer: pc.localDescription });
    } catch (err) {
      console.error('[WebRTC] createOffer error:', err);
    }
  }

  // ── Handle incoming offer ────────────────────────────────────────────────
  async function handleOffer(socketId, peerName, offer) {
    const pc = createPeerConnection(socketId, peerName);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { to: socketId, answer: pc.localDescription });
      await flushPendingCandidates(socketId);
    } catch (err) {
      console.error('[WebRTC] handleOffer error:', err);
    }
  }

  // ── Handle incoming answer ───────────────────────────────────────────────
  async function handleAnswer(socketId, answer) {
    const peer = peers[socketId];
    if (!peer) return;

    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      await flushPendingCandidates(socketId);
    } catch (err) {
      console.error('[WebRTC] handleAnswer error:', err);
    }
  }

  // ── ICE candidate buffer (before remote desc is set) ────────────────────
  const pendingCandidates = {};

  async function handleIceCandidate(socketId, candidate) {
    const peer = peers[socketId];
    if (!peer || !peer.pc.remoteDescription) {
      if (!pendingCandidates[socketId]) pendingCandidates[socketId] = [];
      pendingCandidates[socketId].push(candidate);
      return;
    }
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      // Ignore benign errors
    }
  }

  async function flushPendingCandidates(socketId) {
    const peer = peers[socketId];
    if (!peer || !pendingCandidates[socketId]) return;
    for (const c of pendingCandidates[socketId]) {
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
    }
    delete pendingCandidates[socketId];
  }

  // ── Remove / clean up peer ───────────────────────────────────────────────
  function removePeer(socketId) {
    if (!peers[socketId]) return;
    peers[socketId].pc.close();
    delete peers[socketId];
    delete pendingCandidates[socketId];
  }

  // ── Replace track in all peer connections (for screen share) ────────────
  async function replaceVideoTrack(newTrack) {
    for (const { pc } of Object.values(peers)) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        try { await sender.replaceTrack(newTrack); } catch (_) {}
      }
    }
  }

  // ── Screen share ─────────────────────────────────────────────────────────
  async function startScreenShare() {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      await replaceVideoTrack(screenTrack);

      screenTrack.onended = () => stopScreenShare();
      return screenStream;
    } catch (err) {
      console.error('[WebRTC] Screen share error:', err);
      return null;
    }
  }

  async function stopScreenShare() {
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }
    // Restore camera track
    const camTrack = localStream && localStream.getVideoTracks()[0];
    if (camTrack) await replaceVideoTrack(camTrack);
    return camTrack;
  }

  // ── Getters ───────────────────────────────────────────────────────────────
  function getPeers() { return peers; }
  function getPeerCount() { return Object.keys(peers).length; }
  function isScreenSharing() { return !!screenStream; }

  return {
    init, setLocalStream, getLocalStream,
    onTrack, onPeerLeave, onPeerMediaState,
    callPeer, handleOffer, handleAnswer, handleIceCandidate,
    removePeer, getPeers, getPeerCount,
    startScreenShare, stopScreenShare, isScreenSharing
  };
})();

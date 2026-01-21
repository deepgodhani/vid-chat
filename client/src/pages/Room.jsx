import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import { useParams, useNavigate } from "react-router-dom";
import { Mic, MicOff, Video as VideoIcon, VideoOff } from "lucide-react";

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL;

const TURN_URL = import.meta.env.VITE_TURN_URL; // e.g. "turn:yourhost:3478?transport=udp"
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME;
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL;

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.stunprotocol.org:3478" },
  ...(TURN_URL && TURN_USERNAME && TURN_CREDENTIAL
    ? [
        {
          urls: TURN_URL,
          username: TURN_USERNAME,
          credential: TURN_CREDENTIAL,
        },
      ]
    : []),
];

function getFriendlyMediaError(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permission denied. Allow Camera/Microphone in browser settings and try again.";
  }
  if (name === "NotReadableError") {
    return "Camera failed to start (maybe in use by another app/tab). Close other apps and retry.";
  }
  if (name === "NotFoundError") {
    return "No camera/microphone found on this device.";
  }
  return err?.message || "Failed to access camera/microphone.";
}

async function getMediaMobileSafe() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: "user" },
    });
  } catch {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
  }
}

function VideoTile({ stream, label, muted = false }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream || null;

    return () => {
      if (ref.current) ref.current.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="bg-black rounded-lg overflow-hidden border border-gray-700 relative w-full h-full min-h-[200px]">
      <video muted={muted} playsInline autoPlay ref={ref} className="w-full h-full object-cover" />
      {label ? (
        <div className="absolute bottom-2 left-2 text-white bg-black/50 px-2 py-1 text-sm rounded">{label}</div>
      ) : null}
    </div>
  );
}

const Room = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [joined, setJoined] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [userStream, setUserStream] = useState(null);

  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);

  // peerID -> MediaStream
  const [remoteStreams, setRemoteStreams] = useState({});

  // stats
  const [statsEnabled, setStatsEnabled] = useState(false);
  const [peerStats, setPeerStats] = useState({});
  const lastBytesRef = useRef(new Map()); // peerID -> { inBytes, outBytes, ts }

  // screen share
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const screenStreamRef = useRef(null); // MediaStream from getDisplayMedia

  // device selection
  const [devices, setDevices] = useState({ cams: [], mics: [] });
  const [selectedCamId, setSelectedCamId] = useState("");
  const [selectedMicId, setSelectedMicId] = useState("");
  const [isApplyingDevices, setIsApplyingDevices] = useState(false);

  // chat (server-based, SFU-friendly)
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([]); // { id?, ts, from, text }

  // store camera stream + tracks for switching/restoring
  const cameraStreamRef = useRef(null); // MediaStream from getUserMedia
  const cameraTrackRef = useRef(null); // current camera video track

  const socketRef = useRef(null);

  // peer registry: peerID -> { peer, initiator }
  const peersRef = useRef(new Map());
  // queue: peerID -> signal[]
  const pendingSignalsRef = useRef(new Map());

  function addRemoteStream(peerID, stream) {
    setRemoteStreams((prev) => {
      if (prev[peerID] === stream) return prev;
      return { ...prev, [peerID]: stream };
    });
  }

  function queueSignal(peerID, signal) {
    const list = pendingSignalsRef.current.get(peerID) || [];
    list.push(signal);
    pendingSignalsRef.current.set(peerID, list);
  }

  function flushPending(peerID) {
    const item = peersRef.current.get(peerID);
    const pending = pendingSignalsRef.current.get(peerID);
    if (!item || !pending || pending.length === 0) return;

    pending.forEach((sig) => {
      try {
        item.peer.signal(sig);
      } catch (e) {
        console.error("[signal] flush failed", sig?.type, "for", peerID, e);
      }
    });
    pendingSignalsRef.current.delete(peerID);
  }

  async function copyInviteLink() {
    const url = `${window.location.origin}/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      console.log("[ui] invite link copied:", url);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  function safeDownloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function replaceTrackForAllPeers(kind, newTrack) {
    for (const [, item] of peersRef.current.entries()) {
      const pc = item?.peer?._pc;
      if (!pc) continue;
      const sender = pc.getSenders?.().find((s) => s.track && s.track.kind === kind);
      if (sender && typeof sender.replaceTrack === "function") {
        sender.replaceTrack(newTrack);
      }
    }
  }

  async function readPeerStats(peerID) {
    const item = peersRef.current.get(peerID);
    const peer = item?.peer;
    const pc = peer?._pc;

    if (!pc || typeof pc.getStats !== "function") return null;

    const report = await pc.getStats();

    let inboundBytes = null;
    let outboundBytes = null;
    let packetsLostIn = null;
    let jitterSeconds = null;
    let rttSeconds = null;

    report.forEach((stat) => {
      if (stat.type === "inbound-rtp" && !stat.isRemote) {
        if (typeof stat.bytesReceived === "number") inboundBytes = (inboundBytes || 0) + stat.bytesReceived;
        if (typeof stat.packetsLost === "number") packetsLostIn = (packetsLostIn || 0) + stat.packetsLost;
        if (typeof stat.jitter === "number") jitterSeconds = Math.max(jitterSeconds || 0, stat.jitter);
      }

      if (stat.type === "outbound-rtp" && !stat.isRemote) {
        if (typeof stat.bytesSent === "number") outboundBytes = (outboundBytes || 0) + stat.bytesSent;
      }

      if (stat.type === "candidate-pair" && stat.state === "succeeded" && (stat.nominated || stat.selected)) {
        if (typeof stat.currentRoundTripTime === "number") rttSeconds = stat.currentRoundTripTime;
      }
    });

    const now = performance.now();
    const last = lastBytesRef.current.get(peerID);

    let inKbps = null;
    let outKbps = null;

    if (last && typeof inboundBytes === "number" && typeof outboundBytes === "number") {
      const dtSeconds = (now - last.ts) / 1000;
      if (dtSeconds > 0) {
        inKbps = ((inboundBytes - last.inBytes) * 8) / 1000 / dtSeconds;
        outKbps = ((outboundBytes - last.outBytes) * 8) / 1000 / dtSeconds;
      }
    }

    if (typeof inboundBytes === "number" && typeof outboundBytes === "number") {
      lastBytesRef.current.set(peerID, { inBytes: inboundBytes, outBytes: outboundBytes, ts: now });
    }

    return {
      ts: Date.now(),
      inKbps: inKbps == null ? null : Math.max(0, Math.round(inKbps)),
      outKbps: outKbps == null ? null : Math.max(0, Math.round(outKbps)),
      rttMs: rttSeconds == null ? null : Math.round(rttSeconds * 1000),
      packetsLostIn: packetsLostIn == null ? null : packetsLostIn,
      jitterMs: jitterSeconds == null ? null : Math.round(jitterSeconds * 1000),
    };
  }

  useEffect(() => {
    if (!statsEnabled || !joined) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      const ids = Array.from(peersRef.current.keys());
      if (ids.length === 0) return;

      const updates = {};
      for (const id of ids) {
        try {
          const s = await readPeerStats(id);
          if (s) updates[id] = s;
        } catch {
          // ignore
        }
      }

      if (!cancelled && Object.keys(updates).length) {
        setPeerStats((prev) => ({ ...prev, ...updates }));
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [statsEnabled, joined]);

  function registerPeer(peerID, peer, initiator) {
    if (peersRef.current.has(peerID)) return peersRef.current.get(peerID);

    peer.on("stream", (stream) => addRemoteStream(peerID, stream));
    peer.on("error", (e) => console.error("[peer] error", initiator ? "initiator" : "receiver", peerID, e));
    peer.on("close", () => removePeer(peerID));

    const item = { peer, initiator };
    peersRef.current.set(peerID, item);

    flushPending(peerID);

    // force UI update (participant count)
    setRemoteStreams((prev) => ({ ...prev }));
    return item;
  }

  function removePeer(peerID) {
    const item = peersRef.current.get(peerID);
    if (item) {
      try {
        item.peer.destroy();
      } catch {
        // ignore
      }
    }

    peersRef.current.delete(peerID);
    pendingSignalsRef.current.delete(peerID);
    lastBytesRef.current.delete(peerID);

    setPeerStats((prev) => {
      if (!(peerID in prev)) return prev;
      const next = { ...prev };
      delete next[peerID];
      return next;
    });

    setRemoteStreams((prev) => {
      if (!(peerID in prev)) return prev;
      const next = { ...prev };
      delete next[peerID];
      return next;
    });
  }

  function createInitiatorPeer(remoteID, myID, stream) {
    const peer = new Peer({
      initiator: true,
      trickle: true,
      stream,
      config: { iceServers: ICE_SERVERS },
    });

    peer.on("signal", (signal) => socketRef.current?.emit("signal", { to: remoteID, from: myID, signal }));

    registerPeer(remoteID, peer, true);
    return peer;
  }

  function createResponderPeer(remoteID, myID, stream, offerSignal) {
    const peer = new Peer({
      initiator: false,
      trickle: true,
      stream,
      config: { iceServers: ICE_SERVERS },
    });

    peer.on("signal", (signal) => socketRef.current?.emit("signal", { to: remoteID, from: myID, signal }));

    registerPeer(remoteID, peer, false);

    peer.signal(offerSignal);
    flushPending(remoteID);

    return peer;
  }

  async function refreshDeviceList() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const cams = list.filter((d) => d.kind === "videoinput");
      const mics = list.filter((d) => d.kind === "audioinput");

      setDevices({ cams, mics });

      if (!selectedCamId && cams[0]?.deviceId) setSelectedCamId(cams[0].deviceId);
      if (!selectedMicId && mics[0]?.deviceId) setSelectedMicId(mics[0].deviceId);
    } catch (e) {
      console.error("enumerateDevices failed:", e);
    }
  }

  async function applySelectedDevices() {
    if (!joined) return;
    setIsApplyingDevices(true);
    setMediaError("");

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true,
        video: selectedCamId ? { deviceId: { exact: selectedCamId } } : true,
      });

      const nextAudio = nextStream.getAudioTracks()?.[0] || null;
      const nextVideo = nextStream.getVideoTracks()?.[0] || null;

      if (nextAudio) replaceTrackForAllPeers("audio", nextAudio);

      if (nextVideo) {
        replaceTrackForAllPeers("video", nextVideo);
        cameraTrackRef.current = nextVideo;
      }

      // stop previous camera stream tracks (do not stop screen share stream)
      try {
        const prevCam = cameraStreamRef.current;
        prevCam?.getTracks()?.forEach((t) => t.stop());
      } catch {
        // ignore
      }

      cameraStreamRef.current = nextStream;

      // local preview should be screen while sharing, otherwise camera
      if (!isScreenSharing) setUserStream(nextStream);

      // keep mute states consistent with track.enabled
      if (nextAudio) nextAudio.enabled = !isAudioMuted;
      if (nextVideo) nextVideo.enabled = !isVideoMuted;
    } catch (e) {
      console.error("applySelectedDevices failed:", e);
      setMediaError(getFriendlyMediaError(e));
    } finally {
      setIsApplyingDevices(false);
    }
  }

  async function startScreenShare() {
    if (!joined) return;

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;

      screenStreamRef.current = displayStream;
      setIsScreenSharing(true);

      // local preview becomes screen
      setUserStream(displayStream);

      // replace outgoing video track for every peer
      replaceTrackForAllPeers("video", screenTrack);

      // browser "Stop sharing" button
      screenTrack.onended = () => stopScreenShare();
    } catch (e) {
      console.error("startScreenShare failed:", e);
    }
  }

  function stopScreenShare() {
    try {
      screenStreamRef.current?.getTracks()?.forEach((t) => t.stop());
    } catch {
      // ignore
    }
    screenStreamRef.current = null;
    setIsScreenSharing(false);

    const camTrack = cameraTrackRef.current || cameraStreamRef.current?.getVideoTracks?.()?.[0] || null;
    if (camTrack) replaceTrackForAllPeers("video", camTrack);

    if (cameraStreamRef.current) setUserStream(cameraStreamRef.current);
  }

  function sendChat() {
    const text = chatInput.trim();
    if (!text) return;

    // server-based chat (better long-term, SFU-friendly)
    socketRef.current?.emit("chat:send", { roomId, text });
    setChatInput("");
  }

  const joinMeeting = async () => {
    try {
      if (joined) return;
      setMediaError("");

      socketRef.current = io(SIGNALING_URL, { transports: ["websocket"] });
      socketRef.current.removeAllListeners();
      socketRef.current.on("connect", () => console.log("[socket] connected:", socketRef.current.id));
      socketRef.current.on("connect_error", (e) => console.error("[socket] connect_error:", e?.message || e));

      // chat receive
      socketRef.current.off("chat:message");
      socketRef.current.on("chat:message", (msg) => {
        if (!msg || typeof msg.text !== "string") return;
        if (msg.roomId && msg.roomId !== roomId) return; // extra safety
        setMessages((prev) => [...prev, msg]);
      });

      socketRef.current.off("chat:history");
      socketRef.current.on("chat:history", (history) => {
        if (!Array.isArray(history)) return;
        setMessages(history);
      });
      const stream = await getMediaMobileSafe();
      setUserStream(stream);

      cameraStreamRef.current = stream;
      cameraTrackRef.current = stream.getVideoTracks()?.[0] || null;

      setIsAudioMuted(false);
      setIsVideoMuted(stream.getVideoTracks().length === 0);

      socketRef.current.on("all users", (users) => {
        users.forEach((id) => {
          if (id === socketRef.current.id) return;
          if (peersRef.current.has(id)) return;
          createInitiatorPeer(id, socketRef.current.id, stream);
        });
      });

      socketRef.current.on("peer joined", () => {
        // do nothing to avoid glare; wait for offer
      });

      socketRef.current.on("signal", ({ from, signal }) => {
        const existing = peersRef.current.get(from);
        if (existing) {
          try {
            existing.peer.signal(signal);
          } catch (e) {
            console.error("[signal] apply failed", from, signal?.type, e);
          }
          return;
        }

        if (signal?.type !== "offer") {
          queueSignal(from, signal);
          return;
        }

        createResponderPeer(from, socketRef.current.id, stream, signal);
      });

      socketRef.current.on("user left", (id) => removePeer(id));

      socketRef.current.emit("join room", roomId);
      setJoined(true);
    } catch (err) {
      console.error("Room start failed:", err);
      setMediaError(getFriendlyMediaError(err));
    }
  };

  function leaveMeeting() {
    setStatsEnabled(false);
    setJoined(false);
    setRemoteStreams({});
    setPeerStats({});
    setMessages([]);
    setChatInput("");

    // stop screen stream if active
    try {
      screenStreamRef.current?.getTracks()?.forEach((t) => t.stop());
    } catch {
      // ignore
    }
    screenStreamRef.current = null;
    setIsScreenSharing(false);

    // stop camera stream
    try {
      cameraStreamRef.current?.getTracks()?.forEach((t) => t.stop());
    } catch {
      // ignore
    }
    cameraStreamRef.current = null;
    cameraTrackRef.current = null;

    // stop whatever is currently previewed
    try {
      userStream?.getTracks()?.forEach((t) => t.stop());
    } catch {
      // ignore
    }
    setUserStream(null);

    // destroy peers
    try {
      for (const [peerID, item] of peersRef.current.entries()) {
        try {
          item.peer.destroy();
        } catch {
          // ignore
        }
        peersRef.current.delete(peerID);
      }
    } catch {
      // ignore
    }

    pendingSignalsRef.current = new Map();
    lastBytesRef.current = new Map();

    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    navigate("/");
  }

  // refresh devices after permissions are granted
  useEffect(() => {
    if (!joined) return;

    refreshDeviceList();

    const onChange = () => refreshDeviceList();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);

    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);

  // global cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        screenStreamRef.current?.getTracks()?.forEach((t) => t.stop());
      } catch {}
      try {
        cameraStreamRef.current?.getTracks()?.forEach((t) => t.stop());
      } catch {}
      try {
        userStream?.getTracks()?.forEach((t) => t.stop());
      } catch {}

      try {
        for (const [, item] of peersRef.current.entries()) {
          try {
            item.peer.destroy();
          } catch {}
        }
      } catch {}

      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const track =
      (isScreenSharing ? cameraStreamRef.current : userStream)?.getAudioTracks?.()?.[0] ||
      userStream?.getAudioTracks?.()?.[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsAudioMuted(!track.enabled);
  };

  const toggleVideo = () => {
    const track = userStream?.getVideoTracks?.()?.[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsVideoMuted(!track.enabled);
  };

  return (
    <div className="bg-gray-900 min-h-screen p-4 flex flex-col justify-between">
      <div className="flex justify-between items-center mb-4 px-4">
        <h1 className="text-white text-xl font-bold">Meeting Room: {roomId}</h1>

        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-sm">{peersRef.current.size + 1} Participants</span>

          <button
            onClick={copyInviteLink}
            className="px-3 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 text-sm hover:bg-gray-700"
          >
            Copy link
          </button>

          <button
            onClick={leaveMeeting}
            className="px-3 py-1 rounded bg-red-600 border border-red-700 text-white text-sm hover:bg-red-500"
            disabled={!joined}
          >
            Leave
          </button>

          <button
            onClick={() => setStatsEnabled((v) => !v)}
            className="px-3 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 text-sm hover:bg-gray-700"
            disabled={!joined}
          >
            {statsEnabled ? "Hide stats" : "Show stats"}
          </button>

          <button
            onClick={() =>
              safeDownloadJson(`webrtc-stats-${roomId}-${Date.now()}.json`, {
                roomId,
                ts: Date.now(),
                peers: peerStats,
              })
            }
            className="px-3 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 text-sm hover:bg-gray-700"
            disabled={!joined}
          >
            Download stats
          </button>

          <button
            onClick={joinMeeting}
            className="px-3 py-1 rounded bg-blue-600 border border-blue-700 text-white text-sm hover:bg-blue-500 disabled:opacity-50"
            disabled={joined}
          >
            {joined ? "Joined" : "Join"}
          </button>
        </div>
      </div>

      {statsEnabled ? (
        <div className="mx-4 mb-3 p-3 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm">
          <div className="font-semibold mb-2">WebRTC Stats (approx.)</div>
          {Object.keys(peerStats).length === 0 ? (
            <div className="text-gray-400">No peer stats yet…</div>
          ) : (
            <div className="space-y-1">
              {Object.entries(peerStats).map(([id, s]) => (
                <div key={id} className="flex flex-wrap gap-x-4 gap-y-1">
                  <div className="font-mono">{id.slice(0, 6)}</div>
                  <div>↓ {s.inKbps ?? "-"} kbps</div>
                  <div>↑ {s.outKbps ?? "-"} kbps</div>
                  <div>RTT {s.rttMs ?? "-"} ms</div>
                  <div>Loss {s.packetsLostIn ?? "-"} pkts</div>
                  <div>Jitter {s.jitterMs ?? "-"} ms</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {joined ? (
        <div className="mx-4 mb-3 p-3 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm">
          <div className="font-semibold mb-2">Devices</div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <label className="flex flex-col gap-1">
              <span className="text-gray-300">Camera</span>
              <select
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
                value={selectedCamId}
                onChange={(e) => setSelectedCamId(e.target.value)}
              >
                {devices.cams.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera (${d.deviceId.slice(0, 6)})`}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-gray-300">Microphone</span>
              <select
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
                value={selectedMicId}
                onChange={(e) => setSelectedMicId(e.target.value)}
              >
                {devices.mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Mic (${d.deviceId.slice(0, 6)})`}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={applySelectedDevices}
              disabled={isApplyingDevices}
              className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {isApplyingDevices ? "Applying..." : "Apply"}
            </button>
          </div>

          {mediaError ? (
            <div className="mt-3 p-3 rounded border border-red-500 bg-red-500/10 text-red-200 text-sm">
              {mediaError}
            </div>
          ) : null}
        </div>
      ) : null}

      {joined ? (
        <div className="mx-4 mb-3 rounded border border-gray-700 bg-gray-800 text-gray-100">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
            <div className="font-semibold text-sm">Chat</div>
            <button
              className="text-xs px-2 py-1 rounded bg-gray-900 border border-gray-700 hover:bg-gray-700"
              onClick={() => setChatOpen((v) => !v)}
            >
              {chatOpen ? "Hide" : "Show"}
            </button>
          </div>

          {chatOpen ? (
            <div className="p-3">
              <div className="h-40 overflow-auto border border-gray-700 rounded bg-gray-900 p-2 text-sm">
                {messages.length === 0 ? (
                  <div className="text-gray-400">No messages yet.</div>
                ) : (
                  messages.map((m, idx) => (
                    <div key={m.id || `${m.ts}-${m.from}-${idx}`} className="mb-1">
                      <span className="text-gray-400">{m.from?.slice?.(0, 6) || "?"}:</span>{" "}
                      <span className="text-gray-100">{m.text}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-2 flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendChat();
                  }}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white"
                  placeholder="Type a message…"
                />
                <button
                  onClick={sendChat}
                  className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm"
                  disabled={!joined}
                >
                  Send
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 flex-grow p-4">
        <VideoTile stream={userStream} label="You" muted />
        {Object.keys(remoteStreams).map((id) => (
          <VideoTile key={id} stream={remoteStreams[id]} label={id.slice(0, 6)} />
        ))}
      </div>

      <div className="flex justify-center gap-6 pb-6 mt-4">
        <button
          onClick={toggleMute}
          className={`p-4 rounded-full ${
            isAudioMuted ? "bg-red-500" : "bg-gray-700 hover:bg-gray-600"
          } text-white shadow-lg transition-all`}
          disabled={!joined}
        >
          {isAudioMuted ? <MicOff /> : <Mic />}
        </button>

        <button
          onClick={toggleVideo}
          className={`p-4 rounded-full ${
            isVideoMuted ? "bg-red-500" : "bg-gray-700 hover:bg-gray-600"
          } text-white shadow-lg transition-all`}
          disabled={!joined}
        >
          {isVideoMuted ? <VideoOff /> : <VideoIcon />}
        </button>

        <button
          onClick={isScreenSharing ? stopScreenShare : startScreenShare}
          className="p-4 rounded-full bg-gray-700 hover:bg-gray-600 text-white shadow-lg transition-all"
          disabled={!joined}
        >
          {isScreenSharing ? "Stop" : "Share"}
        </button>
      </div>
    </div>
  );
};

export default Room;
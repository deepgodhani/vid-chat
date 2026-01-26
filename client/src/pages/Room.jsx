import React, { useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
import { useParams, useNavigate } from "react-router-dom";
import { Mic, MicOff, Video as VideoIcon, VideoOff } from "lucide-react";
import VideoTile from "../components/VideoTile.jsx";
import AudioTile from "../components/AudioTile.jsx";

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL;

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

function streamTrackKey(stream) {
  if (!stream) return "none";
  try {
    return stream
      .getTracks()
      .map((t) => `${t.kind}:${t.id}`)
      .sort()
      .join("|");
  } catch {
    return "unknown";
  }
}

const Room = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [joined, setJoined] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [userStream, setUserStream] = useState(null);

  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);

  const [remoteStreams, setRemoteStreams] = useState({});

  // chat
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([]);

  const socketRef = useRef(null);

  // prevent double-join
  const joiningRef = useRef(false);

  // mediasoup
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);

  const producersRef = useRef(new Map()); // kind -> producer
  const consumersRef = useRef(new Map()); // consumerId -> { consumer, peerId, producerId, kind }

  const localAudioTrackRef = useRef(null);
  const localVideoTrackRef = useRef(null);

  const remoteStreamsRef = useRef(new Map()); // peerId -> MediaStream

  const participantCount = useMemo(() => {
    const peers = new Set(Object.keys(remoteStreams));
    return 1 + peers.size;
  }, [remoteStreams]);

  function getOrCreatePeerStream(peerId) {
    let s = remoteStreamsRef.current.get(peerId);
    if (!s) {
      s = new MediaStream();
      remoteStreamsRef.current.set(peerId, s);
    }
    return s;
  }

  function syncRemoteStreamsState() {
    const obj = {};
    for (const [peerId, stream] of remoteStreamsRef.current.entries()) {
      obj[peerId] = stream;
    }
    setRemoteStreams(obj);
  }

  function addRemoteTrack(peerId, kind, track) {
    const stream = getOrCreatePeerStream(peerId);

    // replace any existing track of same kind (audio/video)
    for (const t of stream.getTracks()) {
      if (t.kind === kind) stream.removeTrack(t);
    }
    stream.addTrack(track);

    console.log("[SFU] added remote track", { peerId, kind, trackId: track.id });
    syncRemoteStreamsState();
  }

  function removeRemoteProducer(producerId) {
    for (const [consumerId, info] of consumersRef.current.entries()) {
      if (info.producerId !== producerId) continue;

      try {
        info.consumer.close();
      } catch {}
      consumersRef.current.delete(consumerId);

      const s = remoteStreamsRef.current.get(info.peerId);
      if (s) {
        for (const t of s.getTracks()) {
          if (t.kind === info.kind) s.removeTrack(t);
        }
        if (s.getTracks().length === 0) {
          remoteStreamsRef.current.delete(info.peerId);
        }
      }
    }
    syncRemoteStreamsState();
  }

  function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    socketRef.current?.emit("chat:send", { roomId, text });
    setChatInput("");
  }

  async function sfuRequest(event, payload) {
    return await new Promise((resolve) => {
      socketRef.current.emit(event, payload, (res) => resolve(res));
    });
  }

  async function createDeviceAndTransports() {
    const joinRes = await sfuRequest("sfu:join", { roomId });
    if (joinRes?.error) throw new Error(joinRes.error);

    const device = new mediasoupClient.Device();
    await device.load({ routerRtpCapabilities: joinRes.rtpCapabilities });
    deviceRef.current = device;

    // --- Define STUN Servers (Google's Free Ones) ---
    const iceServers = [
      // Google STUN (Keep this as backup)
      { urls: "stun:stun.l.google.com:19302" },
      
      // YOUR Self-Hosted TURN Server
      {
        urls: "turn:vid-chat.centralindia.cloudapp.azure.com:3478",
        username: "vidchat",
        credential: "vidchat123",
      },
    ];
    // ------- SEND transport -------
    const sendRes = await sfuRequest("sfu:createTransport", { roomId, direction: "send" });
    if (sendRes?.error) throw new Error(sendRes.error);

    const sendTransport = device.createSendTransport({
      id: sendRes.id,
      iceParameters: sendRes.iceParameters,
      iceCandidates: sendRes.iceCandidates,
      dtlsParameters: sendRes.dtlsParameters,
      iceServers: iceServers, // <--- ADD THIS LINE
      appData: { direction: "send" },
    });

    sendTransport.on("connectionstatechange", (state) => {
      console.log("[sendTransport] connectionstatechange:", state);
    });

    sendTransport.on("connect", ({ dtlsParameters }, cb, errCb) => {
      sfuRequest("sfu:connectTransport", { roomId, transportId: sendTransport.id, dtlsParameters })
        .then((r) => (r?.error ? errCb(new Error(r.error)) : cb()))
        .catch(errCb);
    });

    sendTransport.on("produce", ({ kind, rtpParameters, appData }, cb, errCb) => {
      sfuRequest("sfu:produce", { roomId, transportId: sendTransport.id, kind, rtpParameters, appData })
        .then((r) => (r?.error ? errCb(new Error(r.error)) : cb({ id: r.id })))
        .catch(errCb);
    });

    sendTransportRef.current = sendTransport;

    // ------- RECV transport -------
    const recvRes = await sfuRequest("sfu:createTransport", { roomId, direction: "recv" });
    if (recvRes?.error) throw new Error(recvRes.error);

    const recvTransport = device.createRecvTransport({
      id: recvRes.id,
      iceParameters: recvRes.iceParameters,
      iceCandidates: recvRes.iceCandidates,
      dtlsParameters: recvRes.dtlsParameters,
      iceServers: iceServers, // <--- ADD THIS LINE
      appData: { direction: "recv" },
    });

    recvTransport.on("connectionstatechange", (state) => {
      console.log("[recvTransport] connectionstatechange:", state);
    });

    recvTransport.on("connect", ({ dtlsParameters }, cb, errCb) => {
      sfuRequest("sfu:connectTransport", { roomId, transportId: recvTransport.id, dtlsParameters })
        .then((r) => (r?.error ? errCb(new Error(r.error)) : cb()))
        .catch(errCb);
    });

    recvTransportRef.current = recvTransport;
  }

  async function startLocalMediaAndProduce() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    setUserStream(stream);

    const audioTrack = stream.getAudioTracks()?.[0] || null;
    const videoTrack = stream.getVideoTracks()?.[0] || null;

    localAudioTrackRef.current = audioTrack;
    localVideoTrackRef.current = videoTrack;

    setIsAudioMuted(false);
    setIsVideoMuted(false);

    if (audioTrack) {
      const p = await sendTransportRef.current.produce({
        track: audioTrack,
        appData: { mediaTag: "audio" },
      });
      producersRef.current.set("audio", p);
    }

    if (videoTrack) {
      const p = await sendTransportRef.current.produce({
        track: videoTrack,
        appData: { mediaTag: "video" },
      });
      producersRef.current.set("video", p);
    }
  }

  async function consumeProducer({ producerId, peerId }) {
    const device = deviceRef.current;
    const recvTransport = recvTransportRef.current;
    if (!device || !recvTransport) return;

    const consumeRes = await sfuRequest("sfu:consume", {
      roomId,
      transportId: recvTransport.id,
      producerId,
      rtpCapabilities: device.rtpCapabilities,
    });

    if (consumeRes?.error) {
      console.warn("consume failed:", consumeRes.error);
      return;
    }

    const consumer = await recvTransport.consume({
      id: consumeRes.id,
      producerId: consumeRes.producerId,
      kind: consumeRes.kind,
      rtpParameters: consumeRes.rtpParameters,
    });

    consumersRef.current.set(consumer.id, {
      consumer,
      peerId,
      producerId,
      kind: consumer.kind,
    });

    addRemoteTrack(peerId, consumer.kind, consumer.track);

    consumer.track.onended = () => {
      removeRemoteProducer(producerId);
    };

    const resumeRes = await sfuRequest("sfu:resume", { roomId, consumerId: consumer.id });
    if (resumeRes?.error) console.warn("resume failed:", resumeRes.error);
  }

  const joinMeeting = async () => {
    try {
      if (joined || joiningRef.current) return;
      joiningRef.current = true;

      setMediaError("");
      if (!SIGNALING_URL) throw new Error("VITE_SIGNALING_URL is not set");

      // fresh socket
      socketRef.current = io(SIGNALING_URL, { transports: ["websocket"] });
      socketRef.current.removeAllListeners();

      socketRef.current.on("connect", () => console.log("[socket] connected:", socketRef.current.id));
      socketRef.current.on("connect_error", (e) =>
        console.error("[socket] connect_error:", e?.message || e)
      );

      // if legacy room emits left/disconnect, clear UI
      socketRef.current.on("user left", (peerId) => {
        if (!peerId) return;
        remoteStreamsRef.current.delete(peerId);
        syncRemoteStreamsState();
      });

      socketRef.current.on("disconnect", () => {
        remoteStreamsRef.current.clear();
        syncRemoteStreamsState();
      });

      // chat
      socketRef.current.on("chat:message", (msg) => {
        if (!msg || typeof msg.text !== "string") return;
        if (msg.roomId && msg.roomId !== roomId) return;
        setMessages((prev) => [...prev, msg]);
      });

      socketRef.current.on("chat:history", (history) => {
        if (!Array.isArray(history)) return;
        setMessages(history);
      });

      // SFU notifications
      socketRef.current.on("sfu:newProducer", async ({ producerId, peerId }) => {
        if (!producerId || !peerId) return;
        if (peerId === socketRef.current.id) return;
        await consumeProducer({ producerId, peerId });
      });

      socketRef.current.on("sfu:producerClosed", ({ producerId }) => {
        if (!producerId) return;
        removeRemoteProducer(producerId);
      });

      // Join legacy room ONLY for chat (ok to keep)
      socketRef.current.emit("join room", roomId);

      // SFU init
      await createDeviceAndTransports();
      await startLocalMediaAndProduce();

      // Consume existing producers
      const existing = await sfuRequest("sfu:getProducers", { roomId });
      console.log("[SFU] existing producers:", existing);

      if (existing?.producers?.length) {
        for (const p of existing.producers) {
          if (p.peerId === socketRef.current.id) continue;
          await consumeProducer({ producerId: p.producerId, peerId: p.peerId });
        }
      }

      setJoined(true);
    } catch (err) {
      console.error("Room start failed:", err);
      setMediaError(getFriendlyMediaError(err));
    } finally {
      joiningRef.current = false;
    }
  };

  async function safeSfuLeave() {
    try {
      if (!socketRef.current) return;
      await sfuRequest("sfu:leave", { roomId });
    } catch {}
  }

  function leaveMeeting() {
    setJoined(false);
    setMessages([]);
    setChatInput("");

    // clear remote
    remoteStreamsRef.current.clear();
    setRemoteStreams({});

    // best-effort SFU cleanup
    safeSfuLeave();

    // close consumers
    for (const [, info] of consumersRef.current.entries()) {
      try {
        info.consumer.close();
      } catch {}
    }
    consumersRef.current.clear();

    // close producers
    for (const [, p] of producersRef.current.entries()) {
      try {
        p.close();
      } catch {}
    }
    producersRef.current.clear();

    // close transports
    try {
      sendTransportRef.current?.close();
    } catch {}
    try {
      recvTransportRef.current?.close();
    } catch {}
    sendTransportRef.current = null;
    recvTransportRef.current = null;

    // stop local media
    try {
      userStream?.getTracks()?.forEach((t) => t.stop());
    } catch {}
    setUserStream(null);
    localAudioTrackRef.current = null;
    localVideoTrackRef.current = null;

    // disconnect socket
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    navigate("/");
  }

  const toggleMute = () => {
    const track = localAudioTrackRef.current;
    if (!track) return;
    track.enabled = !track.enabled;
    setIsAudioMuted(!track.enabled);
  };

  const toggleVideo = () => {
    const track = localVideoTrackRef.current;
    if (!track) return;
    track.enabled = !track.enabled;
    setIsVideoMuted(!track.enabled);
  };

  // cleanup if user closes tab / route changes
  useEffect(() => {
    return () => {
      try {
        userStream?.getTracks()?.forEach((t) => t.stop());
      } catch {}
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // debug exposure
  useEffect(() => {
    window.__remoteStreams = remoteStreams;
    window.__remoteStreamKeys = Object.keys(remoteStreams);
  }, [remoteStreams]);

  return (
    <div className="bg-gray-900 h-screen p-4 flex flex-col">
      <div className="flex justify-between items-center mb-4 px-4">
        <h1 className="text-white text-xl font-bold">Meeting Room: {roomId}</h1>

        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-sm">{participantCount} Participants</span>

          <button
            onClick={() => {
              const url = `${window.location.origin}/room/${roomId}`;
              navigator.clipboard?.writeText?.(url);
            }}
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
            onClick={joinMeeting}
            className="px-3 py-1 rounded bg-blue-600 border border-blue-700 text-white text-sm hover:bg-blue-500 disabled:opacity-50"
            disabled={joined}
          >
            {joined ? "Joined" : "Join"}
          </button>
        </div>
      </div>

      {mediaError ? (
        <div className="mx-4 mb-3 p-3 rounded border border-red-500 bg-red-500/10 text-red-200 text-sm">
          {mediaError}
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

<div className="flex-1 min-h-0">
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full overflow-auto p-4">
    <VideoTile stream={userStream} label="You" muted highlight />
    {Object.keys(remoteStreams).map((id) => (
      <React.Fragment key={`${id}-${streamTrackKey(remoteStreams[id])}`}>
        {/* ✅ remote audio playback */}
        <AudioTile stream={remoteStreams[id]} />

        {/* ✅ remote video (muted to avoid autoplay/audio echo) */}
        <VideoTile
          stream={remoteStreams[id]}
          label={`Peer ${id.slice(0, 6)}`}
          muted={true}
        />
      </React.Fragment>
    ))}
  </div>
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
      </div>
    </div>
  );
};

export default Room;
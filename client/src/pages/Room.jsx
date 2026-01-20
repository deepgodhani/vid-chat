import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import { useParams } from "react-router-dom";
import { Mic, MicOff, Video as VideoIcon, VideoOff } from "lucide-react";

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL;

// ✅ Free STUN pool (STUN only)
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.stunprotocol.org:3478" },
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
  // Mobile browsers are picky; avoid heavy constraints.
  // If video fails, fallback to audio-only.
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: "user" },
    });
  } catch (e) {
    // audio-only fallback
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
  }
}

const Room = () => {
  const { roomId } = useParams();

  const [joined, setJoined] = useState(false);
  const [peers, setPeers] = useState([]);
  const [userStream, setUserStream] = useState(null);
  const [mediaError, setMediaError] = useState("");

  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);

  const socketRef = useRef(null);
  const userVideo = useRef(null);
  const peersRef = useRef([]);

  // ✅ Start only after user taps (fixes mobile “not allowed by user agent” cases)
  const joinMeeting = async () => {
    try {
      setMediaError("");

      socketRef.current = io(SIGNALING_URL, { transports: ["websocket"] });

      const stream = await getMediaMobileSafe();
      setUserStream(stream);

      const hasVideo = stream.getVideoTracks().length > 0;
      setIsVideoMuted(!hasVideo);

      if (userVideo.current) userVideo.current.srcObject = stream;

      socketRef.current.emit("join room", roomId);

      socketRef.current.on("all users", (users) => {
        const nextPeers = [];
        users.forEach((userID) => {
          const peer = createPeer(userID, socketRef.current.id, stream);
          peersRef.current.push({ peerID: userID, peer });
          nextPeers.push({ peerID: userID, peer });
        });
        setPeers(nextPeers);
      });

      socketRef.current.on("user joined", (payload) => {
        const peer = addPeer(payload.signal, payload.callerID, stream);
        peersRef.current.push({ peerID: payload.callerID, peer });
        setPeers((prev) => [...prev, { peerID: payload.callerID, peer }]);
      });

      socketRef.current.on("receiving returned signal", (payload) => {
        const item = peersRef.current.find((p) => p.peerID === payload.id);
        if (item) item.peer.signal(payload.signal);
      });

      socketRef.current.on("user left", (id) => {
        const peerObj = peersRef.current.find((p) => p.peerID === id);
        if (peerObj) peerObj.peer.destroy();

        peersRef.current = peersRef.current.filter((p) => p.peerID !== id);
        setPeers(peersRef.current.slice());
      });

      setJoined(true);
    } catch (err) {
      console.error("Room start failed:", err);
      setMediaError(getFriendlyMediaError(err));
    }
  };

  useEffect(() => {
    return () => {
      // cleanup on unmount
      if (userStream) userStream.getTracks().forEach((t) => t.stop());

      peersRef.current.forEach((p) => p.peer.destroy());
      peersRef.current = [];
      setPeers([]);

      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function createPeer(userToSignal, callerID, stream) {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
      config: { iceServers: ICE_SERVERS },
    });

    peer.on("signal", (signal) => {
      socketRef.current.emit("sending signal", { userToSignal, callerID, signal });
    });

    return peer;
  }

  function addPeer(incomingSignal, callerID, stream) {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
      config: { iceServers: ICE_SERVERS },
    });

    peer.on("signal", (signal) => {
      socketRef.current.emit("returning signal", { signal, callerID });
    });

    peer.signal(incomingSignal);
    return peer;
  }

  const toggleMute = () => {
    const track = userStream?.getAudioTracks()?.[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsAudioMuted(!track.enabled);
  };

  const toggleVideo = () => {
    const track = userStream?.getVideoTracks()?.[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsVideoMuted(!track.enabled);
  };

  const Video = ({ peer }) => {
    const ref = useRef(null);
    useEffect(() => {
      peer.on("stream", (stream) => {
        if (ref.current) ref.current.srcObject = stream;
      });
    }, [peer]);

    return (
      <div className="bg-black rounded-lg overflow-hidden border border-gray-700 relative w-full h-full min-h-[200px]">
        <video playsInline autoPlay ref={ref} className="w-full h-full object-cover" />
      </div>
    );
  };

  return (
    <div className="bg-gray-900 min-h-screen p-4 flex flex-col justify-between">
      <div className="flex justify-between items-center mb-4 px-4">
        <h1 className="text-white text-xl font-bold">Meeting Room: {roomId}</h1>
        <span className="text-gray-400 text-sm">{peers.length + 1} Participants</span>
      </div>

      {!joined ? (
        <div className="p-4 mx-4 rounded border border-gray-700 bg-gray-800 text-white">
          <div className="mb-2 font-semibold">Start your camera/mic</div>
          <div className="text-sm text-gray-300 mb-4">
            On mobile, you must tap a button before the browser allows camera/mic.
          </div>

          {mediaError ? (
            <div className="mb-4 p-3 rounded border border-red-500 bg-red-500/10 text-red-200 text-sm">
              {mediaError}
            </div>
          ) : null}

          <button
            onClick={joinMeeting}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white"
          >
            Join meeting
          </button>

          <div className="text-xs text-gray-400 mt-3">
            Note: STUN-only is free but may fail on some networks. If calls fail on mobile data/corporate Wi‑Fi, you need TURN.
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 flex-grow p-4">
        <div className="bg-black rounded-lg overflow-hidden border border-gray-700 relative min-h-[200px]">
          <video muted ref={userVideo} autoPlay playsInline className="w-full h-full object-cover" />
          <div className="absolute bottom-2 left-2 text-white bg-black/50 px-2 py-1 text-sm rounded">You</div>
        </div>

        {peers.map((p) => (
          <Video key={p.peerID} peer={p.peer} />
        ))}
      </div>

      <div className="flex justify-center gap-6 pb-6 mt-4">
        <button
          onClick={toggleMute}
          className={`p-4 rounded-full ${isAudioMuted ? "bg-red-500" : "bg-gray-700 hover:bg-gray-600"} text-white shadow-lg transition-all`}
          disabled={!joined}
        >
          {isAudioMuted ? <MicOff /> : <Mic />}
        </button>
        <button
          onClick={toggleVideo}
          className={`p-4 rounded-full ${isVideoMuted ? "bg-red-500" : "bg-gray-700 hover:bg-gray-600"} text-white shadow-lg transition-all`}
          disabled={!joined}
        >
          {isVideoMuted ? <VideoOff /> : <VideoIcon />}
        </button>
      </div>
    </div>
  );
};

export default Room;
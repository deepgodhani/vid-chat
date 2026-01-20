import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import { useParams } from "react-router-dom";
import { Mic, MicOff, Video as VideoIcon, VideoOff } from "lucide-react";

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL;

const Room = () => {
  const { roomId } = useParams();
  const [peers, setPeers] = useState([]);
  const [userStream, setUserStream] = useState();
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);

  const socketRef = useRef(null);
  const userVideo = useRef();
  const peersRef = useRef([]);

  useEffect(() => {
    let mounted = true;

    async function start() {
      // 1) Create socket connection (per component)
      socketRef.current = io(SIGNALING_URL, {
        transports: ["websocket"],
      });

      // 2) Get media
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (!mounted) return;

      setUserStream(stream);
      if (userVideo.current) userVideo.current.srcObject = stream;

      // 3) Join room
      socketRef.current.emit("join room", roomId);

      // Existing users -> create offers
      socketRef.current.on("all users", (users) => {
        const nextPeers = [];
        users.forEach((userID) => {
          const peer = createPeer(userID, socketRef.current.id, stream);
          peersRef.current.push({ peerID: userID, peer });
          nextPeers.push({ peerID: userID, peer });
        });
        setPeers(nextPeers);
      });

      // New user joined -> answer their offer
      socketRef.current.on("user joined", (payload) => {
        const peer = addPeer(payload.signal, payload.callerID, stream);
        peersRef.current.push({ peerID: payload.callerID, peer });
        setPeers((prev) => [...prev, { peerID: payload.callerID, peer }]);
      });

      // Receive answer to our offer
      socketRef.current.on("receiving returned signal", (payload) => {
        const item = peersRef.current.find((p) => p.peerID === payload.id);
        if (item) item.peer.signal(payload.signal);
      });

      // User left
      socketRef.current.on("user left", (id) => {
        const peerObj = peersRef.current.find((p) => p.peerID === id);
        if (peerObj) peerObj.peer.destroy();

        peersRef.current = peersRef.current.filter((p) => p.peerID !== id);
        setPeers(peersRef.current.slice());
      });
    }

    start().catch((err) => {
      console.error("Room start failed:", err);
      alert(err?.message || "Failed to start media / socket");
    });

    return () => {
      mounted = false;

      // stop camera/mic
      if (userStream) {
        userStream.getTracks().forEach((t) => t.stop());
      }

      // destroy peers
      peersRef.current.forEach((p) => p.peer.destroy());
      peersRef.current = [];
      setPeers([]);

      // remove listeners + disconnect socket
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  function createPeer(userToSignal, callerID, stream) {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          // ✅ add TURN via env (see .env section below)
          ...(import.meta.env.VITE_TURN_URL
            ? [{
                urls: import.meta.env.VITE_TURN_URL,
                username: import.meta.env.VITE_TURN_USERNAME,
                credential: import.meta.env.VITE_TURN_CREDENTIAL,
              }]
            : []),
        ],
      },
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
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          ...(import.meta.env.VITE_TURN_URL
            ? [{
                urls: import.meta.env.VITE_TURN_URL,
                username: import.meta.env.VITE_TURN_USERNAME,
                credential: import.meta.env.VITE_TURN_CREDENTIAL,
              }]
            : []),
        ],
      },
    });

    peer.on("signal", (signal) => {
      socketRef.current.emit("returning signal", { signal, callerID });
    });

    peer.signal(incomingSignal);
    return peer;
  }

  const toggleMute = () => {
    if (userStream?.getAudioTracks()?.[0]) {
      const track = userStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      setIsAudioMuted(!track.enabled);
    }
  };

  const toggleVideo = () => {
    if (userStream?.getVideoTracks()?.[0]) {
      const track = userStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
      setIsVideoMuted(!track.enabled);
    }
  };

  const Video = ({ peer }) => {
    const ref = useRef();
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
        >
          {isAudioMuted ? <MicOff /> : <Mic />}
        </button>
        <button
          onClick={toggleVideo}
          className={`p-4 rounded-full ${isVideoMuted ? "bg-red-500" : "bg-gray-700 hover:bg-gray-600"} text-white shadow-lg transition-all`}
        >
          {isVideoMuted ? <VideoOff /> : <VideoIcon />}
        </button>
      </div>
    </div>
  );
};

export default Room;
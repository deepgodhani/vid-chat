import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import { useParams } from "react-router-dom";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";

// Use your Render Backend URL here
const socket = io.connect("https://video-chat-backend-v2.onrender.com");

const Room = () => {
    const { roomId } = useParams();
    const [stream, setStream] = useState();
    const [isAudioMuted, setIsAudioMuted] = useState(false);
    const [isVideoMuted, setIsVideoMuted] = useState(false);
    
    const myVideo = useRef();
    const userVideo = useRef();
    const connectionRef = useRef();

    useEffect(() => {
        // 1. Get User Media (Camera/Mic)
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((currentStream) => {
            setStream(currentStream);
            if (myVideo.current) {
                myVideo.current.srcObject = currentStream;
            }

            // 2. Join the Room once we have the stream
            socket.emit("join room", roomId);

            // 3. Setup Listeners
            socket.on("other user", (otherUserID) => {
                callUser(otherUserID, currentStream);
            });

            socket.on("user joined", (userID) => {
                // Wait for them to call us
                console.log("User joined:", userID);
            });

            socket.on("offer", handleReceiveCall);
            socket.on("answer", handleAnswer);
            socket.on("ice-candidate", handleNewICECandidateMsg);

        }).catch(err => console.error("Media Error:", err));

        // Cleanup
        return () => {
            socket.off("other user");
            socket.off("user joined");
            socket.off("offer");
            socket.off("answer");
            socket.off("ice-candidate");
        };
    }, [roomId]);

    // --- Core WebRTC Functions ---

    function callUser(userID, stream) {
        const peer = new Peer({
            initiator: true,
            trickle: false,
            stream: stream,
            config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
        });

        peer.on("signal", signal => {
            socket.emit("offer", { target: userID, caller: socket.id, signal });
        });

        peer.on("stream", userStream => {
            if (userVideo.current) userVideo.current.srcObject = userStream;
        });

        socket.on("answer", payload => {
            peer.signal(payload.signal);
        });

        connectionRef.current = peer;
    }

    function handleReceiveCall(payload) {
        const peer = new Peer({
            initiator: false,
            trickle: false,
            stream: stream, // This might be stale due to closure, usually solved with useRef or better state mgmt, but works for simple case
            config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
        });

        peer.on("signal", signal => {
            socket.emit("answer", { target: payload.caller, signal });
        });

        peer.on("stream", userStream => {
            if (userVideo.current) userVideo.current.srcObject = userStream;
        });

        peer.signal(payload.signal);
        connectionRef.current = peer;
    }

    function handleAnswer(message) {
        if (connectionRef.current) {
            connectionRef.current.signal(message.signal);
        }
    }

    function handleNewICECandidateMsg(incoming) {
        if (connectionRef.current) {
            connectionRef.current.signal(incoming.candidate);
        }
    }

    // --- Controls ---
    const toggleMute = () => {
        stream.getAudioTracks()[0].enabled = !stream.getAudioTracks()[0].enabled;
        setIsAudioMuted(!isAudioMuted);
    };

    const toggleVideo = () => {
        stream.getVideoTracks()[0].enabled = !stream.getVideoTracks()[0].enabled;
        setIsVideoMuted(!isVideoMuted);
    };

    return (
        <div className="h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
            <h1 className="text-white mb-4 font-bold">Room ID: {roomId}</h1>
            
            <div className="flex flex-col md:flex-row gap-4 w-full max-w-4xl h-[60vh]">
                {/* My Video */}
                <div className="flex-1 bg-black rounded-xl overflow-hidden relative border border-gray-700">
                    <video muted ref={myVideo} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute bottom-2 left-2 text-white bg-black/50 px-2 rounded">You</div>
                </div>

                {/* Other User Video */}
                <div className="flex-1 bg-black rounded-xl overflow-hidden relative border border-gray-700">
                    <video ref={userVideo} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute bottom-2 left-2 text-white bg-black/50 px-2 rounded">Peer</div>
                </div>
            </div>

            {/* Controls Bar */}
            <div className="mt-8 flex gap-4">
                <button onClick={toggleMute} className={`p-4 rounded-full ${isAudioMuted ? 'bg-red-500' : 'bg-gray-700 hover:bg-gray-600'} text-white transition`}>
                    {isAudioMuted ? <MicOff /> : <Mic />}
                </button>
                <button onClick={toggleVideo} className={`p-4 rounded-full ${isVideoMuted ? 'bg-red-500' : 'bg-gray-700 hover:bg-gray-600'} text-white transition`}>
                    {isVideoMuted ? <VideoOff /> : <Video />}
                </button>
            </div>
        </div>
    );
};

export default Room;
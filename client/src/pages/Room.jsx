import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import { useParams } from "react-router-dom";
import { Mic, MicOff, Video as VideoIcon, VideoOff } from "lucide-react";

// Point to your Render Backend
const socket = io.connect("https://vid-chat-backend-3lm5.onrender.com");

// Helper component to render each peer's video
const Video = ({ peer }) => {
    const ref = useRef();

    useEffect(() => {
        peer.on("stream", stream => {
            ref.current.srcObject = stream;
        });
    }, [peer]);

    return (
        <div className="flex-1 bg-black rounded-xl overflow-hidden relative border border-gray-700 min-w-[300px]">
            <video playsInline autoPlay ref={ref} className="w-full h-full object-cover" />
        </div>
    );
};

const Room = () => {
    const { roomId } = useParams();
    const [peers, setPeers] = useState([]);
    const [userStream, setUserStream] = useState();
    const [isAudioMuted, setIsAudioMuted] = useState(false);
    const [isVideoMuted, setIsVideoMuted] = useState(false);
    
    const userVideo = useRef();
    const peersRef = useRef([]); // Stores peer objects to prevent stale state

    useEffect(() => {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
            setUserStream(stream);
            if (userVideo.current) {
                userVideo.current.srcObject = stream;
            }

            socket.emit("join room", roomId);

            // 1. Receive list of existing users
            socket.on("all users", users => {
                const peers = [];
                users.forEach(userID => {
                    const peer = createPeer(userID, socket.id, stream);
                    peersRef.current.push({
                        peerID: userID,
                        peer,
                    });
                    peers.push({
                        peerID: userID,
                        peer, 
                    });
                });
                setPeers(peers);
            });

            // 2. Someone else joined (receive their offer)
            socket.on("user joined", payload => {
                const peer = addPeer(payload.signal, payload.callerID, stream);
                peersRef.current.push({
                    peerID: payload.callerID,
                    peer,
                });
                // Use function update to ensure we have previous state
                setPeers(users => [...users, { peerID: payload.callerID, peer }]);
            });

            // 3. Receive the answer to our offer
            socket.on("receiving returned signal", payload => {
                const item = peersRef.current.find(p => p.peerID === payload.id);
                item.peer.signal(payload.signal);
            });
            
             // 4. Handle user disconnect (Optional: remove video)
            socket.on("user left", id => {
                const peerObj = peersRef.current.find(p => p.peerID === id);
                if(peerObj) peerObj.peer.destroy();
                const newPeers = peersRef.current.filter(p => p.peerID !== id);
                peersRef.current = newPeers;
                setPeers(newPeers);
            });

        });
    }, [roomId]);

    // Create a Peer (Initiator) - You are calling them
    function createPeer(userToSignal, callerID, stream) {
        const peer = new Peer({
            initiator: true,
            trickle: false,
            stream,
            config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
        });

        peer.on("signal", signal => {
            socket.emit("sending signal", { userToSignal, callerID, signal });
        });

        return peer;
    }

    // Add a Peer (Not Initiator) - They called you
    function addPeer(incomingSignal, callerID, stream) {
        const peer = new Peer({
            initiator: false,
            trickle: false,
            stream,
            config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
        });

        peer.on("signal", signal => {
            socket.emit("returning signal", { signal, callerID });
        });

        peer.signal(incomingSignal);

        return peer;
    }

    const toggleMute = () => {
        if(userStream) {
            userStream.getAudioTracks()[0].enabled = !userStream.getAudioTracks()[0].enabled;
            setIsAudioMuted(!isAudioMuted);
        }
    };

    const toggleVideo = () => {
        if(userStream) {
            userStream.getVideoTracks()[0].enabled = !userStream.getVideoTracks()[0].enabled;
            setIsVideoMuted(!isVideoMuted);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col items-center p-4">
            <h1 className="text-white mb-4 font-bold">Room ID: {roomId}</h1>
            
            {/* Grid Container for Videos */}
            <div className="flex flex-wrap gap-4 w-full max-w-6xl justify-center items-center h-full">
                
                {/* My Video */}
                <div className="flex-1 bg-black rounded-xl overflow-hidden relative border border-gray-700 min-w-[300px]">
                    <video muted ref={userVideo} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute bottom-2 left-2 text-white bg-black/50 px-2 rounded">You</div>
                </div>

                {/* Other Users' Videos */}
                {peers.map((peer, index) => {
                    return (
                        <Video key={peer.peerID} peer={peer.peer} />
                    );
                })}
            </div>

            {/* Controls */}
            <div className="fixed bottom-8 flex gap-4">
                <button onClick={toggleMute} className={`p-4 rounded-full ${isAudioMuted ? 'bg-red-500' : 'bg-gray-700 hover:bg-gray-600'} text-white transition`}>
                    {isAudioMuted ? <MicOff /> : <Mic />}
                </button>
                <button onClick={toggleVideo} className={`p-4 rounded-full ${isVideoMuted ? 'bg-red-500' : 'bg-gray-700 hover:bg-gray-600'} text-white transition`}>
                    {isVideoMuted ? <VideoOff /> : <VideoIcon />}
                </button>
            </div>
        </div>
    );
};

export default Room;
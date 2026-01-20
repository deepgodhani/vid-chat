import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import { useParams } from "react-router-dom";
import { Mic, MicOff, Video as VideoIcon, VideoOff } from "lucide-react";

// Point this to your backend URL
const socket = io.connect("https://vid-chat-backend-3lm5.onrender.com");

// Component to render a single peer's video
const Video = ({ peer }) => {
    const ref = useRef();
    useEffect(() => {
        peer.on("stream", stream => {
            ref.current.srcObject = stream;
        });
    }, [peer]);
    return (
        <div className="bg-black rounded-lg overflow-hidden border border-gray-700 relative w-full h-full min-h-[200px]">
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
    const peersRef = useRef([]); // Keeps track of peers without triggering re-renders

    useEffect(() => {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
            setUserStream(stream);
            if (userVideo.current) {
                userVideo.current.srcObject = stream;
            }

            socket.emit("join room", roomId);

            // 1. You joined: Receive list of existing users
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

            // 2. Someone else joined: Receive their signal (Offer)
            socket.on("user joined", payload => {
                const peer = addPeer(payload.signal, payload.callerID, stream);
                peersRef.current.push({
                    peerID: payload.callerID,
                    peer,
                });
                setPeers(users => [...users, { peerID: payload.callerID, peer }]);
            });

            // 3. Handshake: Receive the answer to your offer
            socket.on("receiving returned signal", payload => {
                const item = peersRef.current.find(p => p.peerID === payload.id);
                if (item) {
                    item.peer.signal(payload.signal);
                }
            });
            
             // 4. Handle Disconnect
             socket.on("user left", id => {
                 const peerObj = peersRef.current.find(p => p.peerID === id);
                 if(peerObj) peerObj.peer.destroy();
                 const newPeers = peersRef.current.filter(p => p.peerID !== id);
                 peersRef.current = newPeers;
                 setPeers(newPeers); // Update UI
             });
        });
        
        // Cleanup on unmount
        return () => {
            socket.disconnect();
        };
    }, []);

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
        if (userStream) {
            userStream.getAudioTracks()[0].enabled = !userStream.getAudioTracks()[0].enabled;
            setIsAudioMuted(!isAudioMuted);
        }
    };

    const toggleVideo = () => {
        if (userStream) {
            userStream.getVideoTracks()[0].enabled = !userStream.getVideoTracks()[0].enabled;
            setIsVideoMuted(!isVideoMuted);
        }
    };

    return (
        <div className="bg-gray-900 min-h-screen p-4 flex flex-col justify-between">
            <div className="flex justify-between items-center mb-4 px-4">
                 <h1 className="text-white text-xl font-bold">Meeting Room: {roomId}</h1>
                 <span className="text-gray-400 text-sm">{peers.length + 1} Participants</span>
            </div>

            {/* Video Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 flex-grow p-4">
                <div className="bg-black rounded-lg overflow-hidden border border-gray-700 relative min-h-[200px]">
                    <video muted ref={userVideo} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute bottom-2 left-2 text-white bg-black/50 px-2 py-1 text-sm rounded">You</div>
                </div>
                {peers.map((peer) => (
                    <Video key={peer.peerID} peer={peer.peer} />
                ))}
            </div>

            {/* Controls Bar */}
            <div className="flex justify-center gap-6 pb-6 mt-4">
                <button onClick={toggleMute} className={`p-4 rounded-full ${isAudioMuted ? 'bg-red-500' : 'bg-gray-700 hover:bg-gray-600'} text-white shadow-lg transition-all`}>
                    {isAudioMuted ? <MicOff /> : <Mic />}
                </button>
                <button onClick={toggleVideo} className={`p-4 rounded-full ${isVideoMuted ? 'bg-red-500' : 'bg-gray-700 hover:bg-gray-600'} text-white shadow-lg transition-all`}>
                    {isVideoMuted ? <VideoOff /> : <VideoIcon />}
                </button>
            </div>
        </div>
    );
};

export default Room;
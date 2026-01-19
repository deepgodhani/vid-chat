import React, { useEffect, useRef, useState } from "react"
import Peer from "simple-peer"
import io from "socket.io-client"
import "./App.css"

// Point to Localhost for now. We change this LATER for Vercel.
const socket = io.connect("https://vid-chat-backend-3lm5.onrender.com")

function App() {
	const [me, setMe] = useState("")
	const [stream, setStream] = useState()
	const [receivingCall, setReceivingCall] = useState(false)
	const [caller, setCaller] = useState("")
	const [callerSignal, setCallerSignal] = useState()
	const [callAccepted, setCallAccepted] = useState(false)
	const [idToCall, setIdToCall] = useState("")
	const [callEnded, setCallEnded] = useState(false)
	const [name, setName] = useState("")

	const myVideo = useRef()
	const userVideo = useRef()
	const connectionRef = useRef()

	useEffect(() => {
		// 1. Get Video Stream
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then((stream) => {
      setStream(stream)
              // We keep this, but it often fails because 'myVideo.current' is null here
      if (myVideo.current) {
        myVideo.current.srcObject = stream
      }
    })
          .catch((err) => {
              // THIS IS NEW: Log permission errors
              console.error("CAMERA ERROR:", err)
              alert("Camera failed: " + err.message)
          })
		// 2. Get ID
		socket.on("me", (id) => {
			setMe(id)
		})

    // NEW: Whenever 'stream' is ready, attach it to the video tag
	useEffect(() => {
		if (myVideo.current && stream) {
			myVideo.current.srcObject = stream
		}
	}, [stream]) // This runs every time 'stream' updates

		// 3. Listen for Call
		socket.on("callUser", (data) => {
			setReceivingCall(true)
			setCaller(data.from)
			setName(data.name)
			setCallerSignal(data.signal)
		})
	}, [])

  const callUser = (id) => {
    const peer = new Peer({
        initiator: true,
        trickle: false,
        stream: stream,
        config: {
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:global.stun.twilio.com:3478" }
            ]
        }
    })

		peer.on("signal", (data) => {
			socket.emit("callUser", {
				userToCall: id,
				signalData: data,
				from: me,
				name: name,
			})
		})

		peer.on("stream", (stream) => {
			if (userVideo.current) {
				userVideo.current.srcObject = stream
			}
		})

		socket.on("callAccepted", (signal) => {
			setCallAccepted(true)
			peer.signal(signal)
		})

		connectionRef.current = peer
	}
  const answerCall = () => {
    setCallAccepted(true)
    const peer = new Peer({
        initiator: false,
        trickle: false,
        stream: stream,
        config: {
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:global.stun.twilio.com:3478" }
            ]
        }
    })
		peer.on("signal", (data) => {
			socket.emit("answerCall", { signal: data, to: caller })
		})

		peer.on("stream", (stream) => {
			if (userVideo.current) {
				userVideo.current.srcObject = stream
			}
		})

		peer.signal(callerSignal)
		connectionRef.current = peer
	}

	return (
		<div style={{ textAlign: "center", padding: "50px" }}>
			<h1>Video Chat V2</h1>
			<div className="video-container">
				<div className="video">
					{stream && <video playsInline muted ref={myVideo} autoPlay style={{ width: "300px" }} />}
				</div>
				<div className="video">
					{callAccepted && !callEnded ? (
						<video playsInline ref={userVideo} autoPlay style={{ width: "300px" }} />
					) : null}
				</div>
			</div>
			
			<div className="myId">
				<h3>My ID: {me}</h3>
				<input
					id="filled-basic"
					placeholder="ID to call"
					value={idToCall}
					onChange={(e) => setIdToCall(e.target.value)}
				/>
				<button variant="contained" color="primary" onClick={() => callUser(idToCall)}>
					Call
				</button>
			</div>

			<div>
				{receivingCall && !callAccepted ? (
						<div className="caller">
						<h1 >Incoming Call...</h1>
						<button variant="contained" color="primary" onClick={answerCall}>
							Answer
						</button>
					</div>
				) : null}
			</div>
		</div>
	)
}

export default App
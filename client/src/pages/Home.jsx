import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Plus, Keyboard } from 'lucide-react';

const Home = () => {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState('');

  const createMeeting = () => {
    const randomId = Math.random().toString(36).substring(2, 9);
    navigate(`/room/${randomId}`);
  };

  const joinMeeting = (e) => {
    e.preventDefault();
    if (roomId.trim()) navigate(`/room/${roomId}`);
  };

  return (
    <div className="h-screen bg-gray-900 text-white p-8">
      {/* Header */}
      <header className="flex justify-between items-center mb-12">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Video size={24} />
          </div>
          <span className="text-xl font-bold">Video Chat Pro</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto flex flex-col md:flex-row gap-12 items-center mt-20">
        <div className="flex-1 space-y-8">
          <h1 className="text-5xl font-bold leading-tight">
            Premium video meetings. Now free for everyone.
          </h1>
          <p className="text-xl text-gray-400">
            Peer-to-peer WebRTC meetings with Socket.IO signaling (demo).
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={createMeeting}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition"
            >
              <Plus size={20} />
              New Meeting
            </button>

            <form onSubmit={joinMeeting} className="flex items-center gap-2">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <Keyboard size={20} />
                </div>
                <input
                  type="text"
                  placeholder="Enter a code or link"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="pl-10 pr-4 py-3 rounded-lg bg-transparent border border-gray-600 focus:border-blue-500 outline-none text-white w-full"
                />
              </div>
              <button
                type="submit"
                className={`text-blue-400 font-medium px-4 hover:bg-blue-500/10 rounded-lg py-3 transition ${!roomId && 'opacity-50 cursor-not-allowed'}`}
                disabled={!roomId}
              >
                Join
              </button>
            </form>
          </div>
        </div>

        <div className="flex-1 flex justify-center">
          <div className="bg-gray-800 p-8 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-md aspect-video flex items-center justify-center text-gray-500">
            (Hero Image / Graphic)
          </div>
        </div>
      </main>
    </div>
  );
};

export default Home;
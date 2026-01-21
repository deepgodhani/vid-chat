import React from 'react';
import { BrowserRouter, Routes, Route } from "react-router-dom";
// import CreateRoom from "./routes/CreateRoom";
import Room from "./pages/Room"; // ✅ use the working one
import Home from "./pages/Home";

function App() {
  return (
    <BrowserRouter>
      <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId" element={<Room />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
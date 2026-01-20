import React from 'react';
import { BrowserRouter, Routes, Route } from "react-router-dom";
// import CreateRoom from "./routes/CreateRoom";
import Room from "./pages/Room"; // ✅ use the working one
import Login from "./pages/Login";
import Home from "./pages/Home";
import PrivateRoute from './components/PrivateRoute';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<PrivateRoute />}>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId" element={<Room />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
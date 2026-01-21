import React, { useEffect, useMemo, useRef } from "react";

function getAudioSig(stream) {
  if (!stream) return "none";
  try {
    return stream
      .getAudioTracks()
      .map((t) => `${t.id}:${t.readyState}`)
      .sort()
      .join("|");
  } catch {
    return "unknown";
  }
}

export default function AudioTile({ stream }) {
  const ref = useRef(null);
  const sig = useMemo(() => getAudioSig(stream), [stream]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // attach stream (audio-only or audio+video is fine)
    el.srcObject = stream || null;

    // try to play; if blocked, user must click once on page
    el.play?.().catch(() => {});

    return () => {
      if (ref.current) ref.current.srcObject = null;
    };
  }, [stream, sig]);

  return <audio ref={ref} autoPlay playsInline />;
}
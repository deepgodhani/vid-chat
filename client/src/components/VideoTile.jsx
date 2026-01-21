import React, { useEffect, useMemo, useRef } from "react";

function getTrackSig(stream) {
  if (!stream) return "none";
  try {
    return stream
      .getTracks()
      .map((t) => `${t.kind}:${t.id}:${t.readyState}`)
      .sort()
      .join("|");
  } catch {
    return "unknown";
  }
}

export default function VideoTile({
  stream,
  label,
  muted = false,
  highlight = false,
}) {
  const ref = useRef(null);

  const trackSig = useMemo(() => getTrackSig(stream), [stream]);

  const trackCount = useMemo(() => {
    try {
      return stream ? stream.getTracks().length : 0;
    } catch {
      return 0;
    }
  }, [stream, trackSig]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.srcObject = stream || null;

    // Try playing whenever tracks change
    el.play?.().catch(() => {});

    return () => {
      if (ref.current) ref.current.srcObject = null;
    };
  }, [stream, trackSig]);

  return (
    <div
      style={{ border: `6px solid ${highlight ? "lime" : "gold"}` }}
      className="bg-black rounded-lg overflow-hidden relative w-full h-full min-h-[200px]"
    >
      <video
        ref={ref}
        muted={muted}
        playsInline
        autoPlay
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-2 left-2 text-white bg-black/60 px-2 py-1 text-xs rounded">
        <div>{label}</div>
        <div className="text-gray-200">tracks: {trackCount}</div>
      </div>
    </div>
  );
}
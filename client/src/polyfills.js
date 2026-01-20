import process from "process";

// Provide browser-friendly `process` for libs that expect it
if (!globalThis.process) {
  globalThis.process = process;
}

// Some deps call process.nextTick; map it to queueMicrotask/setTimeout
if (typeof globalThis.process.nextTick !== "function") {
  globalThis.process.nextTick = (cb, ...args) => {
    if (typeof queueMicrotask === "function") {
      queueMicrotask(() => cb(...args));
    } else {
      setTimeout(() => cb(...args), 0);
    }
  };
}
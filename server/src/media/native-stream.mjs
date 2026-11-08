import { spawn } from "node:child_process";

function framePacket(payload) {
  const header = Buffer.from(JSON.stringify({ type: "frame", mime: "image/jpeg", bytes: payload.length }), "utf8");
  const packet = Buffer.allocUnsafe(4 + header.length + 8 + payload.length);
  packet.writeUInt32BE(header.length, 0);
  header.copy(packet, 4);
  packet.writeBigUInt64BE(BigInt(payload.length), 4 + header.length);
  payload.copy(packet, 4 + header.length + 8);
  return packet;
}

export function streamVideoFrames({ source, response, ffmpeg = "ffmpeg" }) {
  const child = spawn(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-max_pixels", "300000000", "-re", "-i", source,
    "-an", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "3", "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    if (!child.killed) child.kill("SIGTERM");
    if (!response.writableEnded) response.end();
  };
  response.on("close", finish);
  response.on("drain", () => child.stdout.resume());
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) { buffer = Buffer.alloc(0); break; }
      const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) { buffer = buffer.subarray(start); break; }
      const jpeg = buffer.subarray(start, end + 2);
      const packet = framePacket(jpeg);
      if (!response.write(packet)) child.stdout.pause();
      buffer = buffer.subarray(end + 2);
    }
  });
  child.on("error", finish);
  child.on("close", finish);
  return child;
}

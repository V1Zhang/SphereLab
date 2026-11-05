import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { RTCPeerConnection } from "werift";

function tilePath(pattern, frame, column, row) {
  const values = [frame, column, row];
  let index = 0;
  return pattern.replace(/%0?(\d*)d/g, (_token, width) => {
    const value = String(values[index] ?? 0);
    index += 1;
    return width ? value.padStart(Number(width), "0") : value;
  });
}

function jsonMessage(value) {
  return JSON.stringify(value);
}

function waitForIceGathering(peer, timeoutMs = 5000) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { peer.iceGatheringStateChange.allUnsubscribe(); resolve(); }, timeoutMs);
    peer.iceGatheringStateChange.subscribe((state) => {
      if (state === "complete") {
        clearTimeout(timer);
        peer.iceGatheringStateChange.allUnsubscribe();
        resolve();
      }
    });
  });
}

export class TileWebRtcSessions {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
  }

  async create({ offer, manifest }) {
    if (!offer || offer.type !== "offer" || typeof offer.sdp !== "string") {
      const error = new Error("a browser WebRTC offer is required");
      error.code = "webrtc_offer_required";
      throw error;
    }
    const manifestPath = manifest || this.config.media?.manifest;
    if (!manifestPath) {
      const error = new Error("tile manifest is required");
      error.code = "tile_manifest_path_required";
      throw error;
    }
    const tileManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (tileManifest.format !== "png-sequence") {
      const error = new Error("native DataChannel preview requires png-sequence tiles; use the native renderer for EXR input");
      error.code = "webrtc_png_tiles_required";
      throw error;
    }
    const peer = new RTCPeerConnection({ iceServers: this.config.webrtc?.iceServers || [] });
    const id = crypto.randomUUID();
    const session = { id, peer, state: "negotiating", manifestPath, tileManifest, channel: null };
    this.sessions.set(id, session);

    peer.onDataChannel.subscribe((channel) => {
      session.channel = channel;
      channel.stateChange.subscribe(() => {
        if (channel.readyState === "open") {
          session.state = "ready";
          void this.#sendFrame(session, 0).catch((error) => {
            session.state = "error";
            session.error = error.message;
          });
        }
        if (channel.readyState === "closed") session.state = "closed";
      });
    });
    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await waitForIceGathering(peer);
    return { id, state: session.state, answer: peer.localDescription };
  }

  async stop(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    await session.peer.close();
    this.sessions.delete(id);
    return true;
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    return { id: session.id, state: session.state, channelOpen: Boolean(session.channel) };
  }

  async #sendFrame(session, frame) {
    const channel = session.channel;
    const manifest = session.tileManifest;
    if (!channel || channel.readyState !== "open") return;
    const root = path.dirname(session.manifestPath);
    for (let row = 0; row < manifest.tile.rows; row += 1) {
      for (let column = 0; column < manifest.tile.columns; column += 1) {
        const relative = tilePath(manifest.pattern, frame, column, row);
        const file = path.resolve(root, relative);
        const data = await fs.readFile(file);
        channel.send(jsonMessage({ type: "tile", frame, column, row, width: manifest.tile.width, height: manifest.tile.height, mime: "image/png", bytes: data.byteLength }));
        const chunkSize = 48 * 1024;
        for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
          channel.send(data.subarray(offset, Math.min(offset + chunkSize, data.byteLength)));
        }
      }
    }
    channel.send(jsonMessage({ type: "frame-end", frame }));
  }
}

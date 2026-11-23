// Cross-process live battle stream. One append-only journal per submitted round.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

function pathFor(id, directory) {
  const key = createHash('sha256').update(String(id)).digest('hex');
  const root = directory || process.env.SP_LIVE_DIR;
  if (root) return path.join(root, `live-${key}.jsonl`);
  return new URL(`./live-${key}.jsonl`, import.meta.url);
}

export function writeLive(id, packet, directory) {
  if (!id) return;
  fs.appendFileSync(pathFor(id, directory), JSON.stringify(packet) + '\n');
}

export function readLive(id, offset = 0, directory) {
  if (!id) return { offset, packets: [] };
  let fd;
  try {
    fd = fs.openSync(pathFor(id, directory), 'r');
    const size = fs.fstatSync(fd).size;
    if (size < offset) offset = 0;
    const buffer = Buffer.alloc(size - offset);
    fs.readSync(fd, buffer, 0, buffer.length, offset);
    const end = buffer.lastIndexOf(10);
    if (end < 0) return { offset, packets: [] };
    const packets = buffer.subarray(0, end).toString('utf8').split('\n').filter(Boolean).map((s) => JSON.parse(s));
    return { offset: offset + end + 1, packets };
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { offset, packets: [] };
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

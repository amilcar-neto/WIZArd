// Recebe PCM mono 48 kHz; mantém uma fila curta por pessoa e mistura a cada 20 ms.
export class AudioMixer {
  private queues = new Map<string, Buffer[]>();
  private offsets = new Map<string, number>();
  push(id: string, pcm: Buffer) {
    if (pcm.length % 2) throw new Error('PCM inválido.');
    const queue = this.queues.get(id) ?? [];
    if (queue.reduce((n, b) => n + b.length, 0) + pcm.length > 48000 * 2 * 2) throw new Error('A recepção de áudio ficou atrasada.');
    queue.push(Buffer.from(pcm)); this.queues.set(id, queue);
  }
  frame(): Buffer { return this.frames().mix; }
  // Quadro misturado e, separadamente, o quadro de cada pessoa que falou nestes 20 ms.
  frames(): { mix: Buffer; voices: Map<string, Buffer> } {
    const sums = new Int32Array(960), counts = new Uint16Array(960), voices = new Map<string, Buffer>();
    for (const [id, queue] of this.queues) {
      let offset = this.offsets.get(id) ?? 0;
      const own = Buffer.alloc(1920); voices.set(id, own);
      for (let i = 0; i < 960 && queue.length; i++) {
        const sample = queue[0].readInt16LE(offset);
        sums[i] += sample; counts[i]++; own.writeInt16LE(sample, i * 2);
        offset += 2;
        if (offset >= queue[0].length) { queue.shift(); offset = 0; }
      }
      if (!queue.length) { this.queues.delete(id); this.offsets.delete(id); }
      else this.offsets.set(id, offset);
    }
    const pcm = Buffer.alloc(1920);
    for (let i = 0; i < 960; i++) {
      const sample = counts[i] ? Math.round(sums[i] / Math.sqrt(counts[i])) : 0;
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
    }
    return { mix: pcm, voices };
  }
}

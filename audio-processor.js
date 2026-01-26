// audio-processor.js
// AudioWorklet processor for VAD + preroll/postroll + segmentation.
// Sends segments to main thread using a TRANSFERABLE ArrayBuffer (no big copies).

class VoiceAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.params = {
      // VAD / segmentation
      VAD_RMS: 0.010,
      VAD_SILENCE_MS: 1000,
      PREROLL_MS: 300,
      POSTROLL_MS: 450,

      // basic quality gates (optional; main thread also checks)
      MIN_SEG_SECONDS: 0.25,
      MIN_RMS: 0.003
    };

    // State
    this.recording = false;
    this.buffers = [];
    this.prerollBuffer = [];
    this.speechDetected = false;
    this.lastSpeechTS = currentTime;

    // Message handler
    this.port.onmessage = (e) => {
      const { type, data } = e.data || {};
      if (type === "updateParams" && data) {
        Object.assign(this.params, data);
      } else if (type === "start") {
        this.recording = true;
        this.buffers = [];
        this.prerollBuffer = [];
        this.speechDetected = false;
        this.lastSpeechTS = currentTime;
      } else if (type === "stop") {
        this.recording = false;
        this.buffers = [];
        this.prerollBuffer = [];
        this.speechDetected = false;
      }
    };
  }

  rms(arr) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
    return Math.sqrt(sum / (arr.length || 1));
  }

  process(inputs) {
    if (!this.recording) return true;

    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const ch = input[0];
    const frame = new Float32Array(ch); // copy this render quantum
    const frameRMS = this.rms(ch);

    // ----- preroll buffer maintenance -----
    if (!this.speechDetected) {
      const prerollSamples = Math.floor((this.params.PREROLL_MS / 1000) * sampleRate);
      this.prerollBuffer.push(frame);

      let total = 0;
      for (const b of this.prerollBuffer) total += b.length;
      while (total > prerollSamples && this.prerollBuffer.length > 1) {
        const removed = this.prerollBuffer.shift();
        total -= removed.length;
      }

      // VAD trigger
      if (frameRMS >= this.params.VAD_RMS) {
        this.speechDetected = true;
        this.buffers.push(...this.prerollBuffer);
        this.prerollBuffer = [];
      }
    } else {
      this.buffers.push(frame);
    }

    // ----- silence tracking -----
    if (frameRMS >= this.params.VAD_RMS) {
      this.lastSpeechTS = currentTime;
    } else {
      const silentForMs = (currentTime - this.lastSpeechTS) * 1000;

      if (
        this.speechDetected &&
        this.buffers.length &&
        silentForMs > (this.params.VAD_SILENCE_MS + this.params.POSTROLL_MS)
      ) {
        // finalize segment
        this.speechDetected = false;

        // merge buffers to one Float32Array
        let totalSamples = 0;
        for (const b of this.buffers) totalSamples += b.length;

        if (totalSamples > 0) {
          const merged = new Float32Array(totalSamples);
          let off = 0;
          for (const b of this.buffers) {
            merged.set(b, off);
            off += b.length;
          }

          // quick local gating (optional)
          const durSec = merged.length / sampleRate;
          const e = this.rms(merged);

          if (durSec >= this.params.MIN_SEG_SECONDS && e >= this.params.MIN_RMS) {
            // Transfer buffer to main thread (zero-copy transfer)
            const ab = merged.buffer;
            this.port.postMessage(
              {
                type: "segment",
                data: {
                  audioBuffer: ab,
                  length: merged.length,
                  sampleRate
                }
              },
              [ab]
            );
          }
        }

        // reset
        this.buffers = [];
        this.prerollBuffer = [];
      }
    }

    return true;
  }
}

registerProcessor("voice-audio-processor", VoiceAudioProcessor);

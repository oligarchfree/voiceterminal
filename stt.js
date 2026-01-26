// stt.js
// Main-thread Whisper + Intent routing.
// Audio capture/segmentation happens in AudioWorklet (audio-processor.js).
(() => {
  "use strict";

  const CHAT_NAME = window.IntentProcessor?.CHAT_NAME;

  class STTParameters {
    constructor() {
      this.SAMPLE_RATE = 16000;
      this.commandPrompt = `${CHAT_NAME}\n${CHAT_NAME}\n${CHAT_NAME}\n${CHAT_NAME}`.trim();

      this.MIN_SEG_SECONDS = 2.0;
      this.VAD_RMS = 0.010;
      this.MIN_RMS = 0.003;
      this.VAD_SILENCE_MS = 1000;
      this.PREROLL_MS = 300;
      this.POSTROLL_MS = 450;

      this.ENABLE_LEVELING = true;
      this.TARGET_RMS = 0.08;
      this.MAX_GAIN = 6.0;
      this.COMP_THRESHOLD = 0.6;
      this.COMP_RATIO = 3.0;

      this.ENABLE_PREFILTER = true;
      this.HPF_FREQ = 100;
      this.LPF_FREQ = 3500;
    }
  }

  const activeModeParams = new STTParameters();
  const wakeWordParams = new STTParameters();
  wakeWordParams.MIN_SEG_SECONDS = 0.25;
  wakeWordParams.VAD_SILENCE_MS /= 2;
  wakeWordParams.POSTROLL_MS /= 2;

  let currentParameters = wakeWordParams;
  let activeMode = false;

  // ---- state ----
  let asr = null;
  let rec = false;

  let ctx = null;
  let stream = null;
  let src = null;
  let workletNode = null;

  let hp = null;
  let lp = null;
  let zeroGain = null;

  // ---- segment queue ----
  let processingSegment = false;
  let segmentQueue = []; // each: { pcm: Float32Array, inSampleRate: number, params: snapshot }
  let droppedSegments = 0;

  const SEGMENT_QUEUE_MAX_DEFAULT = 8;

  function snapshotParams(p) {
    return {
      SAMPLE_RATE: p.SAMPLE_RATE,
      commandPrompt: p.commandPrompt,
      MIN_SEG_SECONDS: p.MIN_SEG_SECONDS,
      MIN_RMS: p.MIN_RMS,

      ENABLE_LEVELING: p.ENABLE_LEVELING,
      TARGET_RMS: p.TARGET_RMS,
      MAX_GAIN: p.MAX_GAIN,
      COMP_THRESHOLD: p.COMP_THRESHOLD,
      COMP_RATIO: p.COMP_RATIO
    };
  }

  function status(msg) {
    window.onSTTStatus?.(msg);
  }

  function safeDisconnect(node) {
    if (!node) return;
    try { node.disconnect(); } catch {}
  }

  function isSecureContextLocal() {
    const host = (location.hostname || "").replace(/^\[|\]$/g, "");
    return (
      window.isSecureContext ||
      location.protocol === "https:" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1"
    );
  }

  function rms(a) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s / (a.length || 1));
  }

  function resample(data, from, to) {
    if (from === to) return data;
    const ratio = to / from;
    const out = new Float32Array(Math.floor(data.length * ratio));
    for (let i = 0; i < out.length; i++) {
      const idx = i / ratio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, data.length - 1);
      out[i] = data[i0] + (data[i1] - data[i0]) * (idx - i0);
    }
    return out;
  }

  function playSound(freq, duration, volume) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.value = volume;
      osc.start();
      osc.stop(audioCtx.currentTime + duration / 1000);
    } catch {}
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;
    const v0 = new Array(lb + 1);
    const v1 = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) v0[j] = j;
    for (let i = 0; i < la; i++) {
      v1[0] = i + 1;
      for (let j = 0; j < lb; j++) {
        const cost = a[i] === b[j] ? 0 : 1;
        v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
      }
      for (let j = 0; j <= lb; j++) v0[j] = v1[j];
    }
    return v1[lb];
  }

  function textAfterWord(newText, newWord) {
    newText = String(newText).toLowerCase();
    newWord = String(newWord).toLowerCase();
    if (!newText || !newWord) return null;

    const wordRe = /\b[0-9a-z]+\b/gi;
    let m;
    while ((m = wordRe.exec(newText)) !== null) {
      const token = m[0].toLowerCase();
      const dist = levenshtein(token, newWord);
      if (dist <= 2) {
        const idx = m.index + m[0].length;
        let rest = newText.slice(idx).trim();
        rest = rest.replace(/^[^a-z0-9]+/i, "").trim();
        return rest.length ? rest : "";
      }
    }
    return null;
  }

  function containsWord(newText, newWord) {
    newText = String(newText).toLowerCase();
    newWord = String(newWord).toLowerCase();
    if (!newText || !newWord) return false;

    const wordRe = /\b[0-9a-z]+\b/gi;
    let m;
    while ((m = wordRe.exec(newText)) !== null) {
      const token = m[0].toLowerCase();
      const dist = levenshtein(token, newWord);
      if (dist <= 2) return true;
    }
    return false;
  }

  function processSpeechText(newText, transcribeSeconds) {
    if (!window.IntentProcessor?.processSpeechText) {
      console.warn("IntentProcessor not loaded");
      return;
    }

    window.IntentProcessor.processSpeechText(newText, transcribeSeconds, {
      emitCommand: window.onVoiceCommand,
      setActiveMode,
      textAfterWord,
      containsWord,
      activeMode,
      CHAT_NAME
    });
  }

  function configureAudioGraph() {
    if (!ctx || !src || !workletNode) return;

    safeDisconnect(src);
    safeDisconnect(hp);
    safeDisconnect(lp);
    safeDisconnect(workletNode);
    safeDisconnect(zeroGain);

    hp = null;
    lp = null;
    zeroGain = null;

    let upstream = src;

    if (currentParameters.ENABLE_PREFILTER) {
      hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = currentParameters.HPF_FREQ;

      lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = currentParameters.LPF_FREQ;

      src.connect(hp);
      hp.connect(lp);
      upstream = lp;
    }

    upstream.connect(workletNode);

    // keep graph alive but muted
    zeroGain = ctx.createGain();
    zeroGain.gain.value = 0;
    workletNode.connect(zeroGain);
    zeroGain.connect(ctx.destination);

    // push params down to worklet (VAD lives there)
    workletNode.port.postMessage({
      type: "updateParams",
      data: {
        VAD_RMS: currentParameters.VAD_RMS,
        MIN_RMS: currentParameters.MIN_RMS,
        MIN_SEG_SECONDS: currentParameters.MIN_SEG_SECONDS,
        VAD_SILENCE_MS: currentParameters.VAD_SILENCE_MS,
        PREROLL_MS: currentParameters.PREROLL_MS,
        POSTROLL_MS: currentParameters.POSTROLL_MS
      }
    });
  }

  function setActiveMode(isOn) {
    activeMode = isOn;
    currentParameters = isOn ? activeModeParams : wakeWordParams;
    status(isOn ? "🎤 Listening for command..." : "Waiting for wake word...");

    // Important: this updates worklet VAD thresholds immediately
    if (rec && ctx && src && workletNode) {
      try { configureAudioGraph(); } catch {}
    }
  }

  function enqueueSegment(pcmFloat32, inSampleRate) {
    if (!pcmFloat32 || pcmFloat32.length === 0) return;

    const maxQ = Number.isFinite(window.STT?.SEGMENT_QUEUE_MAX)
      ? window.STT.SEGMENT_QUEUE_MAX
      : SEGMENT_QUEUE_MAX_DEFAULT;

    if (segmentQueue.length >= maxQ) {
      segmentQueue.shift();
      droppedSegments++;
      console.warn(`[STT] segmentQueue overflow: dropped oldest (totalDropped=${droppedSegments})`);
    }

    segmentQueue.push({
      pcm: pcmFloat32,
      inSampleRate,
      params: snapshotParams(currentParameters)
    });

    if (!processingSegment) void processNextSegment();
  }

  async function processNextSegment() {
    if (processingSegment || segmentQueue.length === 0) return;
    processingSegment = true;

    const seg = segmentQueue.shift();
    try {
      if (!seg || !seg.pcm || seg.pcm.length === 0) return;

      // resample to Whisper SR
      const pcm = resample(seg.pcm, seg.inSampleRate, seg.params.SAMPLE_RATE);
      const duration = pcm.length / seg.params.SAMPLE_RATE;
      const energy = rms(pcm);

      if (duration < seg.params.MIN_SEG_SECONDS) return;
      if (energy < seg.params.MIN_RMS) return;

      // optional leveling/compression
      if (seg.params.ENABLE_LEVELING && energy > 0) {
        let gain = seg.params.TARGET_RMS / energy;
        if (gain > seg.params.MAX_GAIN) gain = seg.params.MAX_GAIN;

        for (let i = 0; i < pcm.length; i++) {
          let v = pcm[i] * gain;
          const av = Math.abs(v);
          if (av > seg.params.COMP_THRESHOLD) {
            const sign = v < 0 ? -1 : 1;
            const over = av - seg.params.COMP_THRESHOLD;
            v = sign * (seg.params.COMP_THRESHOLD + over / seg.params.COMP_RATIO);
          }
          pcm[i] = Math.max(-1, Math.min(1, v));
        }
      }

      const t0 = performance.now();
      const result = await asr(pcm, {
        prompt: seg.params.commandPrompt,
        condition_on_prev_text: false
      });
      const t1 = performance.now();
      const transcribeSeconds = ((t1 - t0) / 1000).toFixed(2);

      const text = (result?.text || "").trim();
      if (text) {
        console.log("Transcribed:", text);
        const el = document.getElementById("chatLog");
        if (el) el.textContent = text + "\n" + el.textContent;
        processSpeechText(text, transcribeSeconds);
      }
    } catch (err) {
      console.warn("segment processing error:", err);
    } finally {
      processingSegment = false;
      if (rec && segmentQueue.length > 0) void processNextSegment();
    }
  }

  async function initializeSTT() {
    try {
      status("Loading speech recognition model…");

      if (!window.transformersPipeline) {
        const mod = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/transformers.min.js");
        window.transformersPipeline = mod.pipeline;
        window.transformersEnv = mod.env;
        window.transformersTensor = mod.Tensor;
        window.transformersReady = true;
      }

      const pipeline = window.transformersPipeline;
      const env = window.transformersEnv;
      if (env) {
        env.allowLocalModels = false;
        env.remoteURL = "https://huggingface.co";
      }

      asr = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", { quantized: true });
      status('Model loaded. Click "Start Microphone".');
    } catch (e) {
      console.error(e);
      status("Error loading model: " + e.message);
    }
  }

  async function start() {
    if (!asr) {
      status("Model not ready yet…");
      return;
    }

    if (!isSecureContextLocal()) {
      status("Error: microphone requires HTTPS/localhost.");
      throw new Error("Microphone access requires a secure context.");
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    });

    rec = true;
    segmentQueue = [];
    processingSegment = false;
    droppedSegments = 0;

    ctx = new AudioContext();

    // IMPORTANT: audio-processor.js must be served from the same origin (or CORS-enabled).
    await ctx.audioWorklet.addModule("./audio-processor.js");

    src = ctx.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(ctx, "voice-audio-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1
    });

    workletNode.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type !== "segment") return;

      const { audioBuffer, length, sampleRate } = msg.data || {};
      if (!audioBuffer || !length || !sampleRate) return;

      // Reconstruct Float32Array from transferred buffer
      const pcm = new Float32Array(audioBuffer, 0, length);
      // NOTE: `pcm` views the transferred buffer; that's fine because the worklet transferred ownership.
      enqueueSegment(pcm, sampleRate);
    };

    configureAudioGraph();

    // start capture in worklet
    workletNode.port.postMessage({ type: "start" });

    status("Recording… waiting for wake word.");
  }

  async function stop() {
    if (!rec) return;
    rec = false;

    if (workletNode) {
      try { workletNode.port.postMessage({ type: "stop" }); } catch {}
    }

    try { workletNode && workletNode.disconnect(); } catch {}
    try { zeroGain && zeroGain.disconnect(); } catch {}
    try { hp && hp.disconnect(); } catch {}
    try { lp && lp.disconnect(); } catch {}
    try { src && src.disconnect(); } catch {}

    try { stream && stream.getTracks().forEach(t => t.stop()); } catch {}
    try { ctx && await ctx.close(); } catch {}

    segmentQueue = [];
    processingSegment = false;

    ctx = null;
    stream = null;
    src = null;
    workletNode = null;
    hp = null;
    lp = null;
    zeroGain = null;

    setActiveMode(false);
    status("Stopped.");
  }

  async function toggleMic() {
    if (rec) return stop();
    return start();
  }

  // Public API
  window.STT = {
    initializeSTT,
    toggleMic,
    start,
    stop,
    setActiveMode,

    // queue controls / visibility
    SEGMENT_QUEUE_MAX: 8,
    getQueueDepth: () => segmentQueue.length,
    getDroppedSegments: () => droppedSegments
  };

  window.addEventListener("load", initializeSTT);
})();

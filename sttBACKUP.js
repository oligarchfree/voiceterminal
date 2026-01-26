// stt.js (modified to include built-in AUDIO GAP sanity check)
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

			this.ENABLE_ANALYSER_VAD = true;
			this.ANALYSER_FFT_SIZE = 1024;
			this.VAD_BAND_LOW = 120;
			this.VAD_BAND_HIGH = 3200;
			this.VAD_ENERGY_RATIO = 0.40;
		}
	}

	const activeModeParams = new STTParameters();
	const wakeWordParams = new STTParameters();
	wakeWordParams.MIN_SEG_SECONDS = 0.25;
	wakeWordParams.VAD_SILENCE_MS /= 2;
	wakeWordParams.POSTROLL_MS /= 2;

	let currentParameters = wakeWordParams;
	let activeMode = false;

	// state
	let asr = null;
	let rec = false;
	let buffers = [];
	let prerollBuffer = [];
	let ctx = null, src = null, proc = null, stream = null;
	let hp = null, lp = null, analyser = null;
	let zeroGain = null;
	let lastSpeechTS = 0;
	let processingSegment = false;
	let speechDetected = false;

	// ===== AUDIO GAP SANITY CHECK (built-in) =====
	let gapCheck = null; // { getStats, reset, uninstall }
	const GAP_CHECK_DEFAULTS = {
		enabled: true,       // set false if you want it off by default
		logThresholdMs: 80,  // log when callbacks delayed more than this
		warnThresholdMs: 250,
		printEveryN: 200
	};

	function installAudioGapSanityCheck(procNode, opts = {}) {
		if (!procNode) return null;

		const enabled = (opts.enabled ?? GAP_CHECK_DEFAULTS.enabled) === true;
		if (!enabled) return null;

		// If we already installed on this proc, don't double-wrap.
		if (procNode.__gapCheckInstalled) return procNode.__gapCheckHandle || null;

		const logThresholdMs  = Number.isFinite(opts.logThresholdMs) ? opts.logThresholdMs : GAP_CHECK_DEFAULTS.logThresholdMs;
		const warnThresholdMs = Number.isFinite(opts.warnThresholdMs) ? opts.warnThresholdMs : GAP_CHECK_DEFAULTS.warnThresholdMs;
		const printEveryN     = Number.isFinite(opts.printEveryN) ? opts.printEveryN : GAP_CHECK_DEFAULTS.printEveryN;

		const originalHandler = procNode.onaudioprocess;

		let lastTs = performance.now();
		let n = 0;
		let maxGap = 0;
		let sumGap = 0;
		let overLog = 0;
		let overWarn = 0;

		procNode.onaudioprocess = function wrappedOnAudioProcess(e) {
			const now = performance.now();
			const gap = now - lastTs;
			lastTs = now;

			n++;
			sumGap += gap;
			if (gap > maxGap) maxGap = gap;

			if (gap > logThresholdMs) {
				overLog++;
				if (gap > warnThresholdMs) overWarn++;
				console.log(
					`[AUDIO GAP] ${gap.toFixed(1)}ms` +
					(gap > warnThresholdMs ? " 🚨" : "")
				);
			}

			if (n % printEveryN === 0) {
				console.log(
					`[AUDIO GAP STATS] frames=${n} avg=${(sumGap / n).toFixed(2)}ms max=${maxGap.toFixed(1)}ms` +
					` | over>${logThresholdMs}ms=${overLog} over>${warnThresholdMs}ms=${overWarn}`
				);
			}

			if (typeof originalHandler === "function") return originalHandler.call(this, e);
		};

		const handle = {
			getStats() {
				return {
					frames: n,
					avgMs: n ? (sumGap / n) : 0,
					maxMs: maxGap,
					overLog,
					overWarn,
					logThresholdMs,
					warnThresholdMs
				};
			},
			reset() {
				lastTs = performance.now();
				n = 0; maxGap = 0; sumGap = 0; overLog = 0; overWarn = 0;
			},
			uninstall() {
				try { procNode.onaudioprocess = originalHandler; } catch {}
				try { delete procNode.__gapCheckInstalled; delete procNode.__gapCheckHandle; } catch {}
			}
		};

		procNode.__gapCheckInstalled = true;
		procNode.__gapCheckHandle = handle;

		return handle;
	}

	const status = (msg) => window.onSTTStatus?.(msg);

	//------
	function resample(data, from, to = currentParameters.SAMPLE_RATE) {
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

	const rms = (a) => {
		let s = 0;
		for (let i = 0; i < a.length; i++) s += a[i] * a[i];
		return Math.sqrt(s / (a.length || 1));
	};

	//------
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

	//------
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

	//------
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

	//------
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

	//------
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

	//------
	function safeDisconnect(node) {
		if (!node) return;
		try { node.disconnect(); } catch {}
	}

	//------
	function configureAudioGraph() {
		if (!ctx || !src || !proc) return;

		safeDisconnect(src);
		safeDisconnect(hp);
		safeDisconnect(lp);
		safeDisconnect(analyser);
		safeDisconnect(proc);
		safeDisconnect(zeroGain);

		hp = null;
		lp = null;
		analyser = null;
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

		if (currentParameters.ENABLE_ANALYSER_VAD) {
			analyser = ctx.createAnalyser();
			analyser.fftSize = currentParameters.ANALYSER_FFT_SIZE;
			upstream.connect(analyser);
		}

		upstream.connect(proc);

		zeroGain = ctx.createGain();
		zeroGain.gain.value = 0;
		proc.connect(zeroGain);
		zeroGain.connect(ctx.destination);
	}

	//------
	function setActiveMode(isOn) {
		activeMode = isOn;
		currentParameters = isOn ? activeModeParams : wakeWordParams;
		status(isOn ? "🎤 Listening for command..." : "Waiting for wake word...");

		if (rec && ctx && src && proc) {
			try { configureAudioGraph(); } catch {}
		}
	}

	//------
	function processSpeechText(newText, transcribeSeconds) {
		if (!window.IntentProcessor?.processSpeechText) {
			console.warn("IntentProcessor not loaded");
			return;
		}

		window.IntentProcessor.processSpeechText(newText, transcribeSeconds, {
			emitCommand: window.onVoiceCommand,
			setActiveMode,
			playSound,
			textAfterWord,
			containsWord,
			activeMode,
			CHAT_NAME
		});
	}

	//------
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

	//------
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
		buffers = [];
		prerollBuffer = [];
		speechDetected = false;
		lastSpeechTS = performance.now();

		ctx = new AudioContext();
		src = ctx.createMediaStreamSource(stream);
		proc = ctx.createScriptProcessor(4096, 1, 1);

		configureAudioGraph();
		status("Recording… waiting for wake word.");

		// Your original handler (unchanged)
		proc.onaudioprocess = (e) => {
			if (!rec) return;

			const ch = e.inputBuffer.getChannelData(0);
			const currentFrame = new Float32Array(ch);
			const currentRMS = rms(ch);
			const sampleRate = ctx.sampleRate;

			// analyser gating (if enabled)
			let analyserPass = true;
			if (currentParameters.ENABLE_ANALYSER_VAD && analyser) {
				try {
					const freqData = new Uint8Array(analyser.frequencyBinCount);
					analyser.getByteFrequencyData(freqData);

					let inBand = 0, total = 0;
					const binSize = sampleRate / analyser.fftSize;
					const lowBin = Math.max(0, Math.floor(currentParameters.VAD_BAND_LOW / binSize));
					const highBin = Math.min(freqData.length - 1, Math.ceil(currentParameters.VAD_BAND_HIGH / binSize));

					for (let i = 0; i < freqData.length; i++) {
						total += freqData[i];
						if (i >= lowBin && i <= highBin) inBand += freqData[i];
					}
					const ratio = total > 0 ? inBand / total : 0;
					analyserPass = ratio >= currentParameters.VAD_ENERGY_RATIO;
				} catch {
					analyserPass = true;
				}
			}

			// preroll
			if (!speechDetected) {
				const prerollSamples = Math.floor((currentParameters.PREROLL_MS / 1000) * sampleRate);
				prerollBuffer.push(currentFrame);

				let totalSamples = 0;
				for (const b of prerollBuffer) totalSamples += b.length;
				while (totalSamples > prerollSamples && prerollBuffer.length > 1) {
					const removed = prerollBuffer.shift();
					totalSamples -= removed.length;
				}

				if (currentRMS >= currentParameters.VAD_RMS && analyserPass) {
					speechDetected = true;
					buffers.push(...prerollBuffer);
					prerollBuffer = [];
				}
			} else {
				buffers.push(currentFrame);
			}

			// silence tracking
			if (currentRMS >= currentParameters.VAD_RMS) {
				lastSpeechTS = performance.now();
			} else {
				const silentFor = performance.now() - lastSpeechTS;
				if (speechDetected && !processingSegment && buffers.length &&
						silentFor > currentParameters.VAD_SILENCE_MS + currentParameters.POSTROLL_MS) {

					processingSegment = true;
					speechDetected = false;

					const localBuffers = buffers.slice();
					buffers = [];
					prerollBuffer = [];

					(async () => {
						try {
							let total = 0;
							for (const b of localBuffers) total += b.length;
							if (total === 0) return;

							const mono = new Float32Array(total);
							let off = 0;
							for (const b of localBuffers) { mono.set(b, off); off += b.length; }

							const pcm = resample(mono, sampleRate);
							const duration = pcm.length / currentParameters.SAMPLE_RATE;
							const energy = rms(pcm);

							if (duration >= currentParameters.MIN_SEG_SECONDS && energy >= currentParameters.MIN_RMS) {
								// leveling
								if (currentParameters.ENABLE_LEVELING && energy > 0) {
									let gain = currentParameters.TARGET_RMS / energy;
									if (gain > currentParameters.MAX_GAIN) gain = currentParameters.MAX_GAIN;

									for (let i = 0; i < pcm.length; i++) {
										let v = pcm[i] * gain;
										const av = Math.abs(v);
										if (av > currentParameters.COMP_THRESHOLD) {
											const sign = v < 0 ? -1 : 1;
											const over = av - currentParameters.COMP_THRESHOLD;
											v = sign * (currentParameters.COMP_THRESHOLD + over / currentParameters.COMP_RATIO);
										}
										pcm[i] = Math.max(-1, Math.min(1, v));
									}
								}

								const t0 = performance.now();
								const result = await asr(pcm, { prompt: currentParameters.commandPrompt, condition_on_prev_text: false });
								const t1 = performance.now();
								const transcribeSeconds = ((t1 - t0) / 1000).toFixed(2);

								const text = (result?.text || "").trim();
								if (text) {
									console.log("Transcribed:", text);
									const el = document.getElementById("chatLog");
									if (el) el.textContent = text + "\n" + el.textContent;
									processSpeechText(text, transcribeSeconds);
								}
							}
						} catch (err) {
							console.warn("segment processing error:", err);
						} finally {
							processingSegment = false;
						}
					})();
				}
			}
		};

		// Install the sanity check wrapper AFTER the handler is set
		// (This wraps proc.onaudioprocess, logs gaps, then calls your handler.)
		gapCheck = installAudioGapSanityCheck(proc, {
			enabled: window.STT?.GAP_CHECK_ENABLED ?? GAP_CHECK_DEFAULTS.enabled,
			logThresholdMs: window.STT?.GAP_CHECK_LOG_MS ?? GAP_CHECK_DEFAULTS.logThresholdMs,
			warnThresholdMs: window.STT?.GAP_CHECK_WARN_MS ?? GAP_CHECK_DEFAULTS.warnThresholdMs,
			printEveryN: window.STT?.GAP_CHECK_PRINT_EVERY ?? GAP_CHECK_DEFAULTS.printEveryN
		});

		// expose for console debugging
		if (gapCheck) window._gapCheck = gapCheck;
	}

	//------
	async function stop() {
		if (!rec) return;
		rec = false;

		// uninstall gap checker first (restores original handler)
		try { gapCheck && gapCheck.uninstall(); } catch {}
		gapCheck = null;

		try { proc && proc.disconnect(); } catch {}
		try { zeroGain && zeroGain.disconnect(); } catch {}
		try { analyser && analyser.disconnect(); } catch {}
		try { hp && hp.disconnect(); } catch {}
		try { lp && lp.disconnect(); } catch {}
		try { src && src.disconnect(); } catch {}

		try { stream && stream.getTracks().forEach(t => t.stop()); } catch {}
		try { ctx && await ctx.close(); } catch {}

		buffers = [];
		prerollBuffer = [];
		processingSegment = false;
		speechDetected = false;

		ctx = src = proc = stream = null;
		hp = lp = analyser = zeroGain = null;

		setActiveMode(false);
		status("Stopped.");
	}

	//------
	async function toggleMic() {
		if (rec) return stop();
		return start();
	}

	// Expose a tiny public API
	window.STT = {
		initializeSTT,
		toggleMic,
		start,
		stop,
		setActiveMode,

		// ===== gap-check controls (optional) =====
		GAP_CHECK_ENABLED: true,
		GAP_CHECK_LOG_MS: 200,
		GAP_CHECK_WARN_MS: 500,
		GAP_CHECK_PRINT_EVERY: 200,

		getAudioGapStats: () => (gapCheck ? gapCheck.getStats() : null),
		resetAudioGapStats: () => { try { gapCheck && gapCheck.reset(); } catch {} }
	};

	window.addEventListener("load", initializeSTT);
})();

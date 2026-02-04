// intentProcessor.js
(() => {
	"use strict";

	const VERSION = "intentProcessor.js v6 (Phase A: strip leading fillers)";
	const CHAT_NAME = "Zentra";

	// treat the aliases as equivalent to the canonical form
	const DEFAULT_ALIAS_RULES = [

		// wake word
		{ canonical: "zentra", aliases: ["zendron","zandron","zantron","dantro","et cetera", "et cetra", "etcetera", "etsetera", "etc","zentrum","center","center on","d'entra","centrum","sandra","santa","then try","is that true","cessar","zephyr"] },

		// devices
		{ canonical: "lamp", aliases: ["lamb"] },
		{ canonical: "light", aliases: ["lite","late","laid","like","life", "might"] },
		{ canonical: "lights", aliases: ["lites","lates","laids","likes","lifes", "mights", "lanes","my thoughts"] },// combine?
    	{ canonical: "living", aliases: ["leaving","looking"] },
		{ canonical: "close", aliases: ["closed"] },
		{ canonical: "fan on", aliases: ["fanon"] },
		{ canonical: "cans", aliases: ["cairns"] },
		{ canonical: "kitchen", aliases: ["kishan","cinch and"] },

		// states
		{ canonical: "off", aliases: ["cough"] },
		{ canonical: "on", aliases: ["honor"] },
		{ canonical: "test", aliases: ["task","taste","tastes"] },

		// light states
		{ canonical: "setColorTemperature", aliases: ["set color temperature"] },
		{ canonical: "setColorTemperature 2000", aliases: ["color reset"] },
		{ canonical: "setHue", aliases: ["set color"] },
		{ canonical: "setHue", aliases: ["color"] },
		{ canonical: "setLevel", aliases: ["set level"] },
		{ canonical: "setLevel", aliases: ["level"] },
		{ canonical: "setLevel", aliases: ["dim"] },
		{ canonical: "setLevel", aliases: ["brightness"] },

		// colors
		{ canonical: "0",   aliases: ["red"] },
		{ canonical: "5",   aliases: ["scarlet", "crimson"] },
		{ canonical: "10",  aliases: ["orange"] },
		{ canonical: "15",  aliases: ["amber"] },
		{ canonical: "20",  aliases: ["yellow"] },
		{ canonical: "25",  aliases: ["lime"] },
		{ canonical: "33",  aliases: ["green"] },
		{ canonical: "40",  aliases: ["mint"] },
		{ canonical: "50",  aliases: ["cyan", "aqua"] },
		{ canonical: "55",  aliases: ["teal"] },
		{ canonical: "60",  aliases: ["turquoise"] },
		{ canonical: "66",  aliases: ["blue"] },
		{ canonical: "70",  aliases: ["sky blue"] },
		{ canonical: "75",  aliases: ["purple"] },
		{ canonical: "78",  aliases: ["violet"] },
		{ canonical: "82",  aliases: ["indigo"] },
		{ canonical: "85",  aliases: ["magenta"] },
		{ canonical: "90",  aliases: ["pink"] },
		{ canonical: "95",  aliases: ["rose"] },
		{ canonical: "98",  aliases: ["hot pink"] },
	];



	//------
	function normalizeText(input) {
		const s = (input ?? "").toString();
		let t = s.normalize("NFKC");

		t = t
			.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
			.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
			.replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-");

		t = t.toLowerCase();
		t = t.replace(/[^a-z0-9\s]+/g, " ");
		t = t.replace(/\s+/g, " ").trim();
		return t;
	}

	//------
	function replaceWholeWord(sourceText, oldWord, newWord) {
		const pattern = new RegExp(`\\b${escapeRegex(oldWord)}\\b`, 'g');
		return sourceText.replace(pattern, newWord);
	}

	//------
	function escapeRegex(s) {
		return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	//------
	function applyFusionRemap(normalizedText, rules = DEFAULT_ALIAS_RULES) {
		let text = (normalizedText ?? "").toString();

		const pairs = [];
		for (const r of rules) {
			const canonical = (r.canonical ?? "").trim();
			if (!canonical) continue;
			for (const a of (r.aliases ?? [])) {
				const alias = (a ?? "").trim();
				if (!alias) continue;
				pairs.push({ alias, canonical });
			}
		}
		pairs.sort((a, b) => b.alias.length - a.alias.length);

		for (const { alias, canonical } of pairs) {
			const tokens = alias.split(/\s+/).filter(Boolean).map(escapeRegex);
			if (!tokens.length) continue;

			const pattern =
				"\\b" +
				tokens[0] +
				"\\b" +
				(tokens.length > 1
					? tokens.slice(1).map(t => "\\s+\\b" + t + "\\b").join("")
					: "");

			const re = new RegExp(pattern, "g");
			text = text.replace(re, canonical);
		}

		return text.replace(/\s+/g, " ").trim();
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
	function playWakeSound() {
		playSound(720, 200, 0.18);
	}

	//------
	function playAcceptCommandSound() {
		playSound(500, 180, 0.16);
	}

	//------
	function playRejectCommandSound() {
		playSound(250, 250, 0.15);
	}

	//------
	function processSpeechText(newText, transcribeSeconds, callbacks) {
		if (!newText) return;

		const rawTrimmed = newText.trim();

		const isSoundTag =
			(rawTrimmed.startsWith("(") && rawTrimmed.endsWith(")")) ||
			(rawTrimmed.startsWith("[") && rawTrimmed.endsWith("]"));
		if (isSoundTag) return;

		const normalized = normalizeText(rawTrimmed);
		const fusedText = applyFusionRemap(normalized);

		const { emitCommand, setActiveMode, textAfterWord, containsWord, activeMode, CHAT_NAME } = callbacks;

		let after = textAfterWord(fusedText, CHAT_NAME);
		if (after !== null && after.length > 0) {
			// Tokenize once and reuse
			let slots = null;
			try {
				if (window.Tokenizer && typeof window.Tokenizer.tokenizeCommand === "function") {
					slots = window.Tokenizer.tokenizeCommand(after);
				}
			} catch {}
			const willRoute = !!(slots && slots.state && slots.device);


			// TEMP:
			// after = "test light setHue 66";

			emitCommand?.(after, {
				source: "wake+command",
				rawText: rawTrimmed,
				normalizedText: normalized,
				fusedText,
				transcribeSeconds,
				slots
			});

			// play success sound if routed, rejection if not
			if (willRoute) {
				playAcceptCommandSound();
			} else {
				playRejectCommandSound();
			}

			setActiveMode(false);
			return;
		}

		if (!activeMode && containsWord(fusedText, CHAT_NAME)) {
			// play "wake" sound
			playWakeSound();
			setActiveMode(true);
			return;
		}

		if (activeMode) {
			// Tokenize once and reuse
			let slots = null;
			try {
				if (window.Tokenizer && typeof window.Tokenizer.tokenizeCommand === "function") {
					slots = window.Tokenizer.tokenizeCommand(fusedText);
				}
			} catch {}
			const willRoute = !!(slots && slots.state && slots.device);

			emitCommand?.(fusedText, {
				source: "active",
				rawText: rawTrimmed,
				normalizedText: normalized,
				fusedText,
				transcribeSeconds,
				slots
			});
			
			// play success sound if routed, rejection if not
			if (willRoute) {
				playAcceptCommandSound();
			} else {
				playRejectCommandSound();
			}
			
			setActiveMode(false);
			return;
		}
	}

	//------
	function route(text, precomputedSlots = null) {
		// If slots already computed, reuse them
		if (precomputedSlots && precomputedSlots.state && precomputedSlots.device) {
			return { intent: "device_set", slots: precomputedSlots };
		}

		// Phase A applied here: normalize -> strip fillers -> tokenize
		// const cleaned = stripFillers(normalizeText(text));
    	// const cleaned = normalizeText(text);
		const cleaned = applyFusionRemap(normalizeText(text));


		if (!window.Tokenizer || typeof window.Tokenizer.tokenizeCommand !== "function") {
			throw new Error("Tokenizer.tokenizeCommand is missing");
		}

		const slots = window.Tokenizer.tokenizeCommand(cleaned);
		if (!slots) return null;

		if (!slots.state || !slots.device) return null;

		return { intent: "device_set", slots };
	}

	//------
	function resolveDeviceIdFromSlots(slots, hub) {
		const registry = hub.getRegistry?.();
		if (!registry || !registry.byId) throw new Error("No device registry loaded (click Sync Devices)");

		const deviceLabel = slots.device;
		const hits = [];

		for (const id of Object.keys(registry.byId)) {
			const d = registry.byId[id];
			if (d && d.label === deviceLabel) hits.push(String(id));
		}

		if (hits.length === 1) return hits[0];
		if (hits.length === 0) throw new Error(`No device matched: "${deviceLabel}"`);
		throw new Error(`Ambiguous device match for: "${deviceLabel}" (${hits.length} matches)`);
	}

	//------
	async function execute(routed, ctx) {
		if (!routed) throw new Error("No routed intent");
		if (!ctx || !ctx.hubitat) throw new Error("Missing ctx.hubitat");

		const hub = ctx.hubitat;

		if (routed.intent !== "device_set") throw new Error("Unknown intent: " + routed.intent);

		const slots = routed.slots;
		if (!slots || !slots.device || !slots.state) {
			throw new Error("Missing slots (device/state)");
		}

		const deviceId = resolveDeviceIdFromSlots(slots, hub);
		
		// If stateParam exists, pass it as the secondary parameter to sendCommand
		if (slots.stateParam) {
			return hub.sendCommand(deviceId, slots.state, slots.stateParam);
		} else {
			return hub.sendCommand(deviceId, slots.state);
		}
	}

	//------
	async function handle(text, ctx) {
		const routed = route(text);
		if (!routed) return { routed: null, executed: false };
		await execute(routed, ctx);
		return { routed, executed: true };
	}

	window.Intent = {
		VERSION,
		CHAT_NAME,
		normalizeText,
		applyFusionRemap,
		DEFAULT_ALIAS_RULES,
		processSpeechText,
		route,
		execute,
		handle,
		playSound
	};

	window.IntentProcessor = {
		normalizeText,
		applyFusionRemap,
		DEFAULT_ALIAS_RULES,
		processSpeechText,
		replaceWholeWord,
		CHAT_NAME
	};

	console.log("[Intent] loaded:", VERSION);
})();

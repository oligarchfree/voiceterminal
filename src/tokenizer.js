// tokenizer.js
(() => {
	"use strict";

	// States that require an additional parameter (e.g. setLevel 50, setHue 66)
	const STATES_WITH_PARAMS = [
		"setLevel",
		"setHue",
		"setSaturation",
		"setColorTemperature",
		"setSpeed",
	];

	// is this necessary?
	let VALID_DEVICES = new Set(["light", "fan", "switch", "dimmer", "rgb_light"]);
	
	let deviceLabels = []; // Store sorted by length (longest first) for greedy matching
	let deviceStates = {}; // Maps device label -> array of valid states
	let deviceTypes = {}; // Maps device label -> device type

	//------
	function updateValidDevices(labels, statesMap = null, typesMap = null) {
		VALID_DEVICES = new Set(labels);
		// Sort by length descending for greedy matching
		deviceLabels = Array.from(labels).sort((a, b) => b.length - a.length);
		
		// Use provided states map or initialize default states (on/off) for each device
		if (statesMap) {
			deviceStates = { ...statesMap };
		} else {
			deviceStates = {};
			for (const label of labels) {
				deviceStates[label] = ["on", "off"];
			}
		}

		// Store device types
		if (typesMap) {
			deviceTypes = { ...typesMap };
		}

		console.log(statesMap)
	}	
	//------
	function normSpace(s) {
		return String(s || "").replace(/\s+/g, " ").trim();
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
	function tokenizeCommand(fusedText) {
		let text = normSpace(fusedText);
		if (!text) return null;

		// Find device by searching for complete device names (longest first)
		// Use fuzzy matching with levenshtein distance
		let device = null;
		let bestMatch = null;
		let bestDistance = Infinity;

		for (const deviceName of deviceLabels) {
			// Check if device name exists as complete phrase in text (exact match)
			if (text.includes(deviceName)) {
				device = deviceName;
				break;
			}

			// Fuzzy match: extract words from text and compare to device name
			const words = text.split(/\s+/);
			for (let i = 0; i < words.length; i++) {
				// Try matching device name starting at each word position
				const numDeviceWords = deviceName.split(/\s+/).length;
				const candidate = words.slice(i, i + numDeviceWords).join(' ');
				
				if (candidate && candidate.length > 0) {
					const distance = levenshtein(deviceName, candidate);
					const maxAllowedDistance = Math.min(2, Math.floor(deviceName.length * 0.15)); // max 2 or 15% of length
					
					// Only accept if distance is reasonable AND candidate length is similar
					const lengthDiff = Math.abs(deviceName.length - candidate.length);
					
					if (distance <= maxAllowedDistance && lengthDiff <= 2 && distance < bestDistance) {
						bestMatch = deviceName;
						bestDistance = distance;
					}
				}
			}
		}

		// Use fuzzy match if no exact match found, but only if it's a good match
		if (!device && bestMatch && bestDistance <= 2) {
			device = bestMatch;
			console.log(bestMatch, "deviceName fuzzy matched (distance:", bestDistance + ")");
		}

		if (!device) return null;

		// If contact sensor, replace on/off with open/close
		const deviceType = deviceTypes[device];
		if (deviceType === "contact_sensor") {
			if (window.IntentProcessor && window.IntentProcessor.replaceWholeWord) {
				text = window.IntentProcessor.replaceWholeWord(text, "on", "open");
				text = window.IntentProcessor.replaceWholeWord(text, "off", "close");
			}
		}


		// Find state as a complete word (word boundary) using device-specific valid states
		const validStates = deviceStates[device] || [];
		let state = null;
		let stateParam = null;

		for (const s of validStates) {
			const regex = new RegExp(`\\b${s}\\b`, 'i');
			const match = regex.exec(text);
			if (match) {
				state = s;

				// If this state requires a parameter, grab the next alphanumeric block
				if (STATES_WITH_PARAMS.includes(s)) {
					const afterState = text.slice(match.index + s.length);
					const paramMatch = afterState.match(/^\s+([a-z0-9]+)/i);
					if (paramMatch) {
						stateParam = paramMatch[1];
					}
				}
				break;
			}
		}

		if (!state) return null;


		console.log(`[Tokenizer] device: "${device}", state: "${state}"` + (stateParam ? `, stateParam: "${stateParam}"` : ""));
		return { device, state, stateParam };
	}

	window.Tokenizer = {
		tokenizeCommand,
		updateValidDevices
	};

	console.log("[Tokenizer] loaded");
})();

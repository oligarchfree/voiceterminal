// serviceManager.js
(() => {
	"use strict";

	//------
	function parseTimerDuration(stateParam) {
		if (!stateParam) return null;

		let totalMs = 0;
		const pattern = /(\d+)\s*(seconds?|minutes?)/gi;
		let match;

		while ((match = pattern.exec(stateParam)) !== null) {
			const value = parseInt(match[1], 10);
			const unit = match[2].toLowerCase();

			if (unit.startsWith("minute")) {
				totalMs += value * 60000;
			} else {
				totalMs += value * 1000;
			}
		}

		// If no unit found, try parsing as plain number (assume seconds)
		if (totalMs === 0) {
			const plainNum = parseInt(stateParam, 10);
			if (plainNum > 0) {
				totalMs = plainNum * 1000;
			}
		}

		return totalMs > 0 ? totalMs : null;
	}

	//------
	async function execute(target, state, stateParam) {
		console.log(`[ServiceManager] execute: target="${target}", state="${state}", stateParam="${stateParam}"`);

		if (target === "timer") {
			if (state === "start") {
				const ms = parseTimerDuration(stateParam) || window.TimerService?.getDefaultDuration?.() || 60000;
				window.TimerService?.startTimer(ms);
				return { success: true };
			}
			if (state === "stop") {
				window.TimerService?.stopTimer();
				return { success: true };
			}
		}

		throw new Error(`Unknown service or state: ${target} / ${state}`);
	}

	window.ServiceManager = {
		execute
	};

	console.log("[ServiceManager] loaded");
})();

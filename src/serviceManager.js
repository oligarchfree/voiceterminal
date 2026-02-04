// serviceManager.js
(() => {
	"use strict";

	//------
	function parseTimerDuration(stateParam) {
		if (!stateParam) return null;

		const match = stateParam.match(/^(\d+)\s*(seconds?|minutes?)?$/i);
		if (!match) return null;

		const value = parseInt(match[1], 10);
		const unit = (match[2] || "seconds").toLowerCase();

		if (unit.startsWith("minute")) {
			return value * 60000;
		}
		return value * 1000;
	}

	//------
	async function execute(target, state, stateParam) {
		console.log(`[ServiceManager] execute: target="${target}", state="${state}", stateParam="${stateParam}"`);

		if (target === "timer") {
			if (state === "start") {
				const ms = parseTimerDuration(stateParam) || window.TimerService?.DEFAULT_DURATION_MS || 60000;
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

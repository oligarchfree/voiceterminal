// serviceManager.js
(() => {
	"use strict";

	//------
	async function execute(target, state, stateParam) {
		console.log(`[ServiceManager] execute: target="${target}", state="${state}", stateParam="${stateParam}"`);

		if (target === "timer") {
			if (state === "start") {
				// stateParam is in seconds, convert to ms
				const seconds = parseInt(stateParam, 10);
				const ms = seconds ? seconds * 1000 : (window.TimerService?.DEFAULT_DURATION_MS || 60000);
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

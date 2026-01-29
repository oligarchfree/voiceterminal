// timerService.js
(() => {
	"use strict";

	let timerId = null;
	let countdownId = null;
	let remainingMs = 0;

	//------
	function updateCountdownDisplay() {
		const el = document.getElementById("timerCountdown");
		if (el) {
			if (remainingMs > 0) {
				const secs = (remainingMs / 1000).toFixed(1);
				el.textContent = `${secs}s remaining`;
			} else {
				el.textContent = "";
			}
		}
	}

	//------
	function startTimer(numMilliseconds) {
		console.log(`[TimerService] startTimer called with ${numMilliseconds}ms`);
		
		// Clear any existing timer
		if (timerId) clearTimeout(timerId);
		if (countdownId) clearInterval(countdownId);

		remainingMs = numMilliseconds;
		updateCountdownDisplay();

		// Countdown interval (updates every 100ms)
		countdownId = setInterval(() => {
			remainingMs -= 100;
			if (remainingMs < 0) remainingMs = 0;
			updateCountdownDisplay();
		}, 100);

		// Main timer
		timerId = setTimeout(() => {
			console.log(`[TimerService] timer expired after ${numMilliseconds}ms`);
			clearInterval(countdownId);
			countdownId = null;
			timerId = null;
			remainingMs = 0;
			updateCountdownDisplay();
			window.Intent?.playSound?.(880, 500, 0.2);
		}, numMilliseconds);
	}

	//------
	function stopTimer() {
		console.log(`[TimerService] stopTimer called`);
		if (timerId) clearTimeout(timerId);
		if (countdownId) clearInterval(countdownId);
		timerId = null;
		countdownId = null;
		remainingMs = 0;
		updateCountdownDisplay();
	}

	window.TimerService = {
		startTimer,
		stopTimer
	};

	console.log("[TimerService] loaded");
})();

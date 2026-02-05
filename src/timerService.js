// timerService.js
(() => {
	"use strict";

	const MAX_PLAYS = 5;
	const INITIAL_DEFAULT_MS = 5000; // 5 seconds initial default

	let lastDurationMs = INITIAL_DEFAULT_MS;
	let timerId = null;
	let countdownId = null;
	let alarmId = null;
	let remainingMs = 0;

	//------
	function getDefaultDuration() {
		return lastDurationMs;
	}

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
	function playTimeOutSound() {
		// Play tone immediately, then repeat every 1 second (max MAX_PLAYS times)
		let playCount = 1;
		window.Intent?.playSound?.(880, 500, 0.2);
		alarmId = setInterval(() => {
			playCount++;
			window.Intent?.playSound?.(880, 500, 0.2);
			if (playCount >= MAX_PLAYS) {
				clearInterval(alarmId);
				alarmId = null;
			}
		}, 1000);
	}

	//------
	function startTimer(numMilliseconds) {
		console.log(`[TimerService] startTimer called with ${numMilliseconds}ms`);

		// Update last duration for future defaults
		lastDurationMs = numMilliseconds;
		
		// Clear any existing timer
		if (timerId) clearTimeout(timerId);
		if (countdownId) clearInterval(countdownId);
		if (alarmId) clearInterval(alarmId);

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

			playTimeOutSound();
		}, numMilliseconds);
	}

	//------
	function stopTimer() {
		console.log(`[TimerService] stopTimer called`);
		if (timerId) clearTimeout(timerId);
		if (countdownId) clearInterval(countdownId);
		if (alarmId) clearInterval(alarmId);
		timerId = null;
		countdownId = null;
		alarmId = null;
		remainingMs = 0;
		updateCountdownDisplay();
	}

	//------
	function isPlayingTimeOutSound() {
		return alarmId !== null;
	}

	window.TimerService = {
		startTimer,
		stopTimer,
		isPlayingTimeOutSound,
		getDefaultDuration
	};

	console.log("[TimerService] loaded");
})();

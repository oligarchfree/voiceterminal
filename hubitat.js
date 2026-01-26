// hubitat.js
(() => {
	"use strict";

	// Browser talks ONLY to the local proxy; no secrets here.
	const HUBITAT_PROXY_BASE = "/hubitat";

	const DEVICE_REGISTRY_KEY = "hubitat_device_registry_v1";
	const SELECTED_DEVICE_KEY = "hubitat_selected_device_id";


	//------
	function makerUrl(path) {
		const cleaned = path.startsWith("/") ? path.slice(1) : path;
		return `${HUBITAT_PROXY_BASE}/${cleaned}`;
	}

	//------
	async function fetchJson(path) {
		const url = makerUrl(path);
		const res = await fetch(url, { method: "GET" });
		if (!res.ok) throw new Error(`Hubitat proxy failed: ${res.status} ${res.statusText}`);
		return res.json();
	}

	//------
	async function fetchText(path) {
		const url = makerUrl(path);
		const res = await fetch(url, { method: "GET" });
		const body = await res.text();
		if (!res.ok) throw new Error(`Hubitat proxy failed: ${res.status} ${res.statusText} — ${body}`);
		return { res, body };
	}

	//------
	async function fetchDevices() {
		return fetchJson("/devices/all");
	}

	//------
	function classifyDevice(device) {
		const capsRaw = device.capabilities || [];
		const caps = capsRaw.map(c => (typeof c === "string" ? c : c?.name)).filter(Boolean);

		if (caps.includes("Switch")) return "switch";
		if (caps.includes("SwitchLevel")) return "dimmer";
		if (caps.includes("FanControl")) return "fan";
		if (caps.includes("ColorControl")) return "rgb_light";
		if (caps.includes("ContactSensor")) return "contact_sensor";
		return null;
	}

	//------
	function getRegistry() {
		const raw = localStorage.getItem(DEVICE_REGISTRY_KEY);
		return raw ? JSON.parse(raw) : null;
	}

	//------
	function getSelectedDeviceId() {
		return localStorage.getItem(SELECTED_DEVICE_KEY) || "";
	}

	//------
	function setSelectedDeviceId(id) {
		localStorage.setItem(SELECTED_DEVICE_KEY, String(id || ""));
	}

	//------
	async function syncDevices() {
		const devices = await fetchDevices();
		const registry = { byId: {}, byAlias: {} };

		for (const d of devices) {
		const type = classifyDevice(d);
		if (!type) continue;

		const id = String(d.id);

		// TODO: dont normalize anything...just normalize when we COMPARE in our tokenizer
		const label = (d.label || d.name || "").toLowerCase().trim();
		const aliases = new Set();
		if (label) aliases.add(label);			if (type === "switch" || type === "dimmer" || type === "rgb_light") aliases.add("light");
			if (type === "fan") aliases.add("fan");

			// Poll device for valid commands/states
			let states = [];
		try {
			const deviceDetail = await fetchJson(`/devices/${id}`);
			const commands = deviceDetail.commands || [];
			states = commands
				.map(cmd => typeof cmd === 'string' ? cmd : (cmd?.name ? cmd.name : null))
				.filter(Boolean);
		} catch (e) {
			console.warn(`Failed to fetch commands for device ${id}:`, e);
		}			registry.byId[id] = {
				id,
				label,
				type,
				commands: d.commands || [],
				aliases: Array.from(aliases),
				states,
			};

			for (const a of aliases) {
				if (!registry.byAlias[a]) registry.byAlias[a] = id;
			}
		}

		localStorage.setItem(DEVICE_REGISTRY_KEY, JSON.stringify(registry));

		const sel = getSelectedDeviceId();
		if (sel && !registry.byId[sel]) {
			setSelectedDeviceId(Object.keys(registry.byId)[0] || "");
		} else if (!sel) {
			setSelectedDeviceId(Object.keys(registry.byId)[0] || "");
		}

		// Update Tokenizer's VALID_DEVICES with device labels and states
		if (window.Tokenizer && window.Tokenizer.updateValidDevices) {
			const deviceLabels = new Set();
			const deviceStatesMap = {};
			const deviceTypesMap = {};
			for (const id of Object.keys(registry.byId)) {
				const device = registry.byId[id];
				if (device.label) {
					deviceLabels.add(device.label);
					deviceStatesMap[device.label] = device.states || [];
					deviceTypesMap[device.label] = device.type;
				}
			}
			window.Tokenizer.updateValidDevices(deviceLabels, deviceStatesMap, deviceTypesMap);
		}

		// Output complete list of devices with allowable states
		console.log("=== DEVICE REGISTRY ===");
		for (const id of Object.keys(registry.byId)) {
			const device = registry.byId[id];
			console.log(`Device: "${device.label}" (${device.type}) [ID: ${id}]`);
			console.log(`  States: ${device.states.join(", ") || "(none)"}`);
		}
		console.log("======================");


		return registry;
	}

	//------
	function populateDeviceDropdown(selectEl) {
		const registry = getRegistry();

		selectEl.innerHTML = "";

		if (!registry || !registry.byId || Object.keys(registry.byId).length === 0) {
			const opt = document.createElement("option");
			opt.value = "";
			opt.textContent = "No registry loaded (click Sync Devices)";
			selectEl.appendChild(opt);
			selectEl.disabled = true;
			return;
		}

		const items = Object.values(registry.byId)
			.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));

		selectEl.disabled = false;

		for (const d of items) {
			const opt = document.createElement("option");
			opt.value = d.id;
			opt.textContent = `${d.label || "(no label)"}  —  ${d.type}  [id:${d.id}]`;
			selectEl.appendChild(opt);
		}

		const last = getSelectedDeviceId();
		if (last && registry.byId[last]) selectEl.value = last;

		selectEl.onchange = () => setSelectedDeviceId(selectEl.value);
	}

	//------
	async function sendCommand(deviceId, command, secondary) {
		if (!deviceId) throw new Error("No device selected");
		const sec = (secondary !== undefined && secondary !== null) ? `/${encodeURIComponent(String(secondary))}` : "";
		const path = `/devices/${encodeURIComponent(String(deviceId))}/${encodeURIComponent(String(command))}${sec}`;
		return fetchText(path);
	}

	window.Hubitat = {
		syncDevices,
		getRegistry,
		getSelectedDeviceId,
		setSelectedDeviceId,
		populateDeviceDropdown,
		sendCommand,
		makerUrl, // handy for debugging
	};
})();

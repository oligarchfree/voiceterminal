const express = require("express");
const https = require("https");
const fs = require("fs");

const app = express();

//------
class HubitatConfig {
	constructor(name, host, appId, token) {
		this.name = name;
		this.host = host;
		this.appId = appId;
		this.token = token;
	}
}

//------
const locations = {

	// AI hub IP:
	postOak: new HubitatConfig(
		"Post Oak",
		"http://192.168.68.63",
		"7",
		"769f39e5-b7d6-4282-a3e5-3fb480c4f9f5"
	),

	// AI hub IP: 192.168.68.54
	daniel: new HubitatConfig(
		"Daniel",
		"http://192.168.68.67",
		"8",
		"ef0296b7-4160-4a29-806f-37899abe22ad"
	)
};

//------
let currentLocation = null;

//------
async function detectLocation() {
	for (const [key, config] of Object.entries(locations)) {
		try {
			const url = `${config.host}/apps/api/${config.appId}/devices?access_token=${encodeURIComponent(config.token)}`;
			const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
			if (res.ok) {
				console.log(`✅ Auto-detected location: ${config.name}`);
				return config;
			}
		} catch {}
	}
	console.log("⚠️ No hub responded, defaulting to daniel");
	return locations.daniel;
}

// Serve your static files from src directory
app.use(express.static("src"));

// Simple proxy: browser calls /hubitat/<anything>, server forwards to Hubitat Maker API
app.get(/^\/hubitat\/(.*)/, async (req, res) => {
	try {
		const path = req.params[0] || ""; // everything after /hubitat/
		const url =
			`${currentLocation.host}/apps/api/${currentLocation.appId}/${path}` +
			`?access_token=${encodeURIComponent(currentLocation.token)}`;

		const r = await fetch(url);
		const body = await r.text();

		res.status(r.status);
		res.set("Content-Type", r.headers.get("content-type") || "text/plain");
		res.send(body);
	} catch (e) {
		res.status(500).send(String(e));
	}
});

const options = {
	key: fs.readFileSync('server.key'),
	cert: fs.readFileSync('server.cert')
};

//------
async function startServer() {
	currentLocation = await detectLocation();
	
	https.createServer(options, app).listen(8787, '0.0.0.0', () => {
		console.log("POC server running on https://0.0.0.0:8787");
		console.log(`Using location: ${currentLocation.name}`);
		console.log("Access from other devices using your local IP address");
	});
}

startServer();

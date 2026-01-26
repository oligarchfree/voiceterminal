const express = require("express");
const https = require("https");
const fs = require("fs");

const app = express();

/*
// ====== POST OAK CONFIG ======
	const HUBITAT_HOST = "http://192.168.68.63"; // <-- your hub IP
	const MAKER_APP_ID = "7";                 // <-- Maker API App ID
	const ACCESS_TOKEN = "769f39e5-b7d6-4282-a3e5-3fb480c4f9f5";    // <-- Maker API token
// ====================
*/




// ====== DANIEL CONFIG ======
	const HUBITAT_HOST = "http://192.168.68.67"; // <-- your hub IP
	const MAKER_APP_ID = "8";                 // <-- Maker API App ID
	const ACCESS_TOKEN = "ef0296b7-4160-4a29-806f-37899abe22ad";    // <-- Maker API token
// ====================

// Serve your static files (index.html)
app.use(express.static("."));

// Simple proxy: browser calls /hubitat/<anything>, server forwards to Hubitat Maker API
app.get(/^\/hubitat\/(.*)/, async (req, res) => {
	try {
		const path = req.params[0] || ""; // everything after /hubitat/
		const url =
			`${HUBITAT_HOST}/apps/api/${MAKER_APP_ID}/${path}` +
			`?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;

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

https.createServer(options, app).listen(8787, '0.0.0.0', () => {
	console.log("POC server running on https://0.0.0.0:8787");
	console.log("Access from other devices using your local IP address");
	console.log("Note: You'll need to accept the self-signed certificate warning in your browser");
});

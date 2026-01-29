---
description: AI rules derived by SpecStory from the project AI interaction history
globs: *
---

## PROJECT OVERVIEW

First thing you do on startup is read ai-instructions.txt. THEN review all js / html files for context, and provide a BRIEF synopsis of what they do. The synopsis should include:
- Project name and brief description.
- Core files and their functions.
- Pipeline description.

The project is named `voiceterminal`: A local, browser-based voice controller that transcribes microphone audio (Whisper in-browser), detects a wake word (“Zentra”), routes the command into an intent, and executes Hubitat Maker API device commands through a local Node HTTPS proxy (to avoid CORS and keep the Hubitat token off the browser).

Core files:
- `index.html`: Simple browser UI with Hubitat device dropdown, STT controls, and voice log. Defines `window.onVoiceCommand(text, meta)` which calls `window.Intent.route()` then `window.Intent.execute()` using Hubitat context.
- `server.js`: Local HTTPS Express server that serves static files and proxies `GET /hubitat/<path>` requests to the Hubitat API. Auto-detects Hubitat hub.
- `hubitat.js`: Browser-side Hubitat client that interacts with the local proxy to sync devices, build a registry in `localStorage`, update the tokenizer, and send commands.
- `intentProcessor.js`: Intent routing + execution. Plays feedback sounds.
- `tokenizer.js`: Extracts `{ device, state, stateParam }` from text.
  - Uses a greedy device-label match (longest first) plus light fuzzy matching (Levenshtein).
  - Picks `state` from the device’s allowed command list (populated by `hubitat.js`).
  - Special-cases contact sensors by mapping spoken `on/off` to `open/close`.
  - Tokenizes the following whole "alphanumeric block of text" as the "state parameter" token, when a valid state for a device requires an additional parameter.
- `stt.js`: Main-thread speech-to-text orchestration:
  - Manages microphone, AudioContext graph, and a segment queue.
  - Receives audio segments from the AudioWorklet and runs Whisper ASR on them.
  - Calls `IntentProcessor.processSpeechText(...)`, which ultimately emits `window.onVoiceCommand(...)` when a command should execute.
- `audio-processor.js`: AudioWorkletProcessor that performs VAD + segmentation:
  - Maintains preroll/postroll buffers and sends finalized speech segments back to the main thread via transferable ArrayBuffer.

Pipeline (end-to-end):
1. Microphone audio captured in browser
2. `audio-processor.js` (AudioWorklet) does VAD + segmentation → sends speech segments to main thread
3. `stt.js` resamples/levels audio → Whisper transcribes to text
4. `intentProcessor.js` runs phases in order: **Normalize → Fusion Remap → Wake Word Detection → Tokenization → Intent Resolution → Execution**
5. Execution uses `hubitat.js` → calls local proxy `server.js` → forwards to Hubitat Maker API command endpoint

## CODE STYLE

1.) Minimalistic. 
2.) Easy to read and understand. 
3.) Prioritize clarity and simplicity.
4.) Above EVERY function, add "//------" for visual delineation
5.) ALWAYS do leading indents with TABS (not spaces)

## FOLDER ORGANIZATION

All HTML and JS files are located in the `src` directory.

## TECH STACK

(Currently no specific tech stack rules defined)

## PROJECT-SPECIFIC STANDARDS

1. **No unsolicited suggestions** - Only respond to direct requests.
2. **Brevity** - Keep responses as concise as possible.
3. **No large-scale refactoring when uncertain** - Stop and ask for direction instead of guessing with big code changes.
4. **Request clarity** - Request clarification when instructions are unclear.
5. **Normalization Consistency** - From now on, use "normalizeText" function instead of any others for normalization, except in `hubitat.js` where the norm function has been removed.
6. **Intent Map Phases** - Follow the Intent Map phases in strict order: Normalize -> Fusion Remap -> Wake Word Detection -> Tokenization -> Intent Resolution -> Execution. Do not merge or reorder them.
7. **Hubitat "refresh" Command** - The "refresh" command is a Hubitat device command that polls/queries the device for its current state and updates Hubitat's attributes/events. It does not change the device's state but re-syncs Hubitat. The functionality depends on the specific device + driver (Z-Wave/Zigbee, LAN/cloud).
8. **Tokenizer Logging** - The tokenizer should print out each token by slot (device: "kitchen light", state: "on", etc.) whenever a command is tokenized.
9. **State Parameters in Tokenizer** - The `tokenizer.js` will now identify and tokenize state parameters. When the tokenizer recognizes a valid state for a device that requires an additional parameter (e.g., setLevel, setHue), it will tokenize the following whole "alphanumeric block of text" as the "state parameter" token. The `tokenizeCommand` function now returns `{ device, state, stateParam }`.
10. **STATES_WITH_PARAMS Array** - The `tokenizer.js` contains a `STATES_WITH_PARAMS` array that defines which states require additional parameters. This array includes, but is not limited to: `setLevel`, `setHue`, `setSaturation`, `setColorTemperature`, `setSpeed`. When a `stateParam` is extracted by the tokenizer, the `execute` function in `intentProcessor.js` passes it to `hub.sendCommand(deviceId, state, stateParam)`.

## WORKFLOW & RELEASE RULES

First thing you do on startup is read ai-instructions.txt

## REFERENCE EXAMPLES

(Currently no reference examples defined)

## PROJECT DOCUMENTATION & CONTEXT SYSTEM

First thing you do on startup is read ai-instructions.txt

## DEBUGGING

(Currently no specific debugging rules defined)

## FINAL DOs AND DON'Ts

1.  **Do not create additional files** unless explicitly instructed.
2.  If `server.js` static path reverts to `"."` instead of `"src"`, immediately correct it back to `"src"`. Investigate possible causes of the reversion, such as formatters or save actions.
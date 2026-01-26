---
description: AI rules derived by SpecStory from the project AI interaction history
globs: *
---

## PROJECT OVERVIEW

First thing you do on startup is read ai-instructions.txt. THEN review all js / html files for context, and provide a BRIEF synopsis of what they do

## CODE STYLE

1.) Minimalistic. 
2.) Easy to read and understand. 
3.) Prioritize clarity and simplicity.
4.) Above EVERY function, add "//------" for visual delineation
5.) ALWAYS do leading indents with TABS (not spaces)

## FOLDER ORGANIZATION

(Currently no specific folder organization rules defined)

## TECH STACK

(Currently no specific tech stack rules defined)

## PROJECT-SPECIFIC STANDARDS

1. **No unsolicited suggestions** - Only respond to direct requests.
2. **Brevity** - Keep responses as concise as possible.
3. **No large-scale refactoring when uncertain** - Stop and ask for direction instead of guessing with big code changes.
4. **Request clarity** - Request clarification when instructions are unclear.
5. **Normalization Consistency** - From now on, use "normalizeText" function instead of any others for normalization, except in `hubitat.js` where the norm function has been removed.
6. **Intent Map Phases** - Follow the Intent Map phases in strict order: Normalize -> Fusion Remap -> Wake Word Detection -> Tokenization -> Intent Resolution -> Execution. Do not merge or reorder them.

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
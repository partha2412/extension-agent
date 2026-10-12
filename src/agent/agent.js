// src/agent/agent.js

import {
  sendToTab,
  navigate,
  pressKey,
  openTab,
  switchTab,
  listTabs,
  getTab,
  closeTab,
} from "../utils/browser";

import { callLocalModel } from "../utils/localModel";

import { system_prompt } from "../utils/prompt";

const MAX_STEPS = 25;
const MAX_BAD_REPLIES = 4;
const MAX_REPEATS = 3;
const RESULT_LIMIT = 3000;
const HISTORY_WINDOW = 14;

const TOOLS = [
  "navigate",

  "open_tab",
  "switch_tab",
  "list_tabs",
  "get_current_tab",
  "close_tab",

  "get_page_info",
  "get_text",

  "find_by_text",
  "find_by_attribute",
  "find_by_attribute_value",

  "click",
  "type",
  "scroll",
  "press_key",
  "wait",
  "verify",
];

const RESPONSE_SCHEMA = {
  type: "object",

  properties: {
    state: {
      type: "string",
      enum: ["ACTION", "OUTPUT"],
    },

    plan: {
      type: "string",
    },

    function: {
      type: "string",
      enum: TOOLS,
    },

    input: {
      type: "object",
    },

    success: {
      type: "boolean",
    },

    message: {
      type: "string",
    },
  },

  required: ["state"],
};

const PAGE_CHANGING = ["click", "type", "press_key", "navigate"];

const AUTO_WAIT_MS = {
  click: 800,
  press_key: 800,
};

const HINTS = {
  type: "Nothing was typed. Do NOT press Enter. Use the elementId of a real input, textarea or contenteditable element.",

  click: "Nothing was clicked. Find the element again.",

  navigate: "The page did not load. Check the URL.",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function trim(value) {
  const s = JSON.stringify(value);

  return s.length > RESULT_LIMIT
    ? s.slice(0, RESULT_LIMIT) + "...[truncated]"
    : s;
}

export async function runAgent(text, tabId, onStep = () => {}, signal) {
  if (!tabId) {
    throw new Error("No target tab");
  }

  let currentTabId = tabId;
  // --------------------------------------------------
  // INITIAL PAGE
  // --------------------------------------------------

  const page = await sendToTab(currentTabId, "get_page_info", {}).catch(
    () => null,
  );

  // --------------------------------------------------
  // MESSAGE HISTORY
  // --------------------------------------------------

  const messages = [
    {
      role: "system",
      content: system_prompt,
    },

    {
      role: "user",

      content:
        `Task: ${text}\n` +
        `Current page: ${page?.url ?? "unknown"} ` +
        `(${page?.title ?? ""})`,
    },
  ];

  let badReplies = 0;
  let repeats = 0;
  let lastSignature = "";

  let failNags = 0;

  const failedActions = new Set();

  // --------------------------------------------------
  // AGENT LOOP
  // --------------------------------------------------

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (signal?.aborted) {
        throw new Error("Stopped by user");
      }

      // --------------------------------------------------
      // HISTORY WINDOW
      // --------------------------------------------------

      const windowed = [
        ...messages.slice(0, 2),

        ...messages.slice(2).slice(-HISTORY_WINDOW),
      ];

      // --------------------------------------------------
      // CALL LLM
      // --------------------------------------------------

      const response = await callLocalModel(windowed, signal, RESPONSE_SCHEMA);

      messages.push({
        role: "assistant",
        content: response,
      });

      // --------------------------------------------------
      // PARSE RESPONSE
      // --------------------------------------------------

      let action = null;

      try {
        action = JSON.parse(response);
      } catch {}

      if (!action || typeof action !== "object") {
        if (++badReplies >= MAX_BAD_REPLIES) {
          throw new Error("Model keeps returning invalid JSON");
        }

        messages.push({
          role: "user",

          content:
            'Invalid reply. Return ONLY JSON with "state": "ACTION" or "OUTPUT".',
        });

        continue;
      }

      // --------------------------------------------------
      // OUTPUT
      // --------------------------------------------------

      if (action.state === "OUTPUT") {
        badReplies = 0;

        const gaveUp = action.success === false;

        if (!gaveUp && failedActions.size && failNags < 2) {
          failNags++;

          messages.push({
            role: "user",

            content: `Not finished: these actions failed and were never retried successfully: ${[
              ...failedActions,
            ].join(", ")}. Fix them or finish with success false.`,
          });

          continue;
        }

        onStep({
          type: "final",

          message: action.message ?? "",
        });

        return action.message ?? "";
      }

      // --------------------------------------------------
      // ACTION
      // --------------------------------------------------

      const tool = action.function;

      const args =
        action.input && typeof action.input === "object" ? action.input : {};

      if (!TOOLS.includes(tool)) {
        if (++badReplies >= MAX_BAD_REPLIES) {
          throw new Error("Model keeps returning invalid actions");
        }

        messages.push({
          role: "user",

          content: `Reply with state "ACTION" and one of: ${TOOLS.join(
            ", ",
          )} — or state "OUTPUT" if finished.`,
        });

        continue;
      }

      badReplies = 0;

      // --------------------------------------------------
      // REPEAT DETECTION
      // --------------------------------------------------

      const signature = JSON.stringify({
        tool,
        args,
      });

      if (tool !== "scroll" && tool !== "wait") {
        repeats = signature === lastSignature ? repeats + 1 : 1;

        if (repeats >= MAX_REPEATS) {
          throw new Error(`Agent is stuck repeating ${tool}`);
        }
      }

      lastSignature = signature;

      // --------------------------------------------------
      // UI STEP
      // --------------------------------------------------

      onStep({
        type: "tool",
        name: tool,
        args,
      });

      // --------------------------------------------------
      // EXECUTE TOOL
      // --------------------------------------------------

      let result;

      try {
        // ---------------------------------------------
        // NAVIGATE CURRENT TAB
        // ---------------------------------------------

        if (tool === "navigate") {
          result = await navigate(currentTabId, args.url);
        }

        // ---------------------------------------------
        // PRESS KEY CURRENT TAB
        // ---------------------------------------------
        else if (tool === "press_key") {
          result = await pressKey(currentTabId, args.key);
        }

        // ---------------------------------------------
        // OPEN NEW TAB
        // ---------------------------------------------
        else if (tool === "open_tab") {
          result = await openTab(args.url);

          if (result.success && result.tabId) {
            // New tab becomes current tab
            currentTabId = result.tabId;
          }
        }

        // ---------------------------------------------
        // SWITCH TAB
        // ---------------------------------------------
        else if (tool === "switch_tab") {
          result = await switchTab(args.tabId);

          if (result.success && result.tabId) {
            currentTabId = result.tabId;
          }
        }

        // ---------------------------------------------
        // LIST TABS
        // ---------------------------------------------
        else if (tool === "list_tabs") {
          result = await listTabs();
        }

        // ---------------------------------------------
        // CURRENT TAB
        // ---------------------------------------------
        else if (tool === "get_current_tab") {
          result = await getTab(currentTabId);
        }

        // ---------------------------------------------
        // CLOSE TAB
        // ---------------------------------------------
        else if (tool === "close_tab") {
          const closingTabId = args.tabId ?? currentTabId;

          result = await closeTab(closingTabId);

          // If we closed our current tab,
          // select another tab.
          if (result.success && closingTabId === currentTabId) {
            const tabs = await listTabs();

            const nextTab = tabs.tabs?.find(
              (tab) => tab.tabId && tab.tabId !== closingTabId,
            );

            if (nextTab) {
              currentTabId = nextTab.tabId;

              await switchTab(currentTabId);
            } else {
              currentTabId = null;
            }
          }
        }

        // ---------------------------------------------
        // NORMAL CONTENT-SCRIPT TOOLS
        // ---------------------------------------------
        else {
          result = await sendToTab(currentTabId, tool, args);
        }
      } catch (error) {
        result = {
          success: false,
          error: error?.message ?? String(error),
        };
      }

      result ??= {
        success: false,
        error: "No tool response",
      };

      // --------------------------------------------------
      // WAIT AFTER PAGE CHANGE
      // --------------------------------------------------

      if (AUTO_WAIT_MS[tool]) {
        await sleep(AUTO_WAIT_MS[tool]);
      }

      // --------------------------------------------------
      // SEND RESULT TO UI
      // --------------------------------------------------

      onStep({
        type: "result",
        name: tool,
        result,
      });

      // --------------------------------------------------
      // TRACK FAILURES
      // --------------------------------------------------

      if (PAGE_CHANGING.includes(tool)) {
        if (result.success) {
          failedActions.delete(tool);
        } else {
          failedActions.add(tool);
        }
      }

      // --------------------------------------------------
      // OBSERVATION
      // --------------------------------------------------

      const failureHint =
        result.success === false
          ? `\nFAILED: nothing changed. ${
              HINTS[tool] ?? "Try a different approach."
            }`
          : "";

      messages.push({
        role: "user",

        content:
          `OBSERVATION\n` +
          `Task: ${text}\n` +
          `Result of ${tool}: ${trim(result)}` +
          failureHint,
      });
    }

    throw new Error("Agent reached maximum steps");
  } catch (error) {
    onStep({
      type: "error",

      message:
        error?.name === "AbortError"
          ? "Stopped by user"
          : (error?.message ?? String(error)),
    });

    return null;
  }
}

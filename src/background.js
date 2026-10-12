// background.js
import { summarize } from "../src/utils/summarize.js";
import { runAgent } from "../src/agent/agent.js";
import { getActiveTab } from "../src/utils/browser.js";

const STORAGE_KEY = "agentState";

let running = false;

let abortController = null;

// --------------------------------------------------
// DEFAULT STATE
// --------------------------------------------------

const DEFAULT_STATE = {
  running: false,
  task: "",
  tabId: null,
  steps: [],
  result: null,
  error: null,
};

// --------------------------------------------------
// STORAGE
// --------------------------------------------------

async function getState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);

  return data[STORAGE_KEY] ?? DEFAULT_STATE;
}

async function setState(patch) {
  const current = await getState();

  const next = {
    ...current,
    ...patch,
  };

  await chrome.storage.local.set({
    [STORAGE_KEY]: next,
  });

  return next;
}

// --------------------------------------------------
// ADD STEP
// --------------------------------------------------

async function addStep(step) {
  const message = summarize(step);

  // Don't store invisible/internal events.
  if (!message) {
    return;
  }

  const state = await getState();

  const newStep = {
    step: (state.steps?.length ?? 0) + 1,
    type: step.type,
    name: step.name,
    args: step.args,
    result: step.result,
    message,
    timestamp: Date.now(),
  };

  const next = {
    ...state,
    steps: [...(state.steps ?? []), newStep],
  };

  await chrome.storage.local.set({
    agentState: next,
  });

  chrome.runtime
    .sendMessage({
      type: "AGENT_STEP",
      step: newStep,
    })
    .catch(() => {});
}

// --------------------------------------------------
// BROADCAST
// --------------------------------------------------

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// --------------------------------------------------
// START AGENT
// --------------------------------------------------

async function startAgent(task) {
  if (running) {
    broadcast({
      type: "AGENT_ERROR",
      message: "Agent is already running.",
    });

    return;
  }

  const command = String(task ?? "").trim();

  if (!command) {
    broadcast({
      type: "AGENT_ERROR",
      message: "Task cannot be empty.",
    });

    return;
  }

  let tab;

  try {
    tab = await getActiveTab();
  } catch (error) {
    broadcast({
      type: "AGENT_ERROR",
      message: error?.message ?? "No active tab.",
    });

    return;
  }

  const tabId = tab.id;

  // -----------------------------------------------
  // RESET STATE
  // -----------------------------------------------

  running = true;

  abortController = new AbortController();

  await setState({
    running: true,

    task: command,

    tabId,

    steps: [],

    result: null,

    error: null,
  });

  broadcast({
    type: "AGENT_STARTED",
    task: command,
    tabId,
  });

  try {
    const finalResult = await runAgent(
      command,

      tabId,

      async (step) => {
        await addStep(step);
      },

      abortController.signal,
    );

    // ---------------------------------------------
    // FINISHED
    // ---------------------------------------------

    await setState({
      running: false,

      result: finalResult ?? null,

      error: null,
    });

    broadcast({
      type: "AGENT_FINISHED",

      result: finalResult ?? null,
    });
  } catch (error) {
    const message = error?.message ?? String(error);

    await addStep({
      type: "error",

      message,
    });

    await setState({
      running: false,

      error: message,
    });

    broadcast({
      type: "AGENT_ERROR",

      message,
    });
  } finally {
    running = false;

    abortController = null;
  }
}

// --------------------------------------------------
// STOP AGENT
// --------------------------------------------------

async function stopAgent() {
  if (!running) {
    return;
  }

  abortController?.abort();

  running = false;

  await setState({
    running: false,

    error: "Stopped by user",
  });

  broadcast({
    type: "AGENT_STOPPED",
  });
}

// --------------------------------------------------
// CLEAR ACTIVITY
// --------------------------------------------------

async function clearActivity() {
  const state = await getState();

  if (state.running) {
    return;
  }

  await setState({
    steps: [],

    result: null,

    error: null,

    task: "",
  });

  broadcast({
    type: "AGENT_CLEARED",
  });
}

// --------------------------------------------------
// MESSAGE HANDLER
// --------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_AGENT") {
    startAgent(message.task);

    sendResponse({
      success: true,
    });

    return true;
  }

  if (message?.type === "STOP_AGENT") {
    stopAgent();

    sendResponse({
      success: true,
    });

    return true;
  }

  if (message?.type === "GET_AGENT_STATE") {
    getState()
      .then((state) => {
        sendResponse({
          success: true,
          state,
        });
      })
      .catch((error) => {
        sendResponse({
          success: false,

          error: error?.message ?? String(error),
        });
      });

    return true;
  }

  if (message?.type === "CLEAR_AGENT") {
    clearActivity();

    sendResponse({
      success: true,
    });

    return true;
  }

  return false;
});

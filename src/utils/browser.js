// src/utils/browser.js

export async function sendToTab(tabId, action, data = {}) {
  if (!tabId) {
    throw new Error("No tab ID");
  }

  return await chrome.tabs.sendMessage(tabId, {
    action,
    ...data,
  });
}


// --------------------------------------------------
// GET CURRENT ACTIVE TAB
// --------------------------------------------------

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    throw new Error("No active tab found");
  }

  return tab;
}


// --------------------------------------------------
// NAVIGATE
// --------------------------------------------------

export async function navigate(tabId, url) {
  if (!tabId) {
    throw new Error("No tab ID");
  }

  if (!url) {
    throw new Error("URL is required");
  }

  let parsed;

  try {
    parsed = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(url)
        ? url
        : `https://${url}`
    );
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are allowed");
  }

  await new Promise((resolve, reject) => {
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;

      finished = true;

      chrome.tabs.onUpdated.removeListener(listener);

      reject(new Error("Navigation timeout"));
    }, 15000);

    function listener(updatedTabId, changeInfo) {
      if (
        updatedTabId === tabId &&
        changeInfo.status === "complete"
      ) {
        if (finished) return;

        finished = true;

        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);

        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.update(tabId, {
      url: parsed.href,
    }).catch((error) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);

      reject(error);
    });
  });

  await sleep(500);

  return {
    success: true,
    url: parsed.href,
  };
}


// --------------------------------------------------
// PRESS KEY
// --------------------------------------------------

export async function pressKey(tabId, key) {
  if (!tabId) {
    throw new Error("No tab ID");
  }

  const keys = {
    Enter: {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    },

    Escape: {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    },

    Tab: {
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    },
  };

  const keyInfo = keys[key];

  if (!keyInfo) {
    throw new Error(`Unsupported key: ${key}`);
  }

  await chrome.debugger.attach(
    { tabId },
    "1.3"
  );

  try {
    await chrome.debugger.sendCommand(
      { tabId },
      "Input.dispatchKeyEvent",
      keyInfo
    );

    await chrome.debugger.sendCommand(
      { tabId },
      "Input.dispatchKeyEvent",
      {
        ...keyInfo,
        type: "keyUp",
      }
    );

    return {
      success: true,
      key,
    };
  } finally {
    await chrome.debugger
      .detach({ tabId })
      .catch(() => {});
  }
}


// --------------------------------------------------
// SLEEP
// --------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}



// --------------------------------------------------
// OPEN NEW TAB
// --------------------------------------------------

export async function openTab(url) {
  if (!url) {
    throw new Error("URL is required");
  }

  let parsed;

  try {
    parsed = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(url)
        ? url
        : `https://${url}`
    );
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are allowed");
  }

  const tab = await chrome.tabs.create({
    url: parsed.href,
    active: true,
  });

  if (!tab?.id) {
    throw new Error("Failed to create new tab");
  }

  await waitForTabLoad(tab.id);

  return {
    success: true,
    tabId: tab.id,
    url: parsed.href,
    title: tab.title ?? "",
  };
}


// --------------------------------------------------
// SWITCH TAB
// --------------------------------------------------

export async function switchTab(tabId) {
  if (!tabId) {
    throw new Error("Tab ID is required");
  }

  const tab = await chrome.tabs.get(tabId);

  if (!tab) {
    throw new Error("Tab not found");
  }

  await chrome.tabs.update(tabId, {
    active: true,
  });

  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, {
      focused: true,
    });
  }

  return {
    success: true,
    tabId: tab.id,
    url: tab.url ?? "",
    title: tab.title ?? "",
  };
}


// --------------------------------------------------
// LIST TABS
// --------------------------------------------------

export async function listTabs() {
  const tabs = await chrome.tabs.query({});

  return {
    success: true,

    tabs: tabs.map((tab) => ({
      tabId: tab.id,
      windowId: tab.windowId,
      active: tab.active,
      title: tab.title ?? "",
      url: tab.url ?? "",
    })),
  };
}


// --------------------------------------------------
// GET TAB
// --------------------------------------------------

export async function getTab(tabId) {
  if (!tabId) {
    throw new Error("Tab ID is required");
  }

  const tab = await chrome.tabs.get(tabId);

  return {
    success: true,
    tabId: tab.id,
    windowId: tab.windowId,
    active: tab.active,
    title: tab.title ?? "",
    url: tab.url ?? "",
  };
}


// --------------------------------------------------
// CLOSE TAB
// --------------------------------------------------

export async function closeTab(tabId) {
  if (!tabId) {
    throw new Error("Tab ID is required");
  }

  await chrome.tabs.remove(tabId);

  return {
    success: true,
    tabId,
  };
}


// --------------------------------------------------
// WAIT FOR TAB LOAD
// --------------------------------------------------

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;

      finished = true;

      chrome.tabs.onUpdated.removeListener(listener);

      reject(
        new Error("Tab loading timeout")
      );
    }, 15000);


    function listener(updatedTabId, changeInfo) {
      if (
        updatedTabId === tabId &&
        changeInfo.status === "complete"
      ) {
        if (finished) return;

        finished = true;

        clearTimeout(timeout);

        chrome.tabs.onUpdated.removeListener(
          listener
        );

        resolve();
      }
    }


    chrome.tabs.onUpdated.addListener(listener);
  });
}
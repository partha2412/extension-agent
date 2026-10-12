// src/utils/storage.js

const KEY = "agent_activity";

export async function getAgentActivity() {
  const data = await chrome.storage.local.get(KEY);
  return data[KEY] || [];
}

export async function saveAgentActivity(activity) {
  await chrome.storage.local.set({
    [KEY]: activity,
  });
}

export async function clearAgentActivity() {
  await chrome.storage.local.remove(KEY);
}
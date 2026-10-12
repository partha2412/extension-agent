export const tools = [
  {
    name: "get_page_info",
    description: "Get information about the current webpage.",
    parameters: {},
  },

  {
    name: "find_element",
    description:
      "Find webpage elements matching the given text or description.",
    parameters: {
      query: "Text or description of the element to find.",
    },
  },

  {
    name: "click",
    description: "Click a webpage element using its element ID.",
    parameters: {
      elementId: "ID of the webpage element.",
    },
  },

  {
    name: "type",
    description: "Type text into a webpage element.",
    parameters: {
      elementId: "ID of the webpage element.",
      text: "Text to type.",
    },
  },

  {
    name: "scroll",
    description: "Scroll the webpage.",
    parameters: {
      direction: "up or down.",
    },
  },

  {
    name: "press_key",
    description: "Press a keyboard key.",
    parameters: {
      key: "Keyboard key such as Enter, Escape, ArrowDown.",
    },
  },
];
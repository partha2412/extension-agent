// src/utils/gemini.js

import { GoogleGenAI, Type } from "@google/genai";
import { sendToActiveTab } from "./browser";

const ai = new GoogleGenAI({
  apiKey: import.meta.env.VITE_GEMINI_API_KEY,
});

const tools = [
  {
    name: "get_page_info",
    description: "Get information about the current webpage.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },

  {
    name: "find_element",
    description:
      "Find webpage elements matching the given text or description.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Text or description of the element to find.",
        },
      },
      required: ["query"],
    },
  },

  {
    name: "click",
    description: "Click a webpage element using its element ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        elementId: {
          type: Type.STRING,
        },
      },
      required: ["elementId"],
    },
  },

  {
    name: "type",
    description: "Type text into a webpage element.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        elementId: {
          type: Type.STRING,
        },
        text: {
          type: Type.STRING,
        },
      },
      required: ["elementId", "text"],
    },
  },

  {
    name: "scroll",
    description: "Scroll the webpage.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        direction: {
          type: Type.STRING,
          description: "up or down",
        },
      },
      required: ["direction"],
    },
  },

  {
    name: "press_key",
    description: "Press a keyboard key.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: {
          type: Type.STRING,
          description: "Keyboard key such as Enter, Escape, ArrowDown.",
        },
      },
      required: ["key"],
    },
  },
];

export async function runAgent(task, onStep) {
  const contents = [
    {
      role: "user",
      parts: [{ text: task }],
    },
  ];

  try {
    while (true) {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          tools: [
            {
              functionDeclarations: tools,
            },
          ],
        },
      });

      const calls = response.functionCalls;

      if (!calls || calls.length === 0) {
        onStep({
          type: "final",
          message: response.text,
        });

        return response.text;
      }

      contents.push(response.candidates[0].content);

      const functionResponses = [];

      for (const call of calls) {
        onStep({
          type: "tool",
          name: call.name,
          args: call.args,
        });

        let result;

        try {
          switch (call.name) {
            case "get_page_info":
              result = await sendToActiveTab("get_page_info");
              break;

            case "find_element":
              result = await sendToActiveTab("find_element", {
                query: call.args.query,
              });
              break;

            case "click":
              result = await sendToActiveTab("click", {
                elementId: call.args.elementId,
              });
              break;

            case "type":
              result = await sendToActiveTab("type", {
                elementId: call.args.elementId,
                text: call.args.text,
              });
              break;

            case "scroll":
              result = await sendToActiveTab("scroll", {
                direction: call.args.direction,
              });
              break;

            case "press_key":
              result = await sendToActiveTab("press_key", {
                key: call.args.key,
              });
              break;

            default:
              result = {
                success: false,
                error: "Unknown tool",
              };
          }
        } catch (error) {
          result = {
            success: false,
            error: error.message,
          };
        }

        onStep({
          type: "result",
          name: call.name,
          result,
        });

        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: result,
          },
        });
      }

      contents.push({
        role: "user",
        parts: functionResponses,
      });
    }
  } catch (error) {
    onStep({
      type: "error",
      message: error.message,
    });

    return null;
  }
}

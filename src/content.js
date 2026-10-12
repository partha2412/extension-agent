// src/content.js

import {
  get_page_info,
  get_text,
  find_by_text,
  find_by_attribute,
  find_by_attribute_value,
  click,
  type,
  scroll,
  wait,
  verify,
} from "./utils/tools.js";


const handlers = {

  get_page_info: () =>
    get_page_info(),


  get_text: (m) =>
    get_text(m.elementId),


  find_by_text: (m) =>
    find_by_text(m.text),


  find_by_attribute: (m) =>
    find_by_attribute(
      m.attribute
    ),


  find_by_attribute_value: (m) =>
    find_by_attribute_value(
      m.attribute,
      m.value
    ),


  click: (m) =>
    click(m.elementId),


  type: (m) =>
    type(
      m.elementId,
      m.text
    ),


  scroll: (m) =>
    scroll(m.direction),


  wait: (m) =>
    wait(m.milliseconds),


  verify: (m) =>
    verify(m.expectation),
};


chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {

    const handler =
      handlers[message?.action];


    if (!handler) {

      console.warn(
        "Unknown message:",
        message
      );

      return false;
    }


    Promise.resolve()

      .then(() =>
        handler(message)
      )

      .then((result) => {

        console.log(
          "TOOL:",
          message.action,
          "RESULT:",
          result
        );

        sendResponse(result);
      })

      .catch((error) => {

        console.error(
          "TOOL ERROR:",
          message.action,
          error
        );

        sendResponse({
          success: false,
          error:
            error?.message ??
            String(error),
        });
      });


    return true;
  }
);
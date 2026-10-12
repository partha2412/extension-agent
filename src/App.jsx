import "./App.css";

import {
  useEffect,
  useRef,
  useState,
} from "react";


const clip = (
  value,
  max = 80
) => {

  const s =
    String(value ?? "");


  return s.length > max
    ? `${s.slice(0, max)}…`
    : s;
};


// --------------------------------------------------
// STEP → UI MESSAGE
// --------------------------------------------------

function summarize(step) {

  if (
    step.type === "final" ||
    step.type === "error"
  ) {

    return step.message;
  }


  if (step.type === "result") {

    if (
      step.result?.success === false
    ) {

      return `${step.name} failed: ${clip(
        step.result.error
      )}`;
    }


    if (
      step.name === "verify" &&
      step.result?.matched === false
    ) {

      return "Not verified yet";
    }


    return null;
  }


  if (step.type !== "tool") {
    return null;
  }


  const args =
    step.args ?? {};


  switch (step.name) {

    case "navigate":
      return `Opening ${clip(args.url)}`;


    case "get_page_info":
      return "Reading the current page";


    case "get_text":
      return "Reading the text";


    case "find_by_text":
      return `Finding "${clip(
        args.text
      )}"`;


    case "find_by_attribute":
      return `Looking for [${clip(
        args.attribute,
        30
      )}]`;


    case "find_by_attribute_value":
      return `Finding [${clip(
        args.attribute,
        20
      )}="${clip(
        args.value,
        30
      )}"]`;


    case "click":
      return "Clicking the selected element";


    case "type":
      return `Typing "${clip(
        args.text,
        40
      )}"`;


    case "scroll":
      return `Scrolling ${
        args.direction ||
        "the page"
      }`;


    case "press_key":
      return `Pressing ${
        args.key ||
        "a key"
      }`;


    case "wait":
      return `Waiting ${
        args.milliseconds ||
        1000
      }ms`;


    case "verify":
      return `Verifying "${clip(
        args.expectation,
        50
      )}"`;


    default:
      return `Using ${step.name}`;
  }
}


// --------------------------------------------------
// APP
// --------------------------------------------------

function App() {

  const [result, setResult] =
    useState([]);

  const [text, setText] =
    useState("");

  const [isRunning, setIsRunning] =
    useState(false);


  const activityScrollRef =
    useRef(null);


  // ------------------------------------------------
  // LOAD BACKGROUND STATE
  // ------------------------------------------------

  useEffect(() => {

    chrome.runtime.sendMessage(
      {
        type:
          "GET_AGENT_STATE",
      },

      (response) => {

        if (
          chrome.runtime.lastError
        ) {

          console.error(
            chrome.runtime.lastError
          );

          return;
        }


        if (
          !response?.success
        ) {

          return;
        }


        const state =
          response.state;


        setResult(
          state.steps ?? []
        );


        setIsRunning(
          Boolean(
            state.running
          )
        );


        if (state.task) {
          setText(
            state.task
          );
        }
      }
    );

  }, []);


  // ------------------------------------------------
  // LISTEN TO BACKGROUND
  // ------------------------------------------------

  useEffect(() => {

    const listener =
      (message) => {

        // ------------------------------------------
        // AGENT STARTED
        // ------------------------------------------

        if (
          message.type ===
          "AGENT_STARTED"
        ) {

          setIsRunning(true);

          setText(
            message.task ?? ""
          );

          setResult([]);

          return;
        }


        // ------------------------------------------
        // NEW STEP
        // ------------------------------------------

        if (
          message.type ===
          "AGENT_STEP"
        ) {

          const step =
            message.step;


          if (!step) {
            return;
          }


          setResult(
            (previous) => {

              // Prevent duplicates
              if (
                previous.some(
                  (item) =>
                    item.step ===
                    step.step
                )
              ) {

                return previous;
              }


              return [
                ...previous,
                step,
              ];
            }
          );


          return;
        }


        // ------------------------------------------
        // FINISHED
        // ------------------------------------------

        if (
          message.type ===
          "AGENT_FINISHED"
        ) {

          setIsRunning(false);

          return;
        }


        // ------------------------------------------
        // ERROR
        // ------------------------------------------

        if (
          message.type ===
          "AGENT_ERROR"
        ) {

          setIsRunning(false);

          return;
        }


        // ------------------------------------------
        // STOPPED
        // ------------------------------------------

        if (
          message.type ===
          "AGENT_STOPPED"
        ) {

          setIsRunning(false);

          return;
        }


        // ------------------------------------------
        // CLEARED
        // ------------------------------------------

        if (
          message.type ===
          "AGENT_CLEARED"
        ) {

          setResult([]);

          return;
        }
      };


    chrome.runtime.onMessage.addListener(
      listener
    );


    return () => {

      chrome.runtime.onMessage.removeListener(
        listener
      );
    };

  }, []);


  // ------------------------------------------------
  // SCROLL ACTIVITY
  // ------------------------------------------------

  useEffect(() => {

    const container =
      activityScrollRef.current;


    if (!container) {
      return;
    }


    container.scrollTop =
      container.scrollHeight;

  }, [result]);


  // ------------------------------------------------
  // RUN
  // ------------------------------------------------

  const handleRun = () => {

    const command =
      text.trim();


    if (!command || isRunning) {
      return;
    }


    chrome.runtime.sendMessage(
      {
        type:
          "START_AGENT",

        task:
          command,
      },

      (response) => {

        if (
          chrome.runtime.lastError
        ) {

          console.error(
            chrome.runtime.lastError
          );

          return;
        }


        if (
          response?.success
        ) {

          setIsRunning(true);
        }
      }
    );
  };


  // ------------------------------------------------
  // STOP
  // ------------------------------------------------

  const handleStop = () => {

    chrome.runtime.sendMessage(
      {
        type:
          "STOP_AGENT",
      }
    );
  };


  // ------------------------------------------------
  // CLEAR
  // ------------------------------------------------

  const handleClear = () => {

    if (isRunning) {
      return;
    }


    chrome.runtime.sendMessage(
      {
        type:
          "CLEAR_AGENT",
      }
    );
  };


  // ------------------------------------------------
  // UI
  // ------------------------------------------------

  return (

    <div className="w-[380px] h-[600px] p-4 overflow-hidden">

      <div className="flex flex-col gap-4">

        {/* HEADER */}

        <div>

          <h1 className="text-lg font-semibold tracking-tight">
            Browser Agent
          </h1>

          <p className="text-xs text-slate-400 mt-1">
            Find elements and execute browser actions
          </p>

        </div>


        {/* COMMAND */}

        <section className="rounded-xl border border-slate-800 p-3">

          <div className="mb-3">

            <h2 className="text-sm font-medium">
              Agent Command
            </h2>

            <p className="text-[11px] text-slate-500">
              Describe what you want the browser to do
            </p>

          </div>


          <textarea
            value={text}
            onChange={(e) =>
              setText(e.target.value)
            }
            disabled={isRunning}
            placeholder="e.g. Search for React tutorials"
            className="
              w-full h-20
              resize-none
              rounded-lg
              border border-slate-700
              p-3
              text-xs
              placeholder:text-slate-600
              outline-none
              focus:border-blue-500
              disabled:opacity-50
            "
          />


          <div className="flex gap-2 mt-3">

            <button
              disabled={isRunning}
              className="
                flex-1 h-9
                rounded-lg
                border border-slate-700
                hover:bg-slate-700
                disabled:opacity-40
                disabled:cursor-not-allowed
                text-xs font-medium
                transition
              "
            >
              Type Text
            </button>


            {!isRunning ? (

              <button
                onClick={handleRun}
                disabled={!text.trim()}
                className="
                  flex-1 h-9
                  rounded-lg
                  bg-emerald-600
                  hover:bg-emerald-500
                  text-white
                  disabled:opacity-40
                  disabled:cursor-not-allowed
                  text-xs font-medium
                  transition
                "
              >
                Run Agent
              </button>

            ) : (

              <button
                onClick={handleStop}
                className="
                  flex-1 h-9
                  rounded-lg
                  bg-red-600
                  hover:bg-red-500
                  text-white
                  text-xs font-medium
                  transition
                "
              >
                Stop Agent
              </button>

            )}

          </div>

        </section>


        {/* ACTIVITY */}

        <section className="rounded-xl border border-slate-800 p-3 w-full">

          <div className="flex items-center justify-between mb-3">

            <div>

              <h2 className="text-sm font-medium text-green-700">
                Agent Activity
              </h2>

              <p className="text-[11px] text-slate-500">
                Current execution
              </p>

            </div>


            <div className="flex items-center gap-2">

              {isRunning && (

                <span className="text-[10px] text-slate-500">
                  Running
                </span>

              )}


              <button
                onClick={handleClear}
                disabled={isRunning}
                className="
                  text-[10px]
                  px-2
                  py-1
                  rounded-md
                  border border-red-700
                  text-red-500
                  hover:text-white
                  hover:bg-red-500
                  hover:border-red-500
                  disabled:opacity-40
                  disabled:cursor-not-allowed
                  transition
                "
              >
                Clear
              </button>

            </div>

          </div>


          <div
            ref={activityScrollRef}
            className="h-[210px] overflow-y-auto"
          >

            {result.length === 0 &&
              !isRunning && (

                <div className="h-full flex items-center justify-center">

                  <span className="text-xs text-slate-600">
                    No activity yet
                  </span>

                </div>
              )}


            {isRunning &&
              result.length === 0 && (

                <div className="h-full flex items-center justify-center gap-2">

                  <span
                    className="
                      w-3 h-3
                      border-2
                      border-slate-500
                      border-t-transparent
                      rounded-full
                      animate-spin
                    "
                  />

                  <span className="text-xs text-slate-500">
                    Agent is working...
                  </span>

                </div>
              )}


            <div className="space-y-1">

              {result.map((step) => {

                const message =
                  step.message ||
                  summarize(step);


                const showFull =
                  step.type === "final" ||
                  step.type === "error";


                return (

                  <div
                    key={step.step}
                    className="
                      flex items-start gap-2
                      px-2 py-2
                      rounded-md
                      bg-sky-200/40
                    "
                  >

                    <span
                      className="
                        flex items-center
                        justify-center
                        w-5 h-5
                        rounded-full
                        bg-sky-200
                        text-[10px]
                        text-slate-800
                        shrink-0
                      "
                    >
                      {step.step}
                    </span>


                    <span
                      className={`
                        text-xs
                        select-text
                        ${
                          showFull
                            ? "whitespace-pre-wrap break-words"
                            : "truncate"
                        }
                        ${
                          step.type === "error"
                            ? "text-red-500"
                            : "text-slate-900"
                        }
                      `}
                    >
                      {message}
                    </span>

                  </div>
                );
              })}

            </div>

          </div>

        </section>

      </div>

    </div>
  );
}


export default App;
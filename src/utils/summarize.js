export const clip = (value, max = 80) => {
  const s = String(value ?? "");

  return s.length > max
    ? `${s.slice(0, max)}…`
    : s;
};


export function summarize(step) {
  if (
    step.type === "final" ||
    step.type === "error"
  ) {
    return step.message;
  }

  if (step.type === "result") {
    if (step.result?.success === false) {
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

  const args = step.args ?? {};

  switch (step.name) {
    case "navigate":
      return `Opening ${clip(args.url)}`;

    case "get_page_info":
      return "Reading the current page";

    case "get_text":
      return "Reading the text";

    case "find_by_text":
      return `Finding "${clip(args.text)}"`;

    case "find_by_attribute":
      return `Looking for [${clip(
        args.attribute,
        30
      )}]`;

    case "find_by_attribute_value":
      return `Finding [${clip(
        args.attribute,
        20
      )}="${clip(args.value, 30)}"]`;

    case "click":
      return "Clicking the selected element";

    case "type":
      return `Typing "${clip(args.text, 40)}"`;

    case "scroll":
      return `Scrolling ${
        args.direction || "the page"
      }`;

    case "press_key":
      return `Pressing ${
        args.key || "a key"
      }`;

    case "wait":
      return `Waiting ${
        args.milliseconds || 1000
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
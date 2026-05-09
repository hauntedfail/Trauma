// @refresh reload
import { mount, StartClient } from "@solidjs/start/client";

const appRoot = document.getElementById("app");
if (!appRoot) {
  throw new Error("SolidStart app root element was not found");
}

export default mount(() => <StartClient />, appRoot);

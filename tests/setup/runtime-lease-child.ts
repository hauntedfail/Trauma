import { setRuntimeLeaseCoordinatorPathForTesting } from "../../src/server/runtime/runtime-lease-coordinator";

const path = process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_PATH;
const temporaryRoot = process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_ROOT;
if (
  process.env.TRAUMA_RUNTIME_TEST_CHILD === "1" &&
  path !== undefined &&
  temporaryRoot !== undefined
) {
  setRuntimeLeaseCoordinatorPathForTesting(path, temporaryRoot);
}

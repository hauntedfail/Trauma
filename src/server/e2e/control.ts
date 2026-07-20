import type {
  E2eControlRequest,
  E2eControlResult,
} from "./control-types";
import {
  inspectE2eFlashbackIds,
  inspectE2eMomentAnchors,
  inspectE2ePersistenceState,
  materializeE2eFixture,
  mutateE2eFixtureState,
  resetE2eFixture,
} from "./fixtures";

export async function executeE2eControlRequest(
  request: E2eControlRequest,
): Promise<E2eControlResult> {
  switch (request.action) {
    case "reset_fixture":
      await resetE2eFixture(request.fixture);
      return {};
    case "materialize_fixture":
      await materializeE2eFixture(request.fixture);
      return {};
    case "mutate_fixture_state":
      await mutateE2eFixtureState(request.mutation);
      return {};
    case "inspect_fixture_state":
      switch (request.inspection) {
        case "moment_anchors":
          return { values: await inspectE2eMomentAnchors() };
        case "flashback_ids":
          return { values: await inspectE2eFlashbackIds() };
        case "persistence_state":
          return {
            state: await inspectE2ePersistenceState(request.memoryId),
          };
      }
  }
}

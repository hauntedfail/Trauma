import type { MaterializeFixtureRequest } from "./control-types";
import {
  materializeBrowseDeleteFixture,
  materializeCollectionArchive,
} from "./fixture-collections";
import { materializeReaderFixture } from "./fixture-reader";

export { resetE2eFixture } from "./fixture-reset";
export {
  inspectE2eFlashbackIds,
  inspectE2eMomentAnchors,
  inspectE2ePersistenceState,
  mutateE2eFixtureState,
} from "./fixture-state";

export async function materializeE2eFixture(
  fixture: MaterializeFixtureRequest["fixture"],
): Promise<void> {
  switch (fixture) {
    case "reader_base":
      await materializeReaderFixture();
      return;
    case "browse_delete":
      await materializeBrowseDeleteFixture();
      return;
    case "collection_archive":
      await materializeCollectionArchive();
  }
}

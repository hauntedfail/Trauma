export const E2E_CONTROL_TOKEN_HEADER = "x-trauma-e2e-control-token";
export const E2E_CONTROL_MAX_BODY_BYTES = 4_096;
export const E2E_CONTROL_MIN_TOKEN_BYTES = 32;
export const E2E_CONTROL_MAX_TOKEN_BYTES = 256;
export const E2E_CONFIG_PATH = ".trauma/e2e/trauma.config.json";

export type ResetFixtureRequest = {
  action: "reset_fixture";
  fixture: "read_only" | "backup_git";
};

export type MaterializeFixtureRequest = {
  action: "materialize_fixture";
  fixture: "reader_base" | "browse_delete" | "collection_archive";
};

export type MutateFixtureStateRequest = {
  action: "mutate_fixture_state";
  mutation:
    | "moment_delete_focus_rows"
    | "settings_translation_defaults"
    | "flashback_warning_insert"
    | "flashback_warning_unflashback";
};

export type InspectFixtureStateRequest =
  | {
      action: "inspect_fixture_state";
      inspection: "moment_anchors" | "flashback_ids";
    }
  | {
      action: "inspect_fixture_state";
      inspection: "persistence_state";
      memoryId: string;
    };

export type E2eControlRequest =
  | ResetFixtureRequest
  | MaterializeFixtureRequest
  | MutateFixtureStateRequest
  | InspectFixtureStateRequest;

export interface E2ePersistenceState {
  backupStatus: string | null;
  commitCount: number;
  commitMessage: string | null;
  contentPath: string | null;
  extractionError: string | null;
  extractionStatus: string | null;
  fileContent: string | null;
  gitStatus: string | null;
  id: string | null;
  title: string | null;
  trackedContent: string | null;
  url: string | null;
}

export type E2eControlResult =
  | Record<string, never>
  | { values: string[] }
  | { state: E2ePersistenceState };

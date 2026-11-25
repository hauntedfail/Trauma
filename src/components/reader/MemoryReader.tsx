import { createAsync, useNavigate } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js";

import { ChevronLeftIcon, CodexIcon, TraumaNavIcons } from "../icons";
import type {
  ReaderMomentItem,
  ReaderFlashbackItem,
  ReaderMemoryResult,
  ReaderTaxonomyItem,
  ReaderContentVariant,
} from "../../server/reader/page-data";
import type { BrowseTaxonomySummaryItem } from "../memories/browse-data";
import {
  SUPPORTED_TRANSLATION_LANGUAGES,
  type SupportedLanguageCode,
} from "../../settings/languages";
import type { CodexModelCatalog } from "../../server/translation/codex-app-server";
import type { CodexReasoningEffort } from "../../server/translation/types";
import type { ReaderTocEntry } from "../../server/reader/markdown-renderer";
import type { FlashbackBrowseRow } from "../../server/db/repositories";
import { FlashbackShortcutList } from "../flashbacks/FlashbackShortcutList";
import {
  getFlashbackBrowsePage,
  revalidateFlashbackBrowsePage,
  revalidateFlashbackBrowseRows,
} from "../flashbacks/flashbacks-loader";
import {
  CollectionPageRetry,
  createCollectionPageRetryController,
} from "../collections/CollectionPageRetry";
import { settleCollectionPage } from "../collections/page-state";
import { MemoryActionMenu } from "../memories/MemoryActionMenu";
import { MemoryReadStatusControl } from "../memories/MemoryReadStatusControl";
import { revalidateBrowseMemoryWorkspace } from "../memories/browse-loader";
import {
  buildMemoryVariantAnchorHref,
  buildSameMemoryAnchorHref,
} from "../memories/memory-anchor-hrefs";
import {
  attachCategoryToMemoryByName,
  attachTagToMemoryByName,
  deleteMemoryById,
  detachTagFromMemoryByName,
  isBackupFailsafeMemoryActionError,
  type FetchFunction,
} from "../memories/memory-action-requests";
import {
  computeVisibleTocRange,
  emptyActiveTocRange,
  type ActiveTocRange,
} from "./toc-reading-range";
import {
  bindReaderTocScrollSpy,
  isSameActiveTocRange,
  readReaderHeadingPositions,
  type ReaderTocScrollSpyBinding,
} from "./toc-scroll-spy";
import {
  collectResolvedReaderMomentTargetIds,
  findReaderMomentForSection,
  resolveReaderMomentTarget,
} from "./reader-moment-targets";
import {
  createMomentForSection,
  type ReaderMomentSection,
} from "./moment-requests";
import { deleteMomentById } from "../moments/moment-action-requests";
import {
  canStartFlashbackToggle,
  shouldHandleFlashbackKeyboardToggle,
  shouldPreventFlashbackSpaceDefault,
} from "./flashback-events";
import { revalidateBackupFailsafeAlert } from "../backup/backup-failsafe-loader";
import { SegmentedToggleButton } from "../ui/SegmentedToggleButton";
import {
  readFlashbackFailure,
  shouldRevalidateBackupFailsafeAfterFlashbackFailure,
} from "./flashback-failure";
import { readFlashbackBackupWarning } from "./flashback-backup-warning";
import { readFlashbackDurabilityWarning } from "./flashback-durability-warning";
import {
  readerArticle,
  readerColumn,
  readerFrame,
  readerPadding,
  readerStatePanel,
} from "./reader-styles";
import {
  computeReaderPositionSnapshot,
  computeReaderScrollDepth,
  isSameReaderPosition,
  READER_POSITION_DEBOUNCE_MS,
  readReaderBodyHeadingPositions,
  readReaderReadableBlockPositions,
  restoreReaderPositionInDom,
  shouldAutoMarkRead,
  submitReaderOpened,
  submitReaderPosition,
  submitReaderTriage,
} from "./reader-position";
import { PsychiatristDock } from "./PsychiatristDock";
import { toSafeReaderSourceHref } from "./source-url";
import { revalidateMomentBrowseRows } from "../moments/moments-loader";
import { revalidateReaderMemory } from "./reader-memory-loader";
import { TaxonomyList } from "../taxonomy/TaxonomyList";
import { RouteHeader } from "../layout/RouteHeader";
import { TaxonomyAddControl } from "../memories/TaxonomyAddControl";
import {
  getLengthBucket,
  type MemoryLastPosition,
  type MemoryTriageState,
} from "../memories/browse-data";
import { submitMemoryReadStatus } from "../memories/MemoryReadStatusControl";
import { useDismissableLayer } from "../ui/dismissable-layer";
import {
  ScrollableUrlDisplay,
  ScrollableUrlLink,
} from "../url/ScrollableUrlText";
import {
  submitReadCodexModels,
  submitTranslationDefaults,
} from "../settings/settings-submit";
import { revalidateSettingsState } from "../settings/settings-loader";
import { captureAsyncActionFocusIntent } from "../async-action-focus";
import {
  createReaderGenerationGuard,
  type ReaderGenerationSnapshot,
} from "./reader-generation";
import {
  ReadingRulerOverlay,
  ResumptionBeacon,
  useFocusPlugins,
  type FocusPluginPulseRating,
} from "../../plugins";

export { findReaderMomentForSection, resolveReaderMomentTarget };

interface MemoryReaderProps {
  categoryOptions?: readonly BrowseTaxonomySummaryItem[];
  flashbackRows?: FlashbackBrowseRow[];
  navigate?: (path: string) => void;
  result: ReaderMemoryResult;
  tagOptions?: readonly BrowseTaxonomySummaryItem[];
  translationModel?: string | null;
  translationReasoningEffort?: CodexReasoningEffort | null;
  translationTargetLanguage?: SupportedLanguageCode;
}

type ReadyReaderMemoryResult = Extract<ReaderMemoryResult, { status: "ready" }>;
interface ReaderSelectionPayload {
  text: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
}

interface ReaderSelection extends ReaderSelectionPayload {
  range: Range;
}

interface ReaderSelectionMenuState {
  key: string;
  momentSection?: ReaderMomentSection;
  position: ReaderSelectionMenuPosition;
  selection: ReaderSelection;
}

interface ReaderSectionMenuState {
  key: string;
  position: ReaderSelectionMenuPosition;
  section: ReaderMomentSection;
}

interface ReaderSelectionMenuPosition {
  left: number;
  placement: "above" | "below";
  top: number;
}

type ReaderFlashbackOperation = "flashback" | "unflashback";
type ReaderMenuElement = HTMLDivElement | undefined;
interface TocScrollState {
  canScrollDown: boolean;
  canScrollUp: boolean;
}

interface TranslationProgressState {
  eventUrl: string;
  jobId: string;
  message: string;
  preview: string;
  status: "idle" | "starting" | "running" | "completed" | "failed";
}

const noTocScrollState: TocScrollState = {
  canScrollDown: false,
  canScrollUp: false,
};

const readerTocScrollContent =
  "max-h-[min(44vh,24rem)] overflow-y-auto overscroll-contain pr-1";
const readerFlashbackScrollContent =
  "grid max-h-[min(44vh,24rem)] gap-3 overflow-y-auto overscroll-contain pr-1";
const readerContextMenuClass =
  "trauma-reader-context-menu fixed z-[70] inline-flex items-center gap-1 rounded-full border border-transparent p-1 shadow-none";
const readerSourceLinkClass =
  "min-h-9 max-w-full justify-self-start text-sm leading-tight text-trauma-link";

export type ReaderInspectorTab =
  | "outline"
  | "marks"
  | "translate"
  | "details"
  | "psychiatrist";

const READER_INSPECTOR_TABS: readonly {
  id: ReaderInspectorTab;
  label: string;
}[] = [
  { id: "outline", label: "Outline" },
  { id: "marks", label: "Marks" },
  { id: "translate", label: "Translate" },
  { id: "details", label: "Details" },
  { id: "psychiatrist", label: "Psychiatrist" },
];

const READER_INSPECTOR_TAB_SESSION_KEY = "trauma:reader:inspector-tab";
const READER_TOPBAR_HIDE_SCROLL_Y = 48;
const READER_TOPBAR_SCROLL_DELTA = 8;

function isReaderInspectorTab(value: unknown): value is ReaderInspectorTab {
  return (
    value === "outline" ||
    value === "marks" ||
    value === "translate" ||
    value === "details" ||
    value === "psychiatrist"
  );
}

function readSessionInspectorTab(): ReaderInspectorTab {
  if (typeof window === "undefined") {
    return "outline";
  }
  try {
    const raw = window.sessionStorage.getItem(READER_INSPECTOR_TAB_SESSION_KEY);
    return isReaderInspectorTab(raw) ? raw : "outline";
  } catch {
    return "outline";
  }
}

function writeSessionInspectorTab(tab: ReaderInspectorTab): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(READER_INSPECTOR_TAB_SESSION_KEY, tab);
  } catch {
    // Session tab preference is best-effort.
  }
}

function extractReaderDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}

function formatReaderCapturedDate(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "";
  }
  return value.toISOString().slice(0, 10);
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.matches("input, textarea, select")
  );
}

export function MemoryReader(props: MemoryReaderProps) {
  const readyResult = () =>
    props.result.status === "ready" ? props.result : undefined;
  const readyResultIdentity = () => {
    const result = readyResult();
    return result === undefined
      ? undefined
      : `${result.memory.id}\u0000${result.content.langCode ?? ""}`;
  };
  const stateMessage = () =>
    props.result.status === "ready" ? "" : props.result.message;

  return (
    <Show
      keyed
      when={readyResultIdentity()}
      fallback={<ReaderState message={stateMessage()} />}
    >
      {(_identity) => (
        <ReadyMemoryReader
          categoryOptions={props.categoryOptions ?? []}
          flashbackRows={props.flashbackRows}
          navigate={props.navigate}
          result={readyResult()!}
          tagOptions={props.tagOptions ?? []}
          translationModel={props.translationModel}
          translationReasoningEffort={props.translationReasoningEffort}
          translationTargetLanguage={props.translationTargetLanguage}
        />
      )}
    </Show>
  );
}

function ReadyMemoryReader(props: {
  categoryOptions: readonly BrowseTaxonomySummaryItem[];
  flashbackRows?: FlashbackBrowseRow[];
  navigate?: (path: string) => void;
  result: ReadyReaderMemoryResult;
  tagOptions: readonly BrowseTaxonomySummaryItem[];
  translationModel?: string | null;
  translationReasoningEffort?: CodexReasoningEffort | null;
  translationTargetLanguage?: SupportedLanguageCode;
}) {
  let readerRootRef: HTMLElement | undefined;
  let contentRef: HTMLDivElement | undefined;
  let bodyContentRef: HTMLDivElement | undefined;
  let topBarRef: HTMLDivElement | undefined;
  let inspectorRef: HTMLElement | undefined;
  let inspectorTriggerRef: HTMLButtonElement | undefined;
  let inspectorCloseRef: HTMLButtonElement | undefined;
  let selectionMenuRef: ReaderMenuElement;
  let sectionMenuRef: ReaderMenuElement;
  let translationModelSelectRef: HTMLSelectElement | undefined;
  let sectionLongPressTimer: number | undefined;
  const navigate = props.navigate ?? useNavigate();
  const readerGenerationGuard = createReaderGenerationGuard({
    langCode: props.result.content.langCode,
    memoryId: props.result.memory.id,
  });
  const captureReaderGeneration = (): ReaderGenerationSnapshot =>
    readerGenerationGuard.activate({
      langCode: props.result.content.langCode,
      memoryId: props.result.memory.id,
    });
  const isCurrentReaderGeneration = (
    snapshot: ReaderGenerationSnapshot,
  ): boolean =>
    readerGenerationGuard.isCurrent(snapshot) &&
    props.result.memory.id === snapshot.memoryId &&
    props.result.content.langCode === snapshot.langCode;
  const sourceUrl = () => props.result.memory.url;
  const sourceHref = () => toSafeReaderSourceHref(sourceUrl());
  const readerContent = createMemo(() =>
    splitLeadingReaderTitleContent({
      html: props.result.rendered.html,
      title: props.result.memory.title,
      toc: props.result.rendered.toc,
    }),
  );
  const readerBodyHtml = createMemo(() => readerContent().bodyHtml);
  const readerTitleHtml = createMemo(() => readerContent().titleHtml);
  const [categories, setCategories] = createSignal([
    ...props.result.memory.categories,
  ]);
  const [tags, setTags] = createSignal([
    ...props.result.memory.tags,
  ]);
  const [moments, setMoments] = createSignal([
    ...props.result.memory.moments,
  ]);
  const [currentFlashbacks, setCurrentFlashbacks] = createSignal([
    ...props.result.memory.flashbacks,
  ]);
  const [selectionMenu, setSelectionMenu] =
    createSignal<ReaderSelectionMenuState>();
  const [sectionMenu, setSectionMenu] = createSignal<ReaderSectionMenuState>();
  const [isReaderClientReady, setIsReaderClientReady] = createSignal(false);
  const [activeTocRange, setActiveTocRange] =
    createSignal<ActiveTocRange>(emptyActiveTocRange);
  const [pendingMomentKey, setPendingMomentKey] = createSignal("");
  const [pendingSelectionKey, setPendingSelectionKey] = createSignal("");
  const [errorMessage, setErrorMessage] = createSignal("");
  const [translationProgress, setTranslationProgress] =
    createSignal<TranslationProgressState>();
  const [translationSubmitPending, setTranslationSubmitPending] =
    createSignal(false);
  const [translationDialogOpen, setTranslationDialogOpen] = createSignal(false);
  const [translationDefaultLanguage, setTranslationDefaultLanguage] =
    createSignal<SupportedLanguageCode | "">(props.translationTargetLanguage ?? "");
  const [translationDefaultModel, setTranslationDefaultModel] = createSignal(
    props.translationModel ?? "",
  );
  const [translationDefaultEffort, setTranslationDefaultEffort] = createSignal<
    CodexReasoningEffort | ""
  >(props.translationReasoningEffort ?? "");
  const [translationFormLanguage, setTranslationFormLanguage] = createSignal<
    SupportedLanguageCode | ""
  >(translationDefaultLanguage());
  const [translationFormModel, setTranslationFormModel] = createSignal(
    translationDefaultModel(),
  );
  const [translationFormEffort, setTranslationFormEffort] = createSignal<
    CodexReasoningEffort | ""
  >(translationDefaultEffort());
  const [translationCatalogModels, setTranslationCatalogModels] = createSignal<
    CodexModelCatalog["models"]
  >([]);
  const [translationCatalogError, setTranslationCatalogError] = createSignal("");
  const [translationCatalogPending, setTranslationCatalogPending] =
    createSignal(false);
  const [inspectorOpen, setInspectorOpen] = createSignal(false);
  const [inspectorTab, setInspectorTab] = createSignal<ReaderInspectorTab>(
    "outline",
  );
  const [topBarHidden, setTopBarHidden] = createSignal(false);
  const [landmarkExpanded, setLandmarkExpanded] = createSignal(false);
  const [readState, setReadState] = createSignal(props.result.memory.read);
  const [triageState, setTriageState] = createSignal<
    MemoryTriageState | undefined
  >(props.result.memory.triageState);
  const [triagePending, setTriagePending] = createSignal(false);
  const [triageStatus, setTriageStatus] = createSignal("");
  const [endPulseNotice, setEndPulseNotice] = createSignal("");
  const [currentLastPosition, setCurrentLastPosition] =
    createSignal<MemoryLastPosition | null>(
      props.result.memory.lastPosition ?? null,
    );
  const focusPlugins = useFocusPlugins();
  const activeVariant = () => props.result.content.langCode ?? "source";
  const leadingTitleAnchorId = createMemo(
    () =>
      findLeadingReaderTitleEntry({
        html: props.result.rendered.html,
        title: props.result.memory.title,
        toc: props.result.rendered.toc,
      })?.id,
  );
  const lengthBucket = createMemo(() =>
    getLengthBucket(props.result.memory.wordCount),
  );
  const domainLabel = createMemo(() => extractReaderDomain(sourceUrl()));
  const capturedDateLabel = createMemo(() =>
    formatReaderCapturedDate(props.result.memory.createdAt),
  );
  const experimentLogEnabled = createMemo(
    () =>
      focusPlugins.getActivePluginIds().length > 0 ||
      focusPlugins.pulseLog().length > 0,
  );
  let translationEventSource: EventSource | undefined;
  let translationCatalogRequest: {
    generation: number;
    promise: Promise<"error" | "ignored" | "success">;
  } | undefined;
  let translationRequestGeneration = 0;

  const selectInspectorTab = (tab: ReaderInspectorTab): void => {
    setInspectorTab(tab);
    writeSessionInspectorTab(tab);
    if (tab === "translate") {
      setTranslationDialogOpen(true);
      if (canOpenTranslationSettings() && translationCatalogModels().length === 0) {
        void refreshTranslationCatalog();
      }
    } else {
      setTranslationDialogOpen(false);
    }
  };
  const openInspector = (tab?: ReaderInspectorTab): void => {
    const nextTab = tab ?? inspectorTab();
    selectInspectorTab(nextTab);
    setTopBarHidden(false);
    setInspectorOpen(true);
    queueMicrotask(() => {
      if (inspectorCloseRef?.isConnected === true) {
        inspectorCloseRef.focus({ preventScroll: true });
      }
    });
  };
  const closeInspector = (): void => {
    setInspectorOpen(false);
    setTranslationDialogOpen(false);
    resetTranslationFormToDefaults();
    setTopBarHidden(false);
    queueMicrotask(() => {
      if (inspectorTriggerRef?.isConnected === true) {
        inspectorTriggerRef.focus({ preventScroll: true });
      }
    });
  };
  const toggleInspector = (): void => {
    if (inspectorOpen()) {
      closeInspector();
    } else {
      openInspector();
    }
  };
  useDismissableLayer({
    getRoot: () => inspectorRef,
    isEnabled: inspectorOpen,
    onDismiss: (reason) => {
      if (reason === "escape") {
        closeInspector();
      }
    },
    shouldIgnoreOutsidePointerDown: () => true,
  });

  const handleEndFooterTriage = async (
    nextState: MemoryTriageState,
  ): Promise<void> => {
    const readerGeneration = captureReaderGeneration();
    if (triagePending() || !isCurrentReaderGeneration(readerGeneration)) {
      return;
    }
    setTriagePending(true);
    setTriageStatus("");
    try {
      const updated = await submitReaderTriage({
        memoryId: readerGeneration.memoryId,
        triageState: nextState,
      });
      if (!isCurrentReaderGeneration(readerGeneration)) {
        return;
      }
      setTriageState(updated.triageState);
      setTriageStatus(
        updated.triageState === "library"
          ? "Saved to Library."
          : updated.triageState === "archive"
            ? "Archived."
            : "Returned to Shelf.",
      );
      void Promise.all([
        revalidateBrowseMemoryWorkspace(),
        revalidateReaderMemory(
          readerGeneration.memoryId,
          readerGeneration.langCode,
        ),
      ]);
    } catch {
      if (isCurrentReaderGeneration(readerGeneration)) {
        setTriageStatus("Could not update triage state.");
      }
    } finally {
      if (isCurrentReaderGeneration(readerGeneration)) {
        setTriagePending(false);
      }
    }
  };

  const handleEndFooterPulse = (rating: FocusPluginPulseRating): void => {
    focusPlugins.recordPulse({ rating, surface: "reader" });
    const label =
      READER_PULSE_OPTIONS.find((item) => item.rating === rating)?.label ??
      rating;
    setEndPulseNotice(`Saved: ${label}`);
  };

  const closeSelectionMenu = () => setSelectionMenu(undefined);
  const closeSectionMenu = () => setSectionMenu(undefined);
  const closeReaderMenus = () => {
    closeSelectionMenu();
    closeSectionMenu();
  };
  const focusReaderContent = () => {
    queueMicrotask(() => {
      if (contentRef?.isConnected === true) {
        contentRef.focus({ preventScroll: true });
      }
    });
  };
  const dismissSelectionMenu = () => {
    closeSelectionMenu();
    focusReaderContent();
  };
  const dismissSectionMenu = () => {
    closeSectionMenu();
    focusReaderContent();
  };
  const resetTranslationFormToDefaults = () => {
    setTranslationFormLanguage(translationDefaultLanguage());
    setTranslationFormModel(translationDefaultModel());
    setTranslationFormEffort(translationDefaultEffort());
  };
  createEffect(() => {
    const nextLanguage = props.translationTargetLanguage ?? "";
    const nextModel = props.translationModel ?? "";
    const nextEffort = props.translationReasoningEffort ?? "";
    setTranslationDefaultLanguage(nextLanguage);
    setTranslationDefaultModel(nextModel);
    setTranslationDefaultEffort(nextEffort);
    if (!untrack(translationDialogOpen)) {
      setTranslationFormLanguage(nextLanguage);
      setTranslationFormModel(nextModel);
      setTranslationFormEffort(nextEffort);
    }
  });
  createEffect(() => {
    readerGenerationGuard.activate({
      langCode: props.result.content.langCode,
      memoryId: props.result.memory.id,
    });
    setCategories([...props.result.memory.categories]);
    setTags([...props.result.memory.tags]);
    setMoments([...props.result.memory.moments]);
    setCurrentFlashbacks([...props.result.memory.flashbacks]);
    setReadState(props.result.memory.read);
    setTriageState(props.result.memory.triageState);
  });
  onCleanup(() => {
    readerGenerationGuard.invalidate();
    translationRequestGeneration += 1;
    const activeTranslationEventSource = translationEventSource;
    translationEventSource = undefined;
    activeTranslationEventSource?.close();
  });

  let lastRecordedOpenedMemoryId: string | undefined;
  createEffect(() => {
    if (!isReaderClientReady()) {
      return;
    }
    const memoryId = props.result.memory.id;
    if (memoryId === lastRecordedOpenedMemoryId) {
      return;
    }
    lastRecordedOpenedMemoryId = memoryId;
    void submitReaderOpened({ memoryId });
  });

  onMount(() => {
    setInspectorTab(readSessionInspectorTab());
    setIsReaderClientReady(true);

    let lastScrollY = window.scrollY;
    let hasUserScrolled = false;
    let lastPersistedPosition: MemoryLastPosition | null =
      props.result.memory.lastPosition ?? null;
    let positionSaveTimer: number | undefined;
    let dwellMs = 0;
    let lastVisibleAt = document.visibilityState === "visible" ? Date.now() : null;
    let maxScrollDepth = computeReaderScrollDepth({
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
    });
    let autoReadTriggered = readState();

    const captureCurrentPosition = (): MemoryLastPosition =>
      computeReaderPositionSnapshot({
        headings: readReaderBodyHeadingPositions(
          readerRootRef,
          leadingTitleAnchorId(),
        ),
        blocks: readReaderReadableBlockPositions(bodyContentRef),
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        variant: activeVariant(),
      });

    const clearPositionTimer = () => {
      if (positionSaveTimer !== undefined) {
        window.clearTimeout(positionSaveTimer);
        positionSaveTimer = undefined;
      }
    };

    const flushPosition = (keepalive = false) => {
      clearPositionTimer();
      const candidate = hasUserScrolled ? captureCurrentPosition() : null;
      if (candidate === null || isSameReaderPosition(lastPersistedPosition, candidate)) {
        return;
      }
      lastPersistedPosition = candidate;
      setCurrentLastPosition(candidate);
      void submitReaderPosition({
        memoryId: props.result.memory.id,
        position: candidate,
        keepalive,
      });
    };

    const maybeTriggerAutoRead = () => {
      if (autoReadTriggered || readState()) {
        return;
      }
      const now = Date.now();
      if (lastVisibleAt !== null && document.visibilityState === "visible") {
        dwellMs += Math.max(0, now - lastVisibleAt);
        lastVisibleAt = now;
      }
      maxScrollDepth = Math.max(
        maxScrollDepth,
        computeReaderScrollDepth({
          scrollY: window.scrollY,
          viewportHeight: window.innerHeight,
          scrollHeight: document.documentElement.scrollHeight,
        }),
      );
      if (
        shouldAutoMarkRead({
          alreadyRead: readState(),
          dwellMs,
          scrollDepth: maxScrollDepth,
        })
      ) {
        autoReadTriggered = true;
        const readerGeneration = captureReaderGeneration();
        setReadState(true);
        void submitMemoryReadStatus({
          memoryId: readerGeneration.memoryId,
          read: true,
        })
          .then(() => {
            if (isCurrentReaderGeneration(readerGeneration)) {
              void revalidateAfterReadStatusChange(
                readerGeneration.memoryId,
                readerGeneration.langCode,
              );
            }
          })
          .catch(() => {
            // Auto-read persistence fails silently without mid-text prompts.
          });
      }
    };

    const dwellInterval = window.setInterval(maybeTriggerAutoRead, 1_000);

    const handleReaderScroll = () => {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY;
      lastScrollY = currentY;
      hasUserScrolled = true;

      if (
        delta > READER_TOPBAR_SCROLL_DELTA &&
        currentY > READER_TOPBAR_HIDE_SCROLL_Y &&
        !inspectorOpen() &&
        !(topBarRef !== undefined && topBarRef.contains(document.activeElement))
      ) {
        setTopBarHidden(true);
      } else if (
        delta < -READER_TOPBAR_SCROLL_DELTA ||
        currentY <= READER_TOPBAR_HIDE_SCROLL_Y
      ) {
        setTopBarHidden(false);
      }

      clearPositionTimer();
      positionSaveTimer = window.setTimeout(() => {
        flushPosition(false);
      }, READER_POSITION_DEBOUNCE_MS);

      maybeTriggerAutoRead();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (lastVisibleAt !== null) {
          dwellMs += Math.max(0, Date.now() - lastVisibleAt);
          lastVisibleAt = null;
        }
        if (hasUserScrolled) {
          flushPosition(true);
        }
      } else if (document.visibilityState === "visible") {
        lastVisibleAt = Date.now();
      }
    };

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        (selectionMenu() !== undefined || sectionMenu() !== undefined)
      ) {
        event.preventDefault();
        closeReaderMenus();
        focusReaderContent();
        return;
      }

      if (
        event.key === "]" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditableKeyboardTarget(event.target) &&
        !isEditableKeyboardTarget(document.activeElement) &&
        document.querySelector('[role="dialog"]:not([data-reader-inspector])') === null
      ) {
        event.preventDefault();
        toggleInspector();
      }
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        ((selectionMenuRef !== undefined && selectionMenuRef.contains(target)) ||
          (sectionMenuRef !== undefined && sectionMenuRef.contains(target)))
      ) {
        return;
      }

      closeReaderMenus();
    };
    const scrollHashTarget = () => scheduleReaderHashTargetScroll(readerRootRef);

    document.addEventListener("keydown", handleGlobalKeyDown);
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("scroll", closeReaderMenus, true);
    window.addEventListener("scroll", handleReaderScroll, { passive: true });
    window.addEventListener("hashchange", scrollHashTarget);

    if (window.location.hash.length > 1) {
      scheduleReaderHashTargetScroll(readerRootRef);
    } else if (props.result.memory.lastPosition != null) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          restoreReaderPositionInDom({
            activeVariant: activeVariant(),
            bodyContainer: bodyContentRef,
            lastPosition: props.result.memory.lastPosition,
            root: readerRootRef,
          });
          lastScrollY = window.scrollY;
        });
      });
    }

    onCleanup(() => {
      window.clearInterval(dwellInterval);
      if (hasUserScrolled) {
        flushPosition(true);
      } else {
        clearPositionTimer();
      }
      document.removeEventListener("keydown", handleGlobalKeyDown);
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("scroll", closeReaderMenus, true);
      window.removeEventListener("scroll", handleReaderScroll);
      window.removeEventListener("hashchange", scrollHashTarget);
      clearSectionLongPress();
    });
  });
  const openSelectionMenu = () => {
    const selection = readReaderSelection(contentRef);
    if (selection === undefined) {
      closeSelectionMenu();
      return;
    }

    closeSectionMenu();
    const momentSection = findReaderSectionInSelection(
      selection.range,
      contentRef,
    );
    setSelectionMenu({
      key: getReaderSelectionKey(selection),
      momentSection,
      position: positionReaderSelectionMenu(
        selection.range.getBoundingClientRect(),
        {
          height: window.innerHeight,
          width: window.innerWidth,
        },
        momentSection === undefined ? 48 : 92,
      ),
      selection,
    });
  };
  const openSectionMenu = (section: ReaderMomentSection, rect: DOMRect) => {
    closeSelectionMenu();
    setSectionMenu({
      key: getReaderMomentKey(section),
      position: positionReaderSelectionMenu(rect, {
        height: window.innerHeight,
        width: window.innerWidth,
      }),
      section,
    });
  };
  const commitSelectionMenu = () => {
    const menu = selectionMenu();
    const container = bodyContentRef;
    const readerGeneration = captureReaderGeneration();
    if (
      menu === undefined ||
      container === undefined ||
      !isCurrentReaderGeneration(readerGeneration)
    ) {
      return;
    }

    closeSelectionMenu();
    void toggleReaderSelection({
      container,
      isCurrent: () => isCurrentReaderGeneration(readerGeneration),
      langCode: readerGeneration.langCode,
      memoryId: readerGeneration.memoryId,
      pendingSelectionKey: pendingSelectionKey(),
      selection: menu.selection,
      setErrorMessage,
      setPendingSelectionKey,
      onFlashbacksChanged: setCurrentFlashbacks,
      onSuccess: () =>
        revalidateAfterFlashbackToggle(
          readerGeneration.memoryId,
          readerGeneration.langCode,
        ),
    });
  };
  const commitSelectionMomentMenu = () => {
    const section = selectionMenu()?.momentSection;
    if (section === undefined) {
      return;
    }

    closeSelectionMenu();
    void toggleMoment(section);
  };
  const commitSectionMenu = () => {
    const menu = sectionMenu();
    if (menu === undefined) {
      return;
    }

    closeSectionMenu();
    void toggleMoment(menu.section);
  };
  const readKeyboardSelectionContext = (event: KeyboardEvent) => ({
    hasReaderSelection: readReaderSelection(contentRef) !== undefined,
    targetIsReaderContent: event.target === contentRef,
  });
  const handleKeyboardSelectionKeyDown = (event: KeyboardEvent) => {
    if (!shouldPreventFlashbackSpaceDefault(
      event,
      readKeyboardSelectionContext(event),
    )) {
      return;
    }

    event.preventDefault();
  };
  const handleKeyboardSelectionToggle = (event: KeyboardEvent) => {
    if (!shouldHandleFlashbackKeyboardToggle(
      event,
      readKeyboardSelectionContext(event),
    )) {
      return;
    }

    openSelectionMenu();
  };
  const deleteMemory = async (memoryId: string): Promise<void> => {
    const readerGeneration = captureReaderGeneration();
    if (
      memoryId !== readerGeneration.memoryId ||
      !isCurrentReaderGeneration(readerGeneration)
    ) {
      return;
    }

    try {
      await deleteReaderMemory({
        isCurrent: () => isCurrentReaderGeneration(readerGeneration),
        langCode: readerGeneration.langCode,
        memoryId: readerGeneration.memoryId,
        navigate: (path) => {
          if (isCurrentReaderGeneration(readerGeneration)) {
            navigate(path);
          }
        },
        revalidate: async (deletedMemoryId, langCode) => {
          if (
            !isCurrentReaderGeneration(readerGeneration) ||
            deletedMemoryId !== readerGeneration.memoryId ||
            langCode !== readerGeneration.langCode
          ) {
            return;
          }

          await revalidateAfterMemoryDeletion(deletedMemoryId, langCode);
        },
      });
    } catch (error) {
      if (isCurrentReaderGeneration(readerGeneration)) {
        throw error;
      }
    }
  };
  const attachCategory = async (input: {
    memoryId: string;
    name: string;
  }): Promise<void> => {
    const readerGeneration = captureReaderGeneration();
    if (
      input.memoryId !== readerGeneration.memoryId ||
      !isCurrentReaderGeneration(readerGeneration)
    ) {
      return;
    }

    try {
      const category = await attachReaderCategoryByName({
        memoryId: readerGeneration.memoryId,
        name: input.name,
      });
      if (!isCurrentReaderGeneration(readerGeneration)) {
        return;
      }

      setCategories((current) => mergeReaderTaxonomyItem(current, category));
      void Promise.all([
        revalidateBrowseMemoryWorkspace(),
        revalidateReaderMemory(
          readerGeneration.memoryId,
          readerGeneration.langCode,
        ),
      ]);
    } catch (error) {
      if (isCurrentReaderGeneration(readerGeneration)) {
        throw error;
      }
    }
  };
  const attachTag = async (name: string): Promise<void> => {
    const readerGeneration = captureReaderGeneration();
    if (!isCurrentReaderGeneration(readerGeneration)) {
      return;
    }

    setErrorMessage("");
    try {
      const tag = await attachReaderTagByName({
        memoryId: readerGeneration.memoryId,
        name,
      });
      if (!isCurrentReaderGeneration(readerGeneration)) {
        return;
      }

      setTags((current) => mergeReaderTaxonomyItem(current, tag));
      void revalidateAfterReaderTaxonomyChange(
        readerGeneration.memoryId,
        readerGeneration.langCode,
      );
    } catch (error) {
      if (isCurrentReaderGeneration(readerGeneration)) {
        setErrorMessage("Failed to add tag.");
        throw error;
      }
    }
  };
  const detachTag = async (name: string): Promise<void> => {
    const readerGeneration = captureReaderGeneration();
    if (!isCurrentReaderGeneration(readerGeneration)) {
      return;
    }

    setErrorMessage("");
    try {
      const tag = await detachReaderTagByName({
        memoryId: readerGeneration.memoryId,
        name,
      });
      if (!isCurrentReaderGeneration(readerGeneration)) {
        return;
      }

      setTags((current) => current.filter((item) => item.id !== tag.id));
      void revalidateAfterReaderTaxonomyChange(
        readerGeneration.memoryId,
        readerGeneration.langCode,
      );
    } catch (error) {
      if (isCurrentReaderGeneration(readerGeneration)) {
        setErrorMessage("Failed to remove tag.");
        throw error;
      }
    }
  };
  const isTranslatedReader = () => props.result.content.langCode !== undefined;
  const hasTranslationVariant = (langCode: SupportedLanguageCode | undefined) => {
    return langCode !== undefined &&
      props.result.content.variants.some((variant) => variant.langCode === langCode);
  };
  const canStartTranslation = (
    langCode: SupportedLanguageCode | undefined = props.translationTargetLanguage,
  ) =>
    !isTranslatedReader() &&
    langCode !== undefined &&
    !hasTranslationVariant(langCode);
  const canOpenTranslationSettings = createMemo(() =>
    !isTranslatedReader() &&
    SUPPORTED_TRANSLATION_LANGUAGES.some((option) =>
      canStartTranslation(option.code),
    ),
  );
  const selectedTranslationModel = createMemo(() => {
    const current = translationFormModel();
    return translationCatalogModels().find((model) =>
      model.model === current || model.id === current
    );
  });
  const canonicalTranslationModel = () => {
    const current = translationFormModel();
    if (current === "") {
      return null;
    }

    return selectedTranslationModel()?.model ?? current;
  };
  const translationReasoningEfforts = createMemo(() => {
    const selected = selectedTranslationModel();
    if (selected !== undefined) {
      return selected.supportedReasoningEfforts;
    }
    return translationCatalogModels().find((model) => model.isDefault)
      ?.supportedReasoningEfforts ?? [];
  });
  const refreshTranslationCatalog = (): Promise<
    "error" | "ignored" | "success"
  > => {
    const readerGeneration = captureReaderGeneration();
    if (!isCurrentReaderGeneration(readerGeneration)) {
      return Promise.resolve("ignored");
    }
    if (translationCatalogRequest?.generation === readerGeneration.generation) {
      return translationCatalogRequest.promise;
    }

    setTranslationCatalogPending(true);
    const request = (async () => {
      try {
        const catalog = await submitReadCodexModels();
        if (!isCurrentReaderGeneration(readerGeneration)) {
          return "ignored" as const;
        }

        setTranslationCatalogModels(catalog.models);
        setTranslationCatalogError("");
        return "success" as const;
      } catch (error) {
        if (isCurrentReaderGeneration(readerGeneration)) {
          setTranslationCatalogError(
            error instanceof Error
              ? error.message
              : "Codex model catalog is unavailable.",
          );
          return "error" as const;
        }
        return "ignored" as const;
      }
    })();
    translationCatalogRequest = {
      generation: readerGeneration.generation,
      promise: request,
    };
    void request.finally(() => {
      if (translationCatalogRequest?.promise === request) {
        translationCatalogRequest = undefined;
        if (isCurrentReaderGeneration(readerGeneration)) {
          setTranslationCatalogPending(false);
        }
      }
    });

    return request;
  };
  const retryTranslationCatalog = (retryButton: HTMLButtonElement): void => {
    const readerGeneration = captureReaderGeneration();
    const shouldRestoreFocus = captureAsyncActionFocusIntent(retryButton);
    void refreshTranslationCatalog().then((outcome) => {
      queueMicrotask(() => {
        if (
          outcome === "ignored" ||
          !translationDialogOpen() ||
          !isCurrentReaderGeneration(readerGeneration) ||
          !shouldRestoreFocus()
        ) {
          return;
        }

        const focusTarget = outcome === "success"
          ? translationModelSelectRef
          : retryButton;
        if (focusTarget?.isConnected === true && !focusTarget.disabled) {
          focusTarget.focus({ preventScroll: true });
        }
      });
    });
  };
  const connectTranslationProgress = (
    eventUrl: string,
    jobId: string,
    readerGeneration: ReaderGenerationSnapshot,
  ) => {
    if (!isCurrentReaderGeneration(readerGeneration)) {
      return;
    }

    const previousEventSource = translationEventSource;
    translationEventSource = undefined;
    previousEventSource?.close();
    const eventSource = new EventSource(eventUrl);
    translationEventSource = eventSource;
    const isCurrentTranslationEventSource = (): boolean =>
      translationEventSource === eventSource &&
      isCurrentReaderGeneration(readerGeneration);
    const onProgress = (event: MessageEvent) => {
      if (!isCurrentTranslationEventSource()) {
        return;
      }

      const envelope = parseTranslationEventEnvelope(event.data);
      if (envelope === undefined) {
        return;
      }
      const currentPreview = translationProgress()?.preview ?? "";
      const delta = readTranslationDelta(envelope);
      const preview = delta === ""
        ? currentPreview
        : `${currentPreview}${delta}`.slice(-480);
      const progressStatus = translationProgressStatusForEvent(envelope);
      setTranslationProgress({
        eventUrl,
        jobId,
        message: messageForTranslationEvent(envelope),
        preview,
        status: progressStatus,
      });

      if (isCompletedTranslationEnvelope(envelope)) {
        const readerUrl = readTranslationReaderUrl(envelope);
        translationEventSource = undefined;
        eventSource.close();
        if (readerUrl !== undefined) {
          navigate(readerUrl);
        }
      } else if (isTerminalTranslationEnvelope(envelope)) {
        translationEventSource = undefined;
        eventSource.close();
      }
    };

    for (const eventName of TRANSLATION_EVENT_NAMES) {
      eventSource.addEventListener(eventName, onProgress);
    }
    eventSource.onerror = () => {
      if (!isCurrentTranslationEventSource()) {
        return;
      }

      if (eventSource.readyState === EventSource.CLOSED) {
        translationEventSource = undefined;
        eventSource.close();
        setTranslationProgress({
          eventUrl,
          jobId,
          message: "Translation stream failed. Retry translation.",
          preview: translationProgress()?.preview ?? "",
          status: "failed",
        });
        return;
      }
      setTranslationProgress({
        eventUrl,
        jobId,
        message: "Translation stream disconnected. Reconnecting...",
        preview: translationProgress()?.preview ?? "",
        status: "running",
      });
    };
  };
  const submitTranslationDialog = (
    close: () => void,
  ): JSX.EventHandler<HTMLFormElement, SubmitEvent> => (event) => {
    event.preventDefault();
    if (translationSubmitPending()) {
      return;
    }
    const langCode = translationFormLanguage();
    if (langCode === "") {
      return;
    }
    const selectedEffort = translationFormEffort();
    void startTranslation({
      close,
      langCode,
      model: canonicalTranslationModel(),
      reasoningEffort: selectedEffort === ""
        ? null
        : selectedEffort,
    });
  };
  const startTranslation = async (input: {
    close: () => void;
    langCode: SupportedLanguageCode;
    model: string | null;
    reasoningEffort: CodexReasoningEffort | null;
  }): Promise<void> => {
    const readerGeneration = captureReaderGeneration();
    const langCode = input.langCode;
    if (
      translationSubmitPending() ||
      langCode === undefined ||
      !canStartTranslation(langCode) ||
      !isCurrentReaderGeneration(readerGeneration)
    ) {
      return;
    }
    const requestGeneration = ++translationRequestGeneration;
    const isCurrentTranslationRequest = (): boolean =>
      requestGeneration === translationRequestGeneration &&
      isCurrentReaderGeneration(readerGeneration);

    setTranslationSubmitPending(true);
    setErrorMessage("");
    setTranslationProgress({
      eventUrl: "",
      jobId: "",
      message: `Starting ${langCode} translation...`,
      preview: "",
      status: "starting",
    });
    try {
      const settings = await submitTranslationDefaults({
        language: input.langCode,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
      });
      if (!isCurrentTranslationRequest()) {
        return;
      }

      const persistedLanguage = settings.translationTargetLanguage;
      const persistedModel = settings.codexTranslationModel;
      const persistedReasoningEffort = settings.codexTranslationReasoningEffort;
      setTranslationDefaultLanguage(persistedLanguage);
      setTranslationDefaultModel(persistedModel ?? "");
      setTranslationDefaultEffort(persistedReasoningEffort ?? "");
      void revalidateSettingsState();
      const result = await startReaderTranslation({
        langCode: persistedLanguage,
        memoryId: readerGeneration.memoryId,
        model: persistedModel,
        reasoningEffort: persistedReasoningEffort,
      });
      if (!isCurrentTranslationRequest()) {
        return;
      }
      if (
        result.memory_id !== readerGeneration.memoryId ||
        result.lang_code !== persistedLanguage
      ) {
        throw new Error("Translation response did not match the active reader.");
      }

      if (result.status === "current") {
        setTranslationProgress(undefined);
        input.close();
        navigate(result.reader_url);
        return;
      }

      setTranslationProgress({
        eventUrl: result.event_url,
        jobId: result.job_id,
        message: result.status === "active"
          ? "Translation is already running."
          : "Translation queued.",
        preview: "",
        status: "running",
      });
      input.close();
      connectTranslationProgress(
        result.event_url,
        result.job_id,
        readerGeneration,
      );
    } catch (error) {
      if (isCurrentTranslationRequest()) {
        setTranslationProgress({
          eventUrl: "",
          jobId: "",
          message: error instanceof Error ? error.message : "Translation failed.",
          preview: "",
          status: "failed",
        });
      }
    } finally {
      if (requestGeneration === translationRequestGeneration) {
        setTranslationSubmitPending(false);
      }
    }
  };
  createEffect(() => {
    syncReaderSectionMomentButtons({
      container: contentRef,
      moments: moments(),
      toc: props.result.rendered.toc,
    });
  });
  createEffect(() => {
    props.result.memory.id;
    readerBodyHtml();
    scheduleReaderHashTargetScroll(readerRootRef);
  });
  const recomputeActiveTocRange = (): void => {
    const toc = props.result.rendered.toc;
    if (toc.length === 0 || typeof window === "undefined") {
      setActiveTocRange(emptyActiveTocRange);
      return;
    }

    const positions = readReaderHeadingPositions(readerRootRef);
    const next = computeVisibleTocRange(positions, window.innerHeight);
    setActiveTocRange((current) =>
      isSameActiveTocRange(current, next) ? current : next
    );
  };
  let activeTocRangeFrame: number | undefined;
  let activeTocScrollSpy: ReaderTocScrollSpyBinding | undefined;
  const requestActiveTocRange = (): void => {
    if (typeof window === "undefined" || activeTocRangeFrame !== undefined) {
      return;
    }

    activeTocRangeFrame = window.requestAnimationFrame(() => {
      activeTocRangeFrame = undefined;
      recomputeActiveTocRange();
    });
  };
  const scheduleActiveTocRange = (): void => {
    if (activeTocScrollSpy?.isEnabled() === true) {
      requestActiveTocRange();
    }
  };
  const cancelActiveTocRange = (): void => {
    if (activeTocRangeFrame === undefined) {
      return;
    }

    window.cancelAnimationFrame(activeTocRangeFrame);
    activeTocRangeFrame = undefined;
  };
  createEffect(() => {
    props.result.memory.id;
    readerBodyHtml();
    if (isReaderClientReady()) {
      scheduleActiveTocRange();
    }
  });
  onMount(() => {
    activeTocScrollSpy = bindReaderTocScrollSpy({
      cancel: cancelActiveTocRange,
      schedule: requestActiveTocRange,
      target: window,
    });
    onCleanup(() => {
      activeTocScrollSpy?.dispose();
      activeTocScrollSpy = undefined;
      cancelActiveTocRange();
    });
  });
  const toggleMoment = async (
    section: ReaderMomentSection,
  ): Promise<void> => {
    const readerGeneration = captureReaderGeneration();
    const sectionKey = getReaderMomentKey(section);
    if (
      pendingMomentKey().length > 0 ||
      !isCurrentReaderGeneration(readerGeneration)
    ) {
      return;
    }

    const readerToc = props.result.rendered.toc;
    setErrorMessage("");
    setPendingMomentKey(sectionKey);
    try {
      const existingMoment = findReaderMomentForSection(
        moments(),
        readerToc,
        section,
      );
      if (existingMoment !== undefined) {
        await deleteMomentById({ momentId: existingMoment.id });
        if (!isCurrentReaderGeneration(readerGeneration)) {
          return;
        }

        setMoments((current) =>
          current.filter((moment) => moment.id !== existingMoment.id),
        );
        await Promise.all([
          revalidateMomentBrowseRows(),
          revalidateReaderMemory(
            readerGeneration.memoryId,
            readerGeneration.langCode,
          ),
        ]);
        return;
      }

      const result = await createMomentForSection({
        langCode: readerGeneration.langCode,
        memoryId: readerGeneration.memoryId,
        section,
      });
      if (!isCurrentReaderGeneration(readerGeneration)) {
        return;
      }

      setMoments((current) =>
        mergeReaderMomentItem(current, result.moment),
      );
      await Promise.all([
        revalidateMomentBrowseRows(),
        revalidateReaderMemory(
          readerGeneration.memoryId,
          readerGeneration.langCode,
        ),
      ]);
    } catch (error) {
      if (isCurrentReaderGeneration(readerGeneration)) {
        setErrorMessage(error instanceof Error ? error.message : "Moment failed");
      }
    } finally {
      if (isCurrentReaderGeneration(readerGeneration)) {
        setPendingMomentKey("");
      }
    }
  };
  const handleReaderContentClick = (event: MouseEvent) => {
    const trigger = findReaderMomentTrigger(event.target, contentRef);
    if (trigger === undefined) {
      return;
    }

    const sectionElement = findReaderSectionElement(trigger, contentRef);
    if (sectionElement === undefined) {
      return;
    }

    const section = readReaderSection(sectionElement);
    if (section === undefined) {
      return;
    }

    event.preventDefault();
    void toggleMoment(section);
  };
  const handleReaderContentPointerDown = (event: PointerEvent) => {
    clearSectionLongPress();
    if (event.button !== 0) {
      return;
    }
    if (findReaderMomentTrigger(event.target, contentRef) !== undefined) {
      return;
    }

    const sectionElement = findReaderSectionElement(event.target, contentRef);
    const section = sectionElement === undefined
      ? undefined
      : readReaderSection(sectionElement);
    if (section === undefined || sectionElement === undefined) {
      return;
    }

    sectionLongPressTimer = window.setTimeout(() => {
      openSectionMenu(section, sectionElement.getBoundingClientRect());
    }, 500);
  };
  const clearSectionLongPress = () => {
    if (sectionLongPressTimer === undefined) {
      return;
    }

    window.clearTimeout(sectionLongPressTimer);
    sectionLongPressTimer = undefined;
  };

  return (
    <article ref={readerRootRef} class={readerFrame} aria-label="Memory">
      <div
        ref={topBarRef}
        class="trauma-reader-topbar"
        data-reader-topbar
        data-topbar-hidden={topBarHidden() ? "true" : "false"}
        onFocusIn={() => setTopBarHidden(false)}
      >
        <RouteHeader
          actions={
            <div class="flex items-center gap-2">
              <ReaderVariantTabs
                compact
                variants={props.result.content.variants}
              />
              <button
                ref={inspectorTriggerRef}
                aria-controls="reader-inspector-dialog"
                aria-expanded={inspectorOpen()}
                aria-label={inspectorOpen() ? "Close Inspector" : "Open Inspector"}
                class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-trauma-border-strong bg-trauma-bg-elev px-3 py-1.5 text-xs font-extrabold text-trauma-text-primary transition hover:bg-trauma-bg-tint"
                data-reader-inspector-trigger
                title="Inspector (])"
                type="button"
                onClick={toggleInspector}
              >
                <span>Inspector</span>
              </button>
            </div>
          }
          class={`${readerPadding} trauma-reader-header`}
          leading={() => (
            <a
              class="grid size-10 place-items-center rounded-full text-trauma-text-muted hover:bg-trauma-bg-elev hover:text-trauma-text-primary"
              href="/memories"
              aria-label="Back to memories"
            >
              <ChevronLeftIcon />
            </a>
          )}
          layout="split"
          title={props.result.memory.title}
          titleElement="p"
        />
      </div>

      <ReaderLandmarkRail
        activeTocRange={activeTocRange}
        expanded={landmarkExpanded()}
        moments={moments()}
        onCreateMoment={(section) => void toggleMoment(section)}
        onExpandedChange={setLandmarkExpanded}
        onOpenSectionMenu={openSectionMenu}
        pendingMomentKey={pendingMomentKey()}
        toc={props.result.rendered.toc}
      />

      <div class={`${readerPadding} trauma-reader-body py-6 pb-12`}>
        <div class={readerColumn} data-reader-column>
          <div
            ref={contentRef}
            aria-busy={pendingSelectionKey().length > 0}
            class={readerArticle}
            data-reader-content
            data-reader-ready={isReaderClientReady() ? "true" : undefined}
            onClick={handleReaderContentClick}
            onKeyDown={handleKeyboardSelectionKeyDown}
            onKeyUp={handleKeyboardSelectionToggle}
            onMouseUp={openSelectionMenu}
            onPointerCancel={clearSectionLongPress}
            onPointerLeave={clearSectionLongPress}
            onPointerMove={clearSectionLongPress}
            onPointerUp={clearSectionLongPress}
            onPointerDown={handleReaderContentPointerDown}
            tabIndex={0}
          >
            <div class="mb-3">
              <Show
                when={readerTitleHtml()}
                fallback={(
                  <h1
                    class="mb-0 text-[clamp(2rem,8cqi,3.35rem)] font-extrabold leading-[1.03] text-trauma-text-primary"
                    data-reader-noncontent
                  >
                    {props.result.memory.title}
                  </h1>
                )}
              >
                {(titleHtml) => (
                  <div
                    class="trauma-reader-lifted-title"
                    data-reader-offset-content
                    data-reader-noncontent
                    innerHTML={titleHtml()}
                  />
                )}
              </Show>
            </div>
            <div
              class="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-trauma-text-muted"
              data-reader-meta-line
              data-reader-noncontent
            >
              <span>{domainLabel()}</span>
              <Show when={lengthBucket()}>
                {(bucket) => (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{bucket()}</span>
                  </>
                )}
              </Show>
              <Show when={props.result.content.variants.length > 1}>
                <span aria-hidden="true">·</span>
                <ReaderVariantTabs
                  inline
                  variants={props.result.content.variants}
                />
              </Show>
            </div>
            <div
              ref={bodyContentRef}
              class="contents"
              data-reader-mutable-content
              innerHTML={readerBodyHtml()}
            />
          </div>

          <ReaderEndFooter
            experimentLogEnabled={experimentLogEnabled()}
            onPulse={handleEndFooterPulse}
            onTriage={(nextState) => void handleEndFooterTriage(nextState)}
            pulseNotice={endPulseNotice()}
            triagePending={triagePending()}
            triageState={triageState()}
            triageStatus={triageStatus()}
          />

          <Show when={errorMessage()}>
            {(message) => (
              <p
                class="mt-4 rounded-lg border border-trauma-danger bg-trauma-bg-elev px-3 py-2 text-sm font-semibold text-trauma-danger"
                role="alert"
              >
                {message()}
              </p>
            )}
          </Show>
        </div>
      </div>

      <ReadingRulerOverlay />
      <ResumptionBeacon
        memoryId={props.result.memory.id}
        activeVariant={activeVariant()}
        lastPosition={currentLastPosition()}
        getBodyContainer={() => bodyContentRef}
        getRootContainer={() => readerRootRef}
      />

      <Show when={inspectorOpen()}>
        <aside
          ref={inspectorRef}
          id="reader-inspector-dialog"
          aria-label="Reader Inspector"
          class="trauma-reader-inspector flex flex-col border-l border-trauma-border bg-trauma-bg-elev text-trauma-text-primary shadow-trauma-drawer min-[1440px]:shadow-none"
          data-reader-inspector="open"
          role="dialog"
        >
          <header class="flex items-center justify-between gap-2 border-b border-trauma-border px-4 py-3">
            <h2 class="mb-0 text-sm font-extrabold text-trauma-text-primary">
              Inspector
            </h2>
            <button
              ref={inspectorCloseRef}
              aria-label="Close Inspector"
              class="inline-flex min-h-8 items-center justify-center rounded-full border border-trauma-border px-2.5 text-xs font-bold text-trauma-text-secondary hover:bg-trauma-bg-tint hover:text-trauma-text-primary"
              type="button"
              onClick={closeInspector}
            >
              Close
            </button>
          </header>

          <div
            aria-label="Inspector sections"
            class="grid grid-cols-5 gap-1 border-b border-trauma-border bg-trauma-bg-base/60 px-2 py-1.5"
            role="tablist"
          >
            <For each={READER_INSPECTOR_TABS}>
              {(tab) => {
                const selected = () => inspectorTab() === tab.id;
                return (
                  <button
                    aria-controls={`inspector-panel-${tab.id}`}
                    aria-selected={selected()}
                    class={`min-h-8 truncate rounded-lg px-1.5 text-[11px] font-bold transition ${
                      selected()
                        ? "bg-trauma-bg-elev text-trauma-text-primary ring-1 ring-inset ring-trauma-border-strong"
                        : "text-trauma-text-muted hover:bg-trauma-bg-tint hover:text-trauma-text-primary"
                    }`}
                    data-inspector-tab={tab.id}
                    id={`inspector-tab-${tab.id}`}
                    role="tab"
                    type="button"
                    onClick={() => selectInspectorTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                );
              }}
            </For>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            <Show when={inspectorTab() === "outline"}>
              <div
                aria-labelledby="inspector-tab-outline"
                id="inspector-panel-outline"
                role="tabpanel"
              >
                <ReaderToc
                  activeTocRange={activeTocRange}
                  moments={moments()}
                  onCreateMoment={(section) => void toggleMoment(section)}
                  onOpenSectionMenu={openSectionMenu}
                  pendingMomentKey={pendingMomentKey()}
                  toc={props.result.rendered.toc}
                />
              </div>
            </Show>

            <Show when={inspectorTab() === "marks"}>
              <div
                aria-labelledby="inspector-tab-marks"
                class="grid gap-4"
                id="inspector-panel-marks"
                role="tabpanel"
              >
                <section class="rounded-[20px] border border-trauma-border bg-trauma-bg-base p-4">
                  <h3 class="mb-2 text-sm font-extrabold text-trauma-text-primary">
                    Moments
                  </h3>
                  <Show
                    when={moments().length > 0}
                    fallback={
                      <p class="mb-0 text-xs text-trauma-text-muted">
                        No moments for this memory yet.
                      </p>
                    }
                  >
                    <ul class="grid list-none gap-1.5 pl-0">
                      <For each={moments()}>
                        {(moment) => {
                          const target = () =>
                            resolveReaderMomentTarget(
                              moment,
                              props.result.rendered.toc,
                            );
                          const anchor = () =>
                            target()?.id ?? moment.sectionAnchor;
                          return (
                            <li class="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-trauma-bg-tint">
                              <a
                                class="min-w-0 flex-1 truncate text-xs font-bold text-trauma-text-primary hover:underline"
                                href={buildSameMemoryAnchorHref(anchor())}
                              >
                                {moment.sectionTitle}
                              </a>
                              <button
                                aria-label={`Remove moment ${moment.sectionTitle}`}
                                class="rounded-full px-2 py-0.5 text-[11px] font-bold text-trauma-text-muted hover:bg-trauma-bg-elev hover:text-trauma-danger"
                                type="button"
                                onClick={() =>
                                  void toggleMoment({
                                    id: anchor(),
                                    level: moment.sectionLevel,
                                    path: moment.sectionPath,
                                    text: moment.sectionTitle,
                                  })
                                }
                              >
                                Remove
                              </button>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </Show>
                </section>
                <ReaderFlashbackTabs
                  allFlashbacks={props.flashbackRows}
                  currentFlashbacks={currentFlashbacks()}
                  memoryId={props.result.memory.id}
                />
              </div>
            </Show>

            <Show when={inspectorTab() === "translate"}>
              <div
                aria-labelledby="inspector-tab-translate"
                class="grid gap-4"
                id="inspector-panel-translate"
                role="tabpanel"
              >
                <ReaderVariantTabs variants={props.result.content.variants} />
                <Show when={translationProgress()}>
                  {(progress) => (
                    <section
                      aria-live={
                        progress().status === "failed" ? "assertive" : "polite"
                      }
                      class="grid gap-2 rounded-2xl border border-trauma-border bg-trauma-bg-base px-3 py-2.5 text-sm font-bold text-trauma-text-secondary"
                      role={progress().status === "failed" ? "alert" : "status"}
                    >
                      <div class="flex items-center gap-2 text-trauma-text-primary">
                        <CodexIcon size={16} />
                        <span>{progress().message}</span>
                      </div>
                      <Show when={progress().preview.trim()}>
                        {(preview) => (
                          <p class="mb-0 max-h-20 overflow-hidden text-xs leading-relaxed text-trauma-text-muted">
                            {preview()}
                          </p>
                        )}
                      </Show>
                    </section>
                  )}
                </Show>
                <Show
                  when={canOpenTranslationSettings()}
                  fallback={
                    <p class="mb-0 text-xs text-trauma-text-muted">
                      {isTranslatedReader()
                        ? "Viewing a translated variant. Switch to Original to start another translation."
                        : "All supported translations are already available."}
                    </p>
                  }
                >
                  <form
                    aria-busy={translationSubmitPending()}
                    class="grid gap-3"
                    onSubmit={submitTranslationDialog(() => undefined)}
                  >
                    <label class="grid gap-1 text-xs font-extrabold text-trauma-text-secondary">
                      Language
                      <select
                        aria-label="Language"
                        class="min-h-10 w-full min-w-0 rounded-lg border border-trauma-border-strong bg-trauma-bg-surface px-3 text-sm font-bold text-trauma-text-primary"
                        disabled={translationSubmitPending()}
                        value={translationFormLanguage()}
                        onChange={(event) =>
                          setTranslationFormLanguage(
                            event.currentTarget.value as SupportedLanguageCode,
                          )
                        }
                      >
                        {SUPPORTED_TRANSLATION_LANGUAGES.map((option) => (
                          <option
                            selected={translationFormLanguage() === option.code}
                            value={option.code}
                          >
                            {option.label} ({option.code})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label class="grid gap-1 text-xs font-extrabold text-trauma-text-secondary">
                      Model
                      <select
                        ref={translationModelSelectRef}
                        aria-label="Model"
                        class="min-h-10 w-full min-w-0 rounded-lg border border-trauma-border-strong bg-trauma-bg-surface px-3 text-sm font-bold text-trauma-text-primary"
                        disabled={translationSubmitPending()}
                        value={translationFormModel()}
                        onChange={(event) =>
                          setTranslationFormModel(event.currentTarget.value)
                        }
                      >
                        <option
                          selected={translationFormModel() === ""}
                          value=""
                        >
                          Codex app-server default
                        </option>
                        <Show
                          when={
                            translationFormModel() !== "" &&
                            !translationCatalogModels().some(
                              (model) => model.model === translationFormModel(),
                            )
                          }
                        >
                          <option selected value={translationFormModel()}>
                            {translationFormModel()}
                          </option>
                        </Show>
                        {translationCatalogModels().map((model) => (
                          <option
                            selected={translationFormModel() === model.model}
                            value={model.model}
                          >
                            {model.displayName} ({model.model})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label class="grid gap-1 text-xs font-extrabold text-trauma-text-secondary">
                      Reasoning effort
                      <select
                        aria-label="Reasoning effort"
                        class="min-h-10 w-full min-w-0 rounded-lg border border-trauma-border-strong bg-trauma-bg-surface px-3 text-sm font-bold text-trauma-text-primary"
                        disabled={translationSubmitPending()}
                        value={translationFormEffort()}
                        onChange={(event) =>
                          setTranslationFormEffort(
                            event.currentTarget.value as
                              | CodexReasoningEffort
                              | "",
                          )
                        }
                      >
                        <option
                          selected={translationFormEffort() === ""}
                          value=""
                        >
                          Selected model default
                        </option>
                        <Show
                          when={
                            translationFormEffort() !== "" &&
                            !translationReasoningEfforts().includes(
                              translationFormEffort() as CodexReasoningEffort,
                            )
                          }
                        >
                          <option selected value={translationFormEffort()}>
                            {translationFormEffort()}
                          </option>
                        </Show>
                        {translationReasoningEfforts().map((effort) => (
                          <option
                            selected={translationFormEffort() === effort}
                            value={effort}
                          >
                            {effort}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Show when={translationCatalogError()}>
                      {(value) => (
                        <div
                          aria-busy={translationCatalogPending()}
                          aria-live="assertive"
                          class="grid justify-items-start gap-2"
                          role="alert"
                        >
                          <p class="mb-0 text-xs font-bold text-trauma-text-muted">
                            {value()}
                          </p>
                          <button
                            aria-label={
                              translationCatalogPending()
                                ? "Retrying model catalog..."
                                : "Retry model catalog"
                            }
                            class="inline-flex min-h-9 items-center justify-center rounded-full border border-trauma-border-strong px-3 text-sm font-extrabold text-trauma-text-primary disabled:opacity-60"
                            disabled={translationCatalogPending()}
                            type="button"
                            onClick={(event) =>
                              retryTranslationCatalog(event.currentTarget)
                            }
                          >
                            {translationCatalogPending()
                              ? "Retrying..."
                              : "Retry"}
                          </button>
                        </div>
                      )}
                    </Show>
                    <div class="flex justify-end gap-2">
                      <button
                        class="inline-flex min-h-9 items-center justify-center rounded-full border border-trauma-border-strong px-3 text-sm font-extrabold text-trauma-text-primary"
                        disabled={translationSubmitPending()}
                        type="button"
                        onClick={resetTranslationFormToDefaults}
                      >
                        Cancel
                      </button>
                      <button
                        class="inline-flex min-h-9 items-center justify-center rounded-full border border-trauma-border-strong bg-trauma-accent px-3 text-sm font-extrabold text-trauma-accent-ink transition hover:bg-trauma-accent-hover"
                        disabled={translationSubmitPending()}
                        type="submit"
                      >
                        Translate
                      </button>
                    </div>
                  </form>
                </Show>
              </div>
            </Show>

            <Show when={inspectorTab() === "details"}>
              <div
                aria-labelledby="inspector-tab-details"
                class="grid gap-4"
                id="inspector-panel-details"
                role="tabpanel"
              >
                <div class="grid gap-1">
                  <p class="mb-0 text-[11px] font-bold uppercase tracking-wide text-trauma-text-muted">
                    Source URL
                  </p>
                  <Show
                    when={sourceHref()}
                    fallback={(
                      <ScrollableUrlDisplay
                        class={readerSourceLinkClass}
                        url={sourceUrl()}
                      />
                    )}
                  >
                    {(href) => (
                      <ScrollableUrlLink
                        class={`${readerSourceLinkClass} hover:text-trauma-link-hover hover:underline`}
                        href={href()}
                        rel="noreferrer"
                        target="_blank"
                        url={sourceUrl()}
                      />
                    )}
                  </Show>
                </div>

                <Show when={capturedDateLabel()}>
                  {(capturedDate) => (
                    <div class="grid gap-0.5">
                      <p class="mb-0 text-[11px] font-bold uppercase tracking-wide text-trauma-text-muted">
                        Captured
                      </p>
                      <p class="mb-0 text-sm font-medium text-trauma-text-primary">
                        {capturedDate()}
                      </p>
                    </div>
                  )}
                </Show>

                <div class="grid gap-1.5">
                  <p class="mb-0 text-[11px] font-bold uppercase tracking-wide text-trauma-text-muted">
                    Read status
                  </p>
                  <MemoryReadStatusControl
                    initialRead={readState()}
                    memoryId={props.result.memory.id}
                    variant="label"
                    onChange={setReadState}
                    onSaved={() =>
                      revalidateAfterReadStatusChange(
                        props.result.memory.id,
                        props.result.content.langCode,
                      )
                    }
                  />
                </div>

                <div class="grid gap-1.5">
                  <p class="mb-0 text-[11px] font-bold uppercase tracking-wide text-trauma-text-muted">
                    Categories &amp; Tags
                  </p>
                  <ReaderTaxonomyChips
                    categories={categories()}
                    memoryId={props.result.memory.id}
                    tagOptions={props.tagOptions}
                    tags={tags()}
                    onAddTag={attachTag}
                    onRemoveTag={detachTag}
                    onTaxonomyError={setErrorMessage}
                  />
                </div>

                <div class="flex items-center justify-end gap-2 border-t border-trauma-divider pt-3">
                  <MemoryActionMenu
                    memoryId={props.result.memory.id}
                    memoryTitle={props.result.memory.title}
                    attachedCategories={categories()}
                    categoryOptions={props.categoryOptions}
                    onAttachCategoryByName={attachCategory}
                    onDelete={deleteMemory}
                  />
                </div>
              </div>
            </Show>

            <Show when={inspectorTab() === "psychiatrist"}>
              <div
                aria-labelledby="inspector-tab-psychiatrist"
                class="h-full min-h-[24rem]"
                id="inspector-panel-psychiatrist"
                role="tabpanel"
              >
                <PsychiatristDock
                  embedded
                  langCode={props.result.content.langCode}
                  memoryId={props.result.memory.id}
                  onClose={closeInspector}
                />
              </div>
            </Show>
          </div>
        </aside>
      </Show>

      <Show when={selectionMenu()}>
        {(menu) => (
          <ReaderContextMenu
            label="Reader text selection actions"
            menuRef={(element) => {
              selectionMenuRef = element;
            }}
            onDismiss={dismissSelectionMenu}
            position={menu().position}
          >
            <button
              aria-label="Flashback selection"
              class="grid size-10 place-items-center rounded-full text-trauma-text-primary hover:bg-trauma-bg-tint"
              title="Flashback selection"
              disabled={pendingSelectionKey() === menu().key}
              type="button"
              onClick={commitSelectionMenu}
            >
              {TraumaNavIcons.flashbacks.filled({ size: 18 })}
            </button>
            <Show when={menu().momentSection}>
              {(section) => (
                <button
                  aria-label="Moment selected section"
                  class="grid size-10 place-items-center rounded-full text-trauma-text-primary hover:bg-trauma-bg-tint"
                  title="Moment selected section"
                  disabled={pendingMomentKey() === getReaderMomentKey(section())}
                  type="button"
                  onClick={commitSelectionMomentMenu}
                >
                  {TraumaNavIcons.moment.filled({ size: 18 })}
                </button>
              )}
            </Show>
          </ReaderContextMenu>
        )}
      </Show>
      <Show when={sectionMenu()}>
        {(menu) => (
          <ReaderContextMenu
            label="Reader section actions"
            menuRef={(element) => {
              sectionMenuRef = element;
            }}
            onDismiss={dismissSectionMenu}
            position={menu().position}
          >
            <button
              aria-label="Moment section"
              class="grid size-10 place-items-center rounded-full text-trauma-text-primary hover:bg-trauma-bg-tint"
              title="Moment section"
              disabled={pendingMomentKey() === menu().key}
              type="button"
              onClick={commitSectionMenu}
            >
              {TraumaNavIcons.moment.filled({ size: 18 })}
            </button>
          </ReaderContextMenu>
        )}
      </Show>
    </article>
  );
}

function ReaderLandmarkRail(props: {
  activeTocRange: Accessor<ActiveTocRange>;
  expanded: boolean;
  moments: ReaderMomentItem[];
  onCreateMoment: (section: ReaderMomentSection) => void;
  onExpandedChange: (expanded: boolean) => void;
  onOpenSectionMenu: (section: ReaderMomentSection, rect: DOMRect) => void;
  pendingMomentKey: string;
  toc: ReaderTocEntry[];
}) {
  const activeLeadIndex = createMemo(() => {
    const leadId = props.activeTocRange().leadId;
    if (leadId === undefined) {
      return -1;
    }
    return props.toc.findIndex((entry) => entry.id === leadId);
  });

  return (
    <Show when={props.toc.length > 0}>
      <nav
        aria-label="Reading landmarks"
        class="trauma-reader-landmark-rail max-[1040px]:hidden"
        data-landmark-expanded={props.expanded ? "true" : "false"}
        data-reader-landmark-rail
        onFocusIn={() => props.onExpandedChange(true)}
        onFocusOut={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            props.onExpandedChange(false);
          }
        }}
        onPointerEnter={() => props.onExpandedChange(true)}
        onPointerLeave={() => props.onExpandedChange(false)}
      >
        <Show
          when={props.expanded}
          fallback={
            <ol class="m-0 flex list-none flex-col items-center gap-2 rounded-full border border-transparent p-1.5">
              <For each={props.toc}>
                {(entry, index) => {
                  const isCurrent = () =>
                    props.activeTocRange().leadId === entry.id;
                  const isVisited = () =>
                    activeLeadIndex() >= 0 && index() <= activeLeadIndex();
                  return (
                    <li>
                      <a
                        aria-current={isCurrent() ? "location" : undefined}
                        aria-label={entry.text}
                        class="grid size-5 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent"
                        href={`#${entry.id}`}
                        title={entry.text}
                      >
                        <span
                          aria-hidden="true"
                          class="trauma-reader-landmark-node"
                          data-landmark-current={isCurrent() ? "true" : "false"}
                          data-landmark-visited={isVisited() ? "true" : "false"}
                        />
                      </a>
                    </li>
                  );
                }}
              </For>
            </ol>
          }
        >
          <div class="w-[260px] rounded-[22px] border border-trauma-border bg-trauma-bg-elev/95 p-1 shadow-trauma-2 backdrop-blur">
            <ReaderToc
              activeTocRange={props.activeTocRange}
              moments={props.moments}
              onCreateMoment={props.onCreateMoment}
              onOpenSectionMenu={props.onOpenSectionMenu}
              pendingMomentKey={props.pendingMomentKey}
              toc={props.toc}
            />
          </div>
        </Show>
      </nav>
    </Show>
  );
}

function ReaderEndFooter(props: {
  experimentLogEnabled: boolean;
  onPulse: (rating: FocusPluginPulseRating) => void;
  onTriage: (nextState: MemoryTriageState) => void;
  pulseNotice: string;
  triagePending: boolean;
  triageState: MemoryTriageState | undefined;
  triageStatus: string;
}) {
  return (
    <footer
      aria-label="End of article"
      class="trauma-reader-end-footer mt-16 grid gap-4 border-t border-trauma-border pt-8 pb-12"
      data-reader-end-footer
    >
      <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Finish reading triage">
        <button
          aria-pressed={props.triageState === "library"}
          class={`inline-flex min-h-9 items-center justify-center rounded-full border px-4 text-xs font-extrabold transition ${
            props.triageState === "library"
              ? "border-trauma-accent bg-trauma-accent-soft text-trauma-accent-soft-ink"
              : "border-trauma-border-strong bg-trauma-bg-elev text-trauma-text-primary hover:bg-trauma-bg-tint"
          }`}
          data-end-triage="library"
          disabled={props.triagePending}
          type="button"
          onClick={() => props.onTriage("library")}
        >
          Keep
        </button>
        <button
          aria-pressed={props.triageState === "archive"}
          class={`inline-flex min-h-9 items-center justify-center rounded-full border px-4 text-xs font-extrabold transition ${
            props.triageState === "archive"
              ? "border-trauma-accent bg-trauma-accent-soft text-trauma-accent-soft-ink"
              : "border-trauma-border-strong bg-trauma-bg-elev text-trauma-text-primary hover:bg-trauma-bg-tint"
          }`}
          data-end-triage="archive"
          disabled={props.triagePending}
          type="button"
          onClick={() => props.onTriage("archive")}
        >
          Let go
        </button>
        <button
          aria-pressed={props.triageState === "shelf"}
          class={`inline-flex min-h-9 items-center justify-center rounded-full border px-4 text-xs font-extrabold transition ${
            props.triageState === "shelf"
              ? "border-trauma-accent bg-trauma-accent-soft text-trauma-accent-soft-ink"
              : "border-trauma-border-strong bg-trauma-bg-elev text-trauma-text-primary hover:bg-trauma-bg-tint"
          }`}
          data-end-triage="shelf"
          disabled={props.triagePending}
          type="button"
          onClick={() => props.onTriage("shelf")}
        >
          Not now
        </button>
        <Show when={props.triageStatus !== ""}>
          <span class="text-xs font-medium text-trauma-text-muted" role="status">
            {props.triageStatus}
          </span>
        </Show>
      </div>

      <Show when={props.experimentLogEnabled}>
        <div class="flex flex-wrap items-center gap-2" data-reader-end-pulse>
          <span class="text-xs font-medium text-trauma-text-muted">
            How did this session feel?
          </span>
          <div
            aria-label="Reading focus pulse"
            class="flex flex-wrap items-center gap-1.5"
            role="group"
          >
            <For each={READER_PULSE_OPTIONS}>
              {(option) => (
                <button
                  class="inline-flex min-h-7 items-center justify-center rounded-full border border-trauma-border-strong bg-trauma-bg-base px-2.5 text-[11px] font-bold text-trauma-text-primary hover:bg-trauma-bg-elev"
                  type="button"
                  onClick={() => props.onPulse(option.rating)}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
          <Show when={props.pulseNotice !== ""}>
            <span class="text-xs font-medium text-trauma-text-muted" role="status">
              {props.pulseNotice}
            </span>
          </Show>
        </div>
      </Show>
    </footer>
  );
}

function ReaderVariantTabs(props: {
  compact?: boolean;
  inline?: boolean;
  variants: ReaderContentVariant[];
}) {
  return (
    <Show when={props.variants.length > 1}>
      <nav
        aria-label="Memory content variants"
        class={
          props.inline
            ? "inline-flex flex-wrap items-center gap-1.5"
            : props.compact
              ? "flex items-center gap-1"
              : "mb-2 flex flex-wrap gap-2 border-b border-trauma-border pb-3"
        }
      >
        <For each={props.variants}>
          {(variant) => (
            <a
              aria-current={variant.active ? "page" : undefined}
              class={
                props.inline
                  ? "rounded px-1.5 py-0.5 text-xs font-semibold text-trauma-text-muted transition hover:text-trauma-text-primary aria-[current=page]:bg-trauma-bg-elev aria-[current=page]:text-trauma-text-primary"
                  : props.compact
                    ? "inline-flex min-h-8 items-center rounded-full border border-trauma-border px-2.5 text-xs font-bold text-trauma-text-secondary transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary aria-[current=page]:bg-trauma-bg-elev aria-[current=page]:text-trauma-text-primary"
                    : "inline-flex min-h-9 items-center rounded-full border border-trauma-border-strong px-3 text-sm font-extrabold text-trauma-text-secondary transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary aria-[current=page]:bg-trauma-bg-elev aria-[current=page]:text-trauma-text-primary"
              }
              href={variant.readerUrl}
            >
              {variant.label}
            </a>
          )}
        </For>
      </nav>
    </Show>
  );
}

function ReaderTaxonomyChips(props: {
  categories: ReaderTaxonomyItem[];
  memoryId: string;
  tagOptions: readonly BrowseTaxonomySummaryItem[];
  tags: ReaderTaxonomyItem[];
  onAddTag: (name: string) => Promise<void> | void;
  onRemoveTag: (name: string) => Promise<void> | void;
  onTaxonomyError: (message: string) => void;
}) {
  return (
    <div class="mt-4 trauma-local-wrap">
      <TaxonomyList
        class="contents"
        items={props.categories}
        kind="category"
        mode="chips"
      />
      <TaxonomyList
        class="contents"
        items={props.tags}
        kind="tag"
        mode="chips"
      />
      <div class="relative inline-grid">
        <TaxonomyAddControl
          attachedItems={props.tags}
          id={`memory-${props.memoryId}-tags-add`}
          kind="tag"
          options={props.tagOptions}
          onAttachName={props.onAddTag}
          onDetachName={props.onRemoveTag}
          onError={props.onTaxonomyError}
        />
      </div>
    </div>
  );
}

type ReaderTranslationStartResult =
  | {
      status: "current";
      job_id: string;
      memory_id: string;
      lang_code: SupportedLanguageCode;
      source_hash: string;
      output_path: string;
      reader_url: string;
    }
  | {
      status: "active";
      job_status: string;
      job_id: string;
      memory_id: string;
      lang_code: SupportedLanguageCode;
      source_hash: string;
      event_url: string;
    }
  | {
      status: "started";
      job_id: string;
      memory_id: string;
      lang_code: SupportedLanguageCode;
      source_hash: string;
      event_url: string;
    };

interface ReaderTranslationEventEnvelope {
  chunkIndex: number | null;
  type: string;
  data: unknown;
}

const TRANSLATION_EVENT_NAMES = [
  "translation.job.snapshot",
  "translation.job.started",
  "translation.chunk.queued",
  "translation.chunk.started",
  "translation.codex.delta",
  "translation.codex.item.started",
  "translation.codex.item.completed",
  "translation.chunk.validating",
  "translation.chunk.completed",
  "translation.chunk.failed",
  "translation.chunk.retrying",
  "translation.job.stitching",
  "translation.job.committing",
  "translation.job.completed",
  "translation.job.failed",
  "translation.job.stale",
  "translation.job.canceled",
] as const;

const TERMINAL_TRANSLATION_SNAPSHOT_STATUSES = new Set([
  "canceled",
  "complete",
  "failed",
  "stale",
  "unavailable",
]);

export async function startReaderTranslation(input: {
  fetch?: FetchFunction;
  langCode: SupportedLanguageCode;
  memoryId: string;
  model?: string | null;
  reasoningEffort?: string | null;
}): Promise<ReaderTranslationStartResult> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch(
    `/api/memories/${input.memoryId}/translations`,
    {
      body: JSON.stringify({
        lang_code: input.langCode,
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.reasoningEffort === undefined
          ? {}
          : { reasoning_effort: input.reasoningEffort }),
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(await readTranslationFailureMessage(response));
  }

  const payload: unknown = await response.json();
  if (!isReaderTranslationStartResult(payload)) {
    throw new Error("Translation response was invalid.");
  }

  return payload;
}

async function readTranslationFailureMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload)) {
      const code = typeof payload.code === "string"
        ? payload.code
        : undefined;
      if (typeof payload.message === "string") {
        return messageForTranslationError(code, payload.message);
      }
      const error = payload.error;
      if (typeof error === "string") {
        return error;
      }
      if (isRecord(error) && typeof error.message === "string") {
        return messageForTranslationError(
          typeof error.code === "string" ? error.code : undefined,
          error.message,
        );
      }
      if (code !== undefined) {
        return messageForTranslationError(code, undefined);
      }
    }
  } catch {
    return "Translation failed.";
  }

  return "Translation failed.";
}

function isReaderTranslationStartResult(
  value: unknown,
): value is ReaderTranslationStartResult {
  if (!isRecord(value) || typeof value.status !== "string") {
    return false;
  }
  if (
    value.status === "started" ||
    value.status === "active"
  ) {
    return (
      typeof value.event_url === "string" &&
      typeof value.job_id === "string" &&
      typeof value.lang_code === "string" &&
      typeof value.memory_id === "string" &&
      typeof value.source_hash === "string"
    );
  }
  if (value.status === "current") {
    return (
      typeof value.job_id === "string" &&
      typeof value.lang_code === "string" &&
      typeof value.memory_id === "string" &&
      typeof value.output_path === "string" &&
      typeof value.reader_url === "string" &&
      typeof value.source_hash === "string"
    );
  }

  return false;
}

function parseTranslationEventEnvelope(
  raw: string,
): ReaderTranslationEventEnvelope | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      return undefined;
    }
    return {
      chunkIndex: typeof parsed.chunk_index === "number"
        ? parsed.chunk_index
        : null,
      data: parsed.data,
      type: parsed.type,
    };
  } catch {
    return undefined;
  }
}

function messageForTranslationEvent(
  envelope: ReaderTranslationEventEnvelope,
): string {
  switch (envelope.type) {
    case "translation.job.snapshot":
      return messageForTranslationSnapshot(envelope.data);
    case "translation.job.started":
      return "Translation started.";
    case "translation.chunk.queued":
      return "Chunk queued.";
    case "translation.chunk.started":
      return envelope.chunkIndex === null
        ? "Codex is translating a chunk."
        : `Codex is translating chunk ${envelope.chunkIndex + 1}.`;
    case "translation.codex.delta":
      return "Codex is translating...";
    case "translation.chunk.validating":
      return "Validating translated chunk.";
    case "translation.chunk.completed":
      return "Translated chunk completed.";
    case "translation.job.stitching":
      return "Stitching translated Markdown.";
    case "translation.job.committing":
      return "Writing translated CONTENT.md.";
    case "translation.job.completed":
      return "Translation completed.";
    case "translation.job.canceled":
      return "Translation canceled.";
    case "translation.job.stale":
      return "Source changed while translating.";
    case "translation.chunk.failed":
    case "translation.job.failed":
      return readTranslationEventErrorMessage(envelope.data);
    default:
      return "Translation is running.";
  }
}

function readTranslationDelta(envelope: ReaderTranslationEventEnvelope): string {
  if (envelope.type !== "translation.codex.delta" || !isRecord(envelope.data)) {
    return "";
  }
  return typeof envelope.data.text === "string" ? envelope.data.text : "";
}

function readTranslationReaderUrl(
  envelope: ReaderTranslationEventEnvelope,
): string | undefined {
  if (!isRecord(envelope.data)) {
    return undefined;
  }
  return typeof envelope.data.reader_url === "string"
    ? envelope.data.reader_url
    : undefined;
}

function readTranslationEventErrorMessage(data: unknown): string {
  if (!isRecord(data) || !isRecord(data.error)) {
    return "Translation failed.";
  }
  const code = typeof data.error.code === "string"
    ? data.error.code
    : undefined;
  const message = typeof data.error.message === "string"
    ? data.error.message
    : undefined;
  return messageForTranslationError(code, message);
}

function isTerminalTranslationEvent(type: string): boolean {
  return (
    type === "translation.job.completed" ||
    type === "translation.job.failed" ||
    type === "translation.job.stale" ||
    type === "translation.job.canceled"
  );
}

function isTerminalTranslationEnvelope(
  envelope: ReaderTranslationEventEnvelope,
): boolean {
  return (
    isTerminalTranslationEvent(envelope.type) ||
    isTerminalTranslationSnapshot(envelope.data)
  );
}

function isCompletedTranslationEnvelope(
  envelope: ReaderTranslationEventEnvelope,
): boolean {
  return (
    envelope.type === "translation.job.completed" ||
    readTranslationSnapshotStatus(envelope.data) === "complete"
  );
}

function isTerminalTranslationSnapshot(data: unknown): boolean {
  const status = readTranslationSnapshotStatus(data);
  return (
    status !== undefined &&
    TERMINAL_TRANSLATION_SNAPSHOT_STATUSES.has(status)
  );
}

function readTranslationSnapshotStatus(data: unknown): string | undefined {
  if (!isRecord(data) || typeof data.status !== "string") {
    return undefined;
  }
  return data.status;
}

function translationProgressStatusForEvent(
  envelope: ReaderTranslationEventEnvelope,
): TranslationProgressState["status"] {
  if (isCompletedTranslationEnvelope(envelope)) {
    return "completed";
  }
  if (
    isTerminalTranslationEnvelope(envelope) ||
    isUnavailableTranslationSnapshot(envelope.data)
  ) {
    return "failed";
  }
  return "running";
}

function messageForTranslationSnapshot(data: unknown): string {
  if (!isRecord(data)) {
    return "Translation stream connected.";
  }
  switch (readTranslationSnapshotStatus(data)) {
    case "complete":
      return "Translation completed.";
    case "canceled":
      return "Translation canceled.";
    case "stale":
      return "Source changed while translating.";
    case "failed":
    case "unavailable":
      return readTranslationEventErrorMessage(data);
  }
  if (isUnavailableTranslationSnapshot(data)) {
    return messageForTranslationError(
      "translation_unavailable",
      "Translated CONTENT.md is unavailable.",
    );
  }
  const completed = typeof data.completed_chunks === "number"
    ? data.completed_chunks
    : undefined;
  const total = typeof data.chunk_count === "number"
    ? data.chunk_count
    : undefined;
  if (completed !== undefined && total !== undefined && total > 0) {
    return `Translation stream connected. ${completed}/${total} chunks complete.`;
  }
  return "Translation stream connected.";
}

function isUnavailableTranslationSnapshot(data: unknown): boolean {
  if (!isRecord(data)) {
    return false;
  }
  if (data.status === "unavailable") {
    return true;
  }
  return isRecord(data.error) && data.error.code === "translation_unavailable";
}

function messageForTranslationError(
  code: string | undefined,
  message: string | undefined,
): string {
  switch (code) {
    case "translation_language_required":
      return "Set a translation target language in Settings before translating.";
    case "translation_language_mismatch":
      return "Translation target language changed. Refresh settings and try again.";
    case "translation_model_unavailable":
      return "Selected Codex model is unavailable. Update Settings and try again.";
    case "translation_reasoning_effort_unavailable":
      return "Selected Codex reasoning effort is unavailable for that model. Update Settings and try again.";
    case "auth_required":
    case "setup_required":
      return "Codex ChatGPT sign-in is required before translation can run.";
    case "app_server_unavailable":
      return "Codex app-server is unavailable. Start it and try again.";
    case "app_server_protocol_error":
      return "Codex app-server rejected the translation request. Update the integration and retry.";
    case "translation_unavailable":
      return "Translated CONTENT.md is unavailable. Start a fresh translation.";
    case "timeout":
      return "Codex translation timed out. Retry the translation.";
    case "turn_interrupted":
      return "Codex translation was canceled.";
    case "stream_disconnected":
      return "Codex translation stream disconnected. Retry the translation.";
    case "invalid_final_output":
      return "Codex returned invalid final output. Retry the translation.";
    case "stale_source":
      return "Source CONTENT.md changed while translating. Start a fresh translation.";
    case "cancellation_conflict":
      return "Translation cancellation is still finishing. Retry shortly.";
    case "usage_limit":
      return "Codex usage limit was reached. Retry after the limit resets.";
    case "context_overflow":
      return "Codex context limit was exceeded. Retry after the translation plan is adjusted.";
    case "validation_failed":
      return "Translated output failed validation. Retry the translation.";
    default:
      return message ?? "Translation failed.";
  }
}

export async function deleteReaderMemory(input: {
  fetch?: FetchFunction;
  isCurrent?: () => boolean;
  langCode?: SupportedLanguageCode;
  memoryId: string;
  navigate: (path: string) => void;
  revalidate?: (
    memoryId: string,
    langCode?: SupportedLanguageCode,
  ) => Promise<void>;
}): Promise<void> {
  try {
    await deleteMemoryById({
      memoryId: input.memoryId,
      fetch: input.fetch,
    });
  } catch (error) {
    if (
      isBackupFailsafeMemoryActionError(error) &&
      (input.isCurrent?.() ?? true)
    ) {
      void revalidateBackupFailsafeAlert();
    }
    throw error;
  }
  if (!(input.isCurrent?.() ?? true)) {
    return;
  }

  input.navigate("/memories");
  await (input.revalidate ?? revalidateAfterMemoryDeletion)(
    input.memoryId,
    input.langCode,
  );
}

export async function attachReaderCategoryByName(input: {
  fetch?: FetchFunction;
  memoryId: string;
  name: string;
}): Promise<ReaderTaxonomyItem> {
  return attachCategoryToMemoryByName(input);
}

export async function attachReaderTagByName(input: {
  fetch?: FetchFunction;
  memoryId: string;
  name: string;
}): Promise<ReaderTaxonomyItem> {
  return attachTagToMemoryByName(input);
}

export async function detachReaderTagByName(input: {
  fetch?: FetchFunction;
  memoryId: string;
  name: string;
}): Promise<ReaderTaxonomyItem> {
  return detachTagFromMemoryByName(input);
}

function mergeReaderTaxonomyItem(
  current: ReaderTaxonomyItem[],
  next: ReaderTaxonomyItem,
): ReaderTaxonomyItem[] {
  if (current.some((item) => item.id === next.id)) {
    return current;
  }

  return [...current, next];
}

function mergeReaderMomentItem(
  current: ReaderMomentItem[],
  next: ReaderMomentItem,
): ReaderMomentItem[] {
  if (
    current.some(
      (item) => item.id === next.id || item.sectionAnchor === next.sectionAnchor,
    )
  ) {
    return current.map((item) =>
      item.id === next.id || item.sectionAnchor === next.sectionAnchor
        ? next
        : item,
    );
  }

  return [next, ...current];
}

export function findLeadingReaderTitleEntry(input: {
  html: string;
  title: string;
  toc: ReaderTocEntry[];
}): ReaderTocEntry | undefined {
  const anchor = readLeadingReaderHeadingAnchor(input.html);
  if (anchor === undefined) {
    return undefined;
  }

  const entry = input.toc.find((candidate) => candidate.id === anchor);
  return entry?.level === 1 && entry.text === input.title ? entry : undefined;
}

export function splitLeadingReaderTitleContent(input: {
  html: string;
  title: string;
  toc: ReaderTocEntry[];
}): { bodyHtml: string; titleHtml: string | undefined } {
  if (findLeadingReaderTitleEntry(input) === undefined) {
    return {
      bodyHtml: input.html,
      titleHtml: undefined,
    };
  }

  const match = /^\s*(<h1\b[\s\S]*?<\/h1>)/i.exec(input.html);
  if (match === null || match[1] === undefined) {
    return {
      bodyHtml: input.html,
      titleHtml: undefined,
    };
  }

  return {
    bodyHtml: input.html.slice(match[0].length),
    titleHtml: match[1],
  };
}

export function readLeadingReaderHeadingAnchor(
  html: string,
): string | undefined {
  const match = /^\s*<h1\b([^>]*)>/i.exec(html);
  if (match === null) {
    return undefined;
  }

  return readHtmlAttribute(match[1] ?? "", "data-reader-section-anchor");
}

function readHtmlAttribute(
  attributes: string,
  name: string,
): string | undefined {
  const pattern = new RegExp(
    `\\b${escapeRegExp(name)}="([^"]*)"`,
    "i",
  );

  return pattern.exec(attributes)?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function readReaderHashTargetId(hash: string): string {
  if (!hash.startsWith("#")) {
    return "";
  }

  const rawTarget = hash.slice(1).trim();
  if (rawTarget.length === 0) {
    return "";
  }

  try {
    return decodeURIComponent(rawTarget);
  } catch {
    return rawTarget;
  }
}

export function scrollReaderHashTarget(input: {
  behavior?: ScrollBehavior;
  hash: string;
  root: HTMLElement | undefined;
}): boolean {
  const targetId = readReaderHashTargetId(input.hash);
  if (targetId.length === 0 || input.root === undefined) {
    return false;
  }

  const target = input.root.querySelector<HTMLElement>(
    `#${CSS.escape(targetId)}`,
  );
  if (target === null) {
    return false;
  }

  target.scrollIntoView({
    behavior: input.behavior ?? "auto",
    block: "start",
    inline: "nearest",
  });
  return true;
}

function scheduleReaderHashTargetScroll(root: HTMLElement | undefined): void {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      scrollReaderHashTarget({
        hash: window.location.hash,
        root,
      });
    });
  });
}

async function revalidateAfterReadStatusChange(
  memoryId: string,
  langCode?: SupportedLanguageCode,
): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateReaderMemory(memoryId, langCode),
  ]);
}

async function revalidateAfterReaderTaxonomyChange(
  memoryId: string,
  langCode?: SupportedLanguageCode,
): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateReaderMemory(memoryId, langCode),
  ]);
}

async function revalidateAfterMemoryDeletion(
  memoryId: string,
  langCode?: SupportedLanguageCode,
): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateFlashbackBrowseRows(),
    revalidateMomentBrowseRows(),
    revalidateReaderMemory(memoryId, langCode),
  ]);
}

async function revalidateAfterFlashbackToggle(
  memoryId: string,
  langCode?: SupportedLanguageCode,
): Promise<void> {
  await Promise.all([
    revalidateFlashbackBrowseRows(),
    revalidateReaderMemory(memoryId, langCode),
    revalidateBrowseMemoryWorkspace(),
  ]);
}

function ReaderContextMenu(props: {
  children: JSX.Element;
  label: string;
  menuRef: (element: HTMLDivElement) => void;
  onDismiss: () => void;
  position: ReaderSelectionMenuPosition;
}) {
  return (
    <div
      ref={(element) => {
        props.menuRef(element);
        queueMicrotask(() => {
          if (
            element.isConnected &&
            !focusReaderToolbarButton(element, 0)
          ) {
            element.focus({ preventScroll: true });
          }
        });
      }}
      aria-label={props.label}
      aria-orientation="horizontal"
      class={readerContextMenuClass}
      role="toolbar"
      style={{
        left: `${props.position.left}px`,
        top: `${props.position.top}px`,
      }}
      tabIndex={-1}
      onFocusIn={(event) => {
        if (event.target instanceof HTMLButtonElement) {
          const buttons = getReaderToolbarButtons(event.currentTarget);
          const focusedIndex = buttons.indexOf(event.target);
          buttons.forEach((button, index) => {
            button.tabIndex = index === focusedIndex ? 0 : -1;
          });
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onDismiss();
          return;
        }
        if (
          event.key !== "ArrowRight" &&
          event.key !== "ArrowLeft" &&
          event.key !== "Home" &&
          event.key !== "End"
        ) {
          return;
        }

        const buttons = getReaderToolbarButtons(event.currentTarget);
        if (buttons.length === 0) {
          return;
        }

        event.preventDefault();
        const currentIndex = buttons.findIndex(
          (button) => button === document.activeElement,
        );
        let nextIndex = 0;
        if (event.key === "End") {
          nextIndex = buttons.length - 1;
        } else if (event.key === "ArrowRight") {
          nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length;
        } else if (event.key === "ArrowLeft") {
          nextIndex = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1;
        }
        focusReaderToolbarButton(event.currentTarget, nextIndex);
      }}
    >
      {props.children}
    </div>
  );
}

function getReaderToolbarButtons(toolbar: HTMLDivElement): HTMLButtonElement[] {
  return [...toolbar.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
}

function focusReaderToolbarButton(
  toolbar: HTMLDivElement,
  index: number,
): boolean {
  const buttons = getReaderToolbarButtons(toolbar);
  if (buttons.length === 0) {
    return false;
  }

  const nextIndex = Math.min(Math.max(index, 0), buttons.length - 1);
  buttons.forEach((button, buttonIndex) => {
    button.tabIndex = buttonIndex === nextIndex ? 0 : -1;
  });
  buttons[nextIndex]?.focus({ preventScroll: true });
  return true;
}

export function ReaderFlashbackTabs(props: {
  allFlashbacks?: FlashbackBrowseRow[];
  currentFlashbacks: ReaderFlashbackItem[];
  initialTab?: "all" | "memory";
  memoryId: string;
}) {
  let allPageRegionRef: HTMLDivElement | undefined;
  const [activeTab, setActiveTab] = createSignal<"all" | "memory">(
    props.initialTab ?? "memory",
  );
  const [shouldLoadAll, setShouldLoadAll] = createSignal(props.initialTab === "all");
  const [allCursor, setAllCursor] = createSignal<string | null>(null);
  const [cursorHistory, setCursorHistory] = createSignal<readonly (string | null)[]>(
    [],
  );
  const lazyAllPageState = createAsync(async () => {
    if (props.allFlashbacks !== undefined || !shouldLoadAll()) {
      return undefined;
    }

    const requestedCursor = allCursor();
    return settleCollectionPage(requestedCursor, () =>
      getFlashbackBrowsePage({ cursor: requestedCursor }),
    );
  });
  const currentAllPageState = createMemo(() => {
    const state = lazyAllPageState();
    return state?.cursor === allCursor() ? state : undefined;
  });
  const allPageRetry = createCollectionPageRetryController({
    getCurrentCursor: allCursor,
    isPageReady: (requestedCursor) => {
      const state = lazyAllPageState();
      return state?.cursor === requestedCursor && state.status === "ready";
    },
    revalidatePage: revalidateFlashbackBrowsePage,
  });
  const allPage = createMemo(() => {
    if (props.allFlashbacks !== undefined) {
      return { flashbacks: props.allFlashbacks, nextCursor: null };
    }
    const state = currentAllPageState();
    return state?.status === "ready" ? state.page : undefined;
  });
  const allRows = createMemo(() => allPage()?.flashbacks ?? []);
  const isLoadingAll = () =>
    props.allFlashbacks === undefined &&
    shouldLoadAll() &&
    currentAllPageState() === undefined;
  const hasAllPageError = () => currentAllPageState()?.status === "error";
  const activateAllTab = (): void => {
    setShouldLoadAll(true);
    setActiveTab("all");
  };
  const goToFirstAllPage = (): void => {
    setCursorHistory([]);
    setAllCursor(null);
  };
  const goToPreviousAllPage = (): void => {
    const history = cursorHistory();
    if (history.length === 0) {
      return;
    }
    const previousCursor = history[history.length - 1] ?? null;
    setCursorHistory(history.slice(0, -1));
    setAllCursor(previousCursor);
  };
  const goToNextAllPage = (): void => {
    const nextCursor = allPage()?.nextCursor;
    if (nextCursor === undefined || nextCursor === null) {
      return;
    }
    setCursorHistory((history) => [...history, allCursor()]);
    setAllCursor(nextCursor);
  };

  return (
    <section class="rounded-[20px] border border-trauma-border bg-trauma-bg-base p-5">
      <h2 class="mb-3 text-[20px] font-extrabold text-trauma-text-primary">
        Flashbacks
      </h2>
      <div class="mb-4 grid grid-cols-2 gap-1 rounded-full bg-trauma-bg-sunken p-1">
        <SegmentedToggleButton
          active={activeTab() === "memory"}
          hint="Show current"
          onClick={() => setActiveTab("memory")}
        >
          Current
        </SegmentedToggleButton>
        <SegmentedToggleButton
          active={activeTab() === "all"}
          hint="Show all"
          onClick={activateAllTab}
        >
          All
        </SegmentedToggleButton>
      </div>
      <Show
        when={activeTab() === "memory"}
        fallback={
          <div
            ref={allPageRegionRef}
            aria-busy={isLoadingAll() || allPageRetry.isRetryingCurrentPage()}
            aria-label="All flashbacks page"
            class="grid gap-3"
            role="region"
            tabIndex={-1}
          >
            <Show
              when={!hasAllPageError() && !allPageRetry.isRetryingCurrentPage()}
              fallback={
                <div role="alert">
                  <p class="mb-0 text-sm font-bold text-trauma-danger">
                    Failed to load flashbacks.
                  </p>
                  <CollectionPageRetry
                    getFocusTarget={() => allPageRegionRef}
                    onRetry={allPageRetry.retryCurrentPage}
                    subject="all flashbacks"
                  />
                </div>
              }
            >
              <FlashbackShortcutList
                class={readerFlashbackScrollContent}
                emptyLabel="No flashbacks on this page"
                flashbacks={allRows().map((flashback) => ({
                  id: flashback.id,
                  href: buildMemoryVariantAnchorHref({
                    anchorId: flashback.id,
                    langCode: flashback.langCode,
                    memoryId: flashback.memoryId,
                  }),
                  prefix: flashback.prefix,
                  suffix: flashback.suffix,
                  text: flashback.text,
                }))}
                isLoading={isLoadingAll()}
              />
            </Show>
            <ReaderFlashbackPageControls
              canGoFirst={allCursor() !== null || cursorHistory().length > 0}
              canGoNext={allPage()?.nextCursor !== null && allPage() !== undefined}
              canGoPrevious={cursorHistory().length > 0}
              onFirst={goToFirstAllPage}
              onNext={goToNextAllPage}
              onPrevious={goToPreviousAllPage}
            />
          </div>
        }
      >
        <FlashbackShortcutList
          emptyLabel="No flashbacks for this memory yet"
          flashbacks={props.currentFlashbacks.map((flashback) => ({
            id: flashback.id,
            href: buildSameMemoryAnchorHref(flashback.id),
            prefix: flashback.prefix,
            suffix: flashback.suffix,
            text: flashback.text,
          }))}
          isLoading={false}
        />
      </Show>
    </section>
  );
}

function ReaderFlashbackPageControls(props: {
  canGoFirst: boolean;
  canGoNext: boolean;
  canGoPrevious: boolean;
  onFirst: () => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const buttonClass =
    "rounded-full border border-trauma-border px-3 py-1.5 text-xs font-bold text-trauma-text-primary transition hover:bg-trauma-bg-tint disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <nav aria-label="All Flashback pages" class="grid grid-cols-3 gap-2">
      <button
        class={buttonClass}
        disabled={!props.canGoFirst}
        type="button"
        onClick={props.onFirst}
      >
        First
      </button>
      <button
        class={buttonClass}
        disabled={!props.canGoPrevious}
        type="button"
        onClick={props.onPrevious}
      >
        Previous
      </button>
      <button
        class={buttonClass}
        disabled={!props.canGoNext}
        type="button"
        onClick={props.onNext}
      >
        Next
      </button>
    </nav>
  );
}

function getReaderSelectionKey(selection: ReaderSelectionPayload): string {
  return `${selection.startOffset}:${selection.endOffset}:${selection.text}`;
}

function getReaderMomentKey(section: ReaderMomentSection): string {
  return `${section.id}:${section.path}`;
}

function findReaderSectionElement(
  target: EventTarget | null,
  container: HTMLElement | undefined,
): HTMLElement | undefined {
  if (!(target instanceof Element) || container === undefined) {
    return undefined;
  }

  const section = target.closest<HTMLElement>("[data-reader-section-anchor]");
  if (section === null || !container.contains(section)) {
    return undefined;
  }

  return section;
}

function findReaderMomentTrigger(
  target: EventTarget | null,
  container: HTMLElement | undefined,
): HTMLButtonElement | undefined {
  if (!(target instanceof Element) || container === undefined) {
    return undefined;
  }

  const trigger = target.closest<HTMLButtonElement>(
    "button[data-reader-moment-trigger='true']",
  );
  if (trigger === null || !container.contains(trigger)) {
    return undefined;
  }

  return trigger;
}

function readReaderSection(
  sectionElement: HTMLElement,
): ReaderMomentSection | undefined {
  const id = sectionElement.dataset.readerSectionAnchor;
  const path = sectionElement.dataset.readerSectionPath;
  const title = sectionElement.dataset.readerSectionTitle
    ?? sectionElement.textContent
    ?? "";
  const level = Number.parseInt(
    sectionElement.dataset.readerSectionLevel ?? "",
    10,
  );

  if (
    id === undefined ||
    id.trim() === "" ||
    path === undefined ||
    path.trim() === "" ||
    title.trim() === "" ||
    !Number.isInteger(level)
  ) {
    return undefined;
  }

  return {
    id: id.trim(),
    level,
    path: path.trim(),
    text: title.trim(),
  };
}

function findReaderSectionInSelection(
  range: Range,
  container: HTMLElement | undefined,
): ReaderMomentSection | undefined {
  if (container === undefined) {
    return undefined;
  }

  for (const sectionElement of container.querySelectorAll<HTMLElement>(
    "[data-reader-section-anchor]",
  )) {
    if (!range.intersectsNode(sectionElement)) {
      continue;
    }

    const section = readReaderSection(sectionElement);
    if (section !== undefined) {
      return section;
    }
  }

  return undefined;
}

export function positionReaderSelectionMenu(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width">,
  viewport: { height: number; width: number },
  menuWidth = 48,
): ReaderSelectionMenuPosition {
  const menuHeight = 48;
  const gap = 8;
  const centeredLeft = rect.left + rect.width / 2 - menuWidth / 2;
  const left = clamp(centeredLeft, gap, viewport.width - menuWidth - gap);
  const canPlaceAbove = rect.top >= menuHeight + gap;
  const top = canPlaceAbove
    ? rect.top - menuHeight - gap
    : Math.min(rect.bottom + gap, viewport.height - menuHeight - gap);

  return {
    left,
    top: Math.max(gap, top),
    placement: canPlaceAbove ? "above" : "below",
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ReaderState(props: { message: string }) {
  return (
    <section class={readerFrame} aria-labelledby="reader-state-title">
      <RouteHeader
        class={`${readerPadding} trauma-reader-header`}
        leading={() => (
          <a
            class="grid size-10 place-items-center rounded-full text-trauma-text-muted hover:bg-trauma-bg-elev hover:text-trauma-text-primary"
            href="/memories"
            aria-label="Back to memories"
          >
            <ChevronLeftIcon />
          </a>
        )}
        layout="single"
        title="Memory"
        titleElement="p"
      />
      <div class={readerStatePanel}>
        <h1 class="mb-2 text-3xl font-bold text-trauma-text-primary" id="reader-state-title">{props.message}</h1>
        <p>Open another memory from the archive.</p>
      </div>
    </section>
  );
}

function ReaderToc(props: {
  activeTocRange: Accessor<ActiveTocRange>;
  moments: ReaderMomentItem[];
  onCreateMoment: (section: ReaderMomentSection) => void;
  onOpenSectionMenu: (section: ReaderMomentSection, rect: DOMRect) => void;
  pendingMomentKey: string;
  toc: ReaderTocEntry[];
}) {
  let scrollRef: HTMLOListElement | undefined;
  const activeMomentTargetIds = createMemo(() =>
    collectResolvedReaderMomentTargetIds(props.moments, props.toc)
  );
  const [tocScrollState, setTocScrollState] =
    createSignal<TocScrollState>(noTocScrollState);
  const [readingBand, setReadingBand] = createSignal<{
    top: number;
    height: number;
  }>({ top: 0, height: 0 });
  const [readingBandVisible, setReadingBandVisible] = createSignal(false);
  const [readingBandAnimated, setReadingBandAnimated] = createSignal(false);
  // Measures the contiguous on-screen range as one continuous band so the
  // highlight renders seamlessly (no per-section seams) and can ease between
  // adjacent ranges by growing its top/height rather than popping per row.
  const measureReadingBand = () => {
    const list = scrollRef;
    if (list === undefined) {
      return;
    }

    const rows = Array.from(
      list.querySelectorAll<HTMLElement>('[data-reading-range="true"]'),
    );
    if (rows.length === 0) {
      setReadingBandVisible(false);
      return;
    }

    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const top = first.offsetTop;
    const height = last.offsetTop + last.offsetHeight - top;
    setReadingBand({ top, height });
    setReadingBandVisible(true);
    ensureReadingBandVisible(top, height);
  };
  // When the spied range reaches a section outside the TOC's bounded scroll
  // viewport, scroll the TOC just enough to follow the reader's position. Only
  // runs on range changes, so manual TOC browsing is not interrupted until the
  // reader scrolls again.
  const ensureReadingBandVisible = (top: number, height: number) => {
    const list = scrollRef;
    if (list === undefined) {
      return;
    }

    const margin = 8;
    const viewTop = list.scrollTop;
    const viewBottom = viewTop + list.clientHeight;
    let next = viewTop;
    if (top < viewTop + margin) {
      next = top - margin;
    } else if (top + height > viewBottom - margin) {
      next = top + height + margin - list.clientHeight;
    }

    next = Math.max(0, next);
    if (Math.abs(next - viewTop) <= 1) {
      return;
    }

    const prefersReduced = typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({
      top: next,
      behavior: readingBandAnimated() && !prefersReduced ? "smooth" : "auto",
    });
  };
  const updateTocScrollHint = () => {
    if (scrollRef === undefined) {
      setTocScrollState(noTocScrollState);
      return;
    }

    const hasOverflow = scrollRef.scrollHeight > scrollRef.clientHeight + 1;
    const canScrollUp = hasOverflow && scrollRef.scrollTop > 1;
    const canScrollDown =
      hasOverflow &&
      scrollRef.scrollTop + scrollRef.clientHeight < scrollRef.scrollHeight - 1;

    setTocScrollState((current) => {
      if (
        current.canScrollDown === canScrollDown &&
        current.canScrollUp === canScrollUp
      ) {
        return current;
      }

      return {
        canScrollDown,
        canScrollUp,
      };
    });
  };

  createEffect(() => {
    props.toc.length;
    queueMicrotask(updateTocScrollHint);
  });

  createEffect(() => {
    props.activeTocRange();
    queueMicrotask(measureReadingBand);
  });

  onMount(() => {
    updateTocScrollHint();
    measureReadingBand();
    const enableBandAnimation = window.requestAnimationFrame(() =>
      setReadingBandAnimated(true)
    );
    const handleResize = () => {
      updateTocScrollHint();
      measureReadingBand();
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      window.cancelAnimationFrame(enableBandAnimation);
    });
  });

  return (
    <Show when={props.toc.length > 0}>
      <nav
        class="animate-trauma-pop-bounce relative overflow-hidden rounded-[20px] border border-trauma-border bg-trauma-bg-base p-5 text-sm text-trauma-text-secondary"
        aria-label="Table of contents"
      >
        <h2 class="mb-4 text-[20px] font-extrabold text-trauma-text-primary">
          Contents
        </h2>
        <div class="trauma-toc-scroll-shell">
          <ol
            ref={scrollRef}
            class={`${readerTocScrollContent} relative m-0 grid gap-2.5 pl-0`}
            onScroll={updateTocScrollHint}
          >
            <li
              class="trauma-toc-reading-band"
              classList={{
                "trauma-toc-reading-band-animated": readingBandAnimated(),
              }}
              data-visible={readingBandVisible() ? "true" : "false"}
              style={{
                top: `${readingBand().top}px`,
                height: `${readingBand().height}px`,
              }}
              aria-hidden="true"
              role="presentation"
            />
            {props.toc.map((entry) => (
              <ReaderTocEntryRow
                active={activeMomentTargetIds().has(entry.id)}
                activeTocRange={props.activeTocRange}
                entry={entry}
                onCreateMoment={props.onCreateMoment}
                onOpenSectionMenu={props.onOpenSectionMenu}
                pending={props.pendingMomentKey === getReaderMomentKey(entry)}
              />
            ))}
          </ol>
        </div>
        <Show when={tocScrollState().canScrollUp}>
          <div
            class="trauma-toc-scroll-fade trauma-toc-scroll-fade-top"
            aria-hidden="true"
          />
        </Show>
        <Show when={tocScrollState().canScrollDown}>
          <div
            class="trauma-toc-scroll-fade trauma-toc-scroll-fade-bottom"
            aria-hidden="true"
          />
        </Show>
      </nav>
    </Show>
  );
}

function syncReaderSectionMomentButtons(input: {
  container: HTMLElement | undefined;
  moments: ReaderMomentItem[];
  toc: ReaderTocEntry[];
}): void {
  if (input.container === undefined) {
    return;
  }

  const activeMomentTargetIds = collectResolvedReaderMomentTargetIds(
    input.moments,
    input.toc,
  );

  for (const button of input.container.querySelectorAll<HTMLButtonElement>(
    "button[data-reader-moment-trigger='true']",
  )) {
    const sectionElement = findReaderSectionElement(button, input.container);
    const section = sectionElement === undefined
      ? undefined
      : readReaderSection(sectionElement);
    const active = section !== undefined &&
      activeMomentTargetIds.has(section.id);
    button.setAttribute("aria-pressed", String(active));
  }
}

function ReaderTocEntryRow(props: {
  active: boolean;
  activeTocRange: Accessor<ActiveTocRange>;
  entry: ReaderTocEntry;
  onCreateMoment: (section: ReaderMomentSection) => void;
  onOpenSectionMenu: (section: ReaderMomentSection, rect: DOMRect) => void;
  pending: boolean;
}) {
  let rowRef: HTMLLIElement | undefined;
  const inReadingRange = () =>
    props.activeTocRange().rangeIds.includes(props.entry.id);
  const isReadingLead = () =>
    props.activeTocRange().leadId === props.entry.id;
  let longPressTimer: number | undefined;
  const clearLongPress = () => {
    if (longPressTimer === undefined) {
      return;
    }

    window.clearTimeout(longPressTimer);
    longPressTimer = undefined;
  };
  const openLongPressMenu = () => {
    if (rowRef === undefined) {
      return;
    }

    props.onOpenSectionMenu(props.entry, rowRef.getBoundingClientRect());
  };

  onCleanup(clearLongPress);

  return (
    <li
      ref={rowRef}
      data-reading-range={inReadingRange() ? "true" : undefined}
      class="group relative z-[1] grid grid-cols-[1.125rem_minmax(0,1fr)] items-start gap-1"
      classList={{
        "ml-2.5": props.entry.level === 2,
        "ml-5": props.entry.level === 3,
      }}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
      onPointerMove={clearLongPress}
      onPointerUp={clearLongPress}
      onPointerDown={(event) => {
        clearLongPress();
        if (event.button !== 0) {
          return;
        }

        longPressTimer = window.setTimeout(openLongPressMenu, 500);
      }}
    >
      <button
        aria-label={`Moment ${props.entry.text}`}
        aria-pressed={props.active}
        class="mt-0.5 grid size-5 place-items-center rounded-full text-trauma-text-muted opacity-0 transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent group-hover:opacity-100 aria-pressed:opacity-100 aria-pressed:text-trauma-link"
        title={props.active ? "Remove moment" : "Save moment"}
        disabled={props.pending}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          props.onCreateMoment(props.entry);
        }}
      >
        {props.active
          ? TraumaNavIcons.moment.filled({ size: 14 })
          : TraumaNavIcons.moment.outline({ size: 14 })}
      </button>
      <a
        class="hover:text-trauma-link"
        href={`#${props.entry.id}`}
        aria-current={isReadingLead() ? "location" : undefined}
      >
        {props.entry.text}
      </a>
    </li>
  );
}

async function toggleReaderSelection(input: {
  container: HTMLDivElement;
  isCurrent: () => boolean;
  langCode?: SupportedLanguageCode;
  memoryId: string;
  onFlashbacksChanged: (flashbacks: ReaderFlashbackItem[]) => void;
  onSuccess: () => Promise<void> | void;
  pendingSelectionKey: string;
  selection: ReaderSelection;
  setErrorMessage: (message: string) => void;
  setPendingSelectionKey: (key: string) => void;
}) {
  if (
    !canStartFlashbackToggle(input.pendingSelectionKey) ||
    !input.isCurrent()
  ) {
    return;
  }

  const selection = input.selection;
  const selectionKey = getReaderSelectionKey(selection);
  const previousHtml = input.container.innerHTML;
  const shouldUnflashback = isRangeFullyMarked(selection.range, input.container);
  const operation: ReaderFlashbackOperation = shouldUnflashback
    ? "unflashback"
    : "flashback";
  input.setErrorMessage("");
  input.setPendingSelectionKey(selectionKey);
  input.container.focus({ preventScroll: true });

  try {
    const optimisticFlashbackId = applyOptimisticFlashback(
      selection.range,
      shouldUnflashback,
      input.container,
    );
    window.getSelection()?.removeAllRanges();

    const response = await fetch("/api/flashbacks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: buildFlashbackToggleRequestBody({
        langCode: input.langCode,
        memoryId: input.memoryId,
        operation,
        selection: toPayload(selection),
      }),
    });
    if (!input.isCurrent()) {
      return;
    }

    const failure = await readFlashbackFailure(response);
    if (!input.isCurrent()) {
      return;
    }

    if (failure !== undefined) {
      if (shouldRevalidateBackupFailsafeAfterFlashbackFailure(failure)) {
        void revalidateBackupFailsafeAlert();
      }

      throw new Error(failure.message);
    }
    const payload = await readFlashbackToggleSuccess(response);
    if (!input.isCurrent()) {
      return;
    }

    if (optimisticFlashbackId !== undefined) {
      syncOptimisticFlashbackMark({
        container: input.container,
        flashback: findFlashbackForOptimisticSelection(
          payload.result.flashbacks,
          selection,
        ),
        pendingId: optimisticFlashbackId,
      });
    }
    const backupWarning = readFlashbackBackupWarning(payload);
    const durabilityWarning = readFlashbackDurabilityWarning(payload);
    const warning = durabilityWarning ?? backupWarning;
    if (warning !== undefined) {
      input.setErrorMessage(warning.message);
    }
    if (backupWarning !== undefined) {
      void revalidateBackupFailsafeAlert();
    }
    input.onFlashbacksChanged(payload.result.flashbacks);
    void Promise.resolve(input.onSuccess()).catch(() => undefined);
  } catch {
    if (input.isCurrent()) {
      input.container.innerHTML = previousHtml;
      input.setErrorMessage("Flashback failed");
    }
  } finally {
    if (input.isCurrent()) {
      input.setPendingSelectionKey("");
    }
  }
}

export function buildFlashbackToggleRequestBody(input: {
  langCode?: SupportedLanguageCode;
  memoryId: string;
  operation: ReaderFlashbackOperation;
  selection: ReaderSelectionPayload;
}): string {
  return JSON.stringify({
    memoryId: input.memoryId,
    operation: input.operation,
    selection: input.selection,
    ...(input.langCode === undefined ? {} : { langCode: input.langCode }),
  });
}

interface ReaderFlashbackToggleSuccess {
  result: {
    flashbacks: ReaderFlashbackItem[];
  };
}

async function readFlashbackToggleSuccess(
  response: Response,
): Promise<ReaderFlashbackToggleSuccess> {
  const payload: unknown = await response.json();
  if (!isReaderFlashbackToggleSuccess(payload)) {
    throw new Error("invalid flashback toggle response");
  }

  return payload;
}

function isReaderFlashbackToggleSuccess(
  value: unknown,
): value is ReaderFlashbackToggleSuccess {
  if (!isRecord(value) || !isRecord(value.result)) {
    return false;
  }

  return Array.isArray(value.result.flashbacks) &&
    value.result.flashbacks.every(isReaderFlashbackItem);
}

function isReaderFlashbackItem(value: unknown): value is ReaderFlashbackItem {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    typeof value.prefix === "string" &&
    typeof value.suffix === "string" &&
    typeof value.startOffset === "number" &&
    typeof value.endOffset === "number" &&
    (value.contentHash === undefined ||
      value.contentHash === null ||
      typeof value.contentHash === "string") &&
    typeof value.createdAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readReaderSelection(
  container: HTMLElement | undefined,
): ReaderSelection | undefined {
  if (container === undefined) {
    return undefined;
  }

  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
    return undefined;
  }

  const range = selection.getRangeAt(0).cloneRange();
  if (!containsBoundary(container, range.startContainer) || !containsBoundary(container, range.endContainer)) {
    return undefined;
  }
  if (
    isInsideReaderNonContent(range.startContainer) ||
    isInsideReaderNonContent(range.endContainer) ||
    rangeIntersectsReaderNonContent(range, container)
  ) {
    return undefined;
  }

  const textNodes = collectReaderContentTextNodes(container);
  const selectionOffsets = readReaderSelectionOffsets(range, textNodes);
  if (selectionOffsets === undefined) {
    return undefined;
  }

  const text = selectionOffsets.text;
  if (text.trim().length === 0) {
    return undefined;
  }

  const contentText = textNodes.map((node) => node.nodeValue ?? "").join("");
  const { endOffset, startOffset } = selectionOffsets;

  return {
    range,
    text,
    prefix: readContextBefore(contentText, startOffset),
    suffix: readContextAfter(contentText, endOffset),
    startOffset,
    endOffset,
  };
}

function containsBoundary(container: HTMLElement, node: Node): boolean {
  return node === container || container.contains(node);
}

function readReaderSelectionOffsets(
  range: Range,
  textNodes: Text[],
): { endOffset: number; startOffset: number; text: string } | undefined {
  let currentOffset = 0;
  let startOffset: number | undefined;
  let endOffset: number | undefined;
  let text = "";

  for (const node of textNodes) {
    const nodeText = node.nodeValue ?? "";
    const nodeLength = nodeText.length;

    if (range.intersectsNode(node)) {
      const nodeStartOffset = currentOffset;
      const selectedStart = node === range.startContainer ? range.startOffset : 0;
      const selectedEnd = node === range.endContainer ? range.endOffset : nodeLength;
      if (selectedEnd > selectedStart) {
        startOffset ??= nodeStartOffset + selectedStart;
        endOffset = nodeStartOffset + selectedEnd;
        text += nodeText.slice(selectedStart, selectedEnd);
      }
    }

    currentOffset += nodeLength;
  }

  if (startOffset === undefined || endOffset === undefined) {
    return undefined;
  }

  return {
    endOffset,
    startOffset,
    text,
  };
}

function readContextBefore(text: string, startOffset: number): string {
  const lineStart = text.lastIndexOf("\n", startOffset - 1) + 1;
  return text.slice(Math.max(lineStart, startOffset - 80), startOffset);
}

function readContextAfter(text: string, endOffset: number): string {
  const lineEnd = text.indexOf("\n", endOffset);
  const contextEnd = lineEnd === -1 ? text.length : lineEnd;
  return text.slice(endOffset, Math.min(contextEnd, endOffset + 80));
}

function isRangeFullyMarked(range: Range, container: HTMLElement): boolean {
  const textNodes = collectIntersectingTextNodes(range, container).filter(
    (node) => (node.nodeValue ?? "").length > 0,
  );
  return (
    textNodes.length > 0 &&
    textNodes.every((node) =>
      node.parentElement?.closest("mark[data-flashback-id]") !== null,
    )
  );
}

function collectIntersectingTextNodes(range: Range, container: HTMLElement): Text[] {
  return collectReaderContentTextNodes(container).filter((node) =>
    range.intersectsNode(node),
  );
}

function collectReaderContentTextNodes(container: HTMLElement): Text[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();

  while (current !== null) {
    const node = current as Text;
    if (!isInsideReaderNonContent(node) || isInsideReaderOffsetContent(node)) {
      nodes.push(node);
    }

    current = walker.nextNode();
  }

  return nodes;
}

function isInsideReaderNonContent(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest("[data-reader-noncontent]") !== null;
}

function isInsideReaderOffsetContent(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest("[data-reader-offset-content]") !== null;
}

function rangeIntersectsReaderNonContent(
  range: Range,
  container: HTMLElement,
): boolean {
  return [...container.querySelectorAll("[data-reader-noncontent]")].some(
    (element) => rangeIntersectsElement(range, element),
  );
}

function rangeIntersectsElement(range: Range, element: Element): boolean {
  const elementRange = document.createRange();
  elementRange.selectNode(element);
  return range.compareBoundaryPoints(Range.END_TO_START, elementRange) > 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, elementRange) < 0;
}

function applyOptimisticFlashback(
  range: Range,
  shouldUnflashback: boolean,
  container: HTMLElement,
): string | undefined {
  if (shouldUnflashback) {
    const placeholder = document.createElement("span");
    const fragment = range.extractContents();
    stripFlashbackElements(fragment);
    placeholder.append(fragment);
    range.insertNode(placeholder);
    liftNodeOutOfFlashbackMarks(placeholder);
    placeholder.replaceWith(...Array.from(placeholder.childNodes));
    container.normalize();
    return undefined;
  }

  const pendingId = `pending-${Date.now()}`;
  const mark = document.createElement("mark");
  mark.dataset.flashbackId = pendingId;
  mark.id = pendingId;
  mark.append(range.extractContents());
  range.insertNode(mark);
  container.normalize();
  return pendingId;
}

export function findFlashbackForOptimisticSelection(
  flashbacks: ReaderFlashbackItem[],
  selection: ReaderSelectionPayload,
): ReaderFlashbackItem | undefined {
  return flashbacks.find((flashback) =>
    flashback.startOffset <= selection.startOffset &&
    flashback.endOffset >= selection.endOffset
  ) ?? flashbacks.find((flashback) =>
    flashback.text === selection.text &&
    flashback.startOffset === selection.startOffset &&
    flashback.endOffset === selection.endOffset
  );
}

function syncOptimisticFlashbackMark(input: {
  container: HTMLElement;
  flashback: ReaderFlashbackItem | undefined;
  pendingId: string;
}): void {
  if (input.flashback === undefined) {
    return;
  }

  const mark = input.container.querySelector<HTMLElement>(
    `mark[data-flashback-id="${CSS.escape(input.pendingId)}"]`,
  );
  if (mark === null) {
    return;
  }

  mark.dataset.flashbackId = input.flashback.id;
  mark.id = input.flashback.id;
}

function stripFlashbackElements(fragment: DocumentFragment): void {
  for (const mark of [...fragment.querySelectorAll("mark[data-flashback-id]")]) {
    const parent = mark.parentNode;
    if (parent === null) {
      continue;
    }

    while (mark.firstChild !== null) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  }
}

function liftNodeOutOfFlashbackMarks(node: HTMLElement): void {
  let mark =
    node.parentElement?.closest<HTMLElement>("mark[data-flashback-id]") ?? null;

  while (mark !== null) {
    const liftTarget = directChildContaining(mark, node);
    if (liftTarget === undefined) {
      return;
    }

    liftChildOutOfMark(liftTarget, mark);
    mark =
      node.parentElement?.closest<HTMLElement>("mark[data-flashback-id]") ??
      null;
  }
}

function directChildContaining(
  ancestor: HTMLElement,
  node: Node,
): ChildNode | undefined {
  let current: Node = node;
  while (current.parentNode !== null && current.parentNode !== ancestor) {
    current = current.parentNode;
  }

  return current.parentNode === ancestor ? (current as ChildNode) : undefined;
}

function liftChildOutOfMark(child: ChildNode, mark: HTMLElement): void {
  const parent = mark.parentNode;
  if (parent === null) {
    return;
  }

  const afterMark = mark.cloneNode(false) as HTMLElement;
  let sibling = child.nextSibling;
  while (sibling !== null) {
    const nextSibling = sibling.nextSibling;
    afterMark.append(sibling);
    sibling = nextSibling;
  }

  parent.insertBefore(child, mark.nextSibling);
  if (afterMark.hasChildNodes()) {
    parent.insertBefore(afterMark, child.nextSibling);
  }

  if (!mark.hasChildNodes()) {
    mark.remove();
  }
}

function toPayload(selection: ReaderSelection): ReaderSelectionPayload {
  return {
    text: selection.text,
    prefix: selection.prefix,
    suffix: selection.suffix,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
  };
}

const READER_PULSE_OPTIONS: ReadonlyArray<{
  rating: FocusPluginPulseRating;
  label: string;
}> = [
  { rating: "helped", label: "Helped" },
  { rating: "neutral", label: "Neutral" },
  { rating: "distracting", label: "Distracting" },
];

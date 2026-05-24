import { createAsync, useNavigate } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
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
  getFlashbackBrowseRows,
  revalidateFlashbackBrowseRows,
} from "../flashbacks/flashbacks-loader";
import { MemoryActionMenu } from "../memories/MemoryActionMenu";
import { MemoryReadStatusControl } from "../memories/MemoryReadStatusControl";
import { revalidateBrowseMemoryWorkspace } from "../memories/browse-loader";
import {
  buildMemoryAnchorHref,
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
  createMomentForSection,
  type ReaderMomentSection,
} from "./moment-requests";
import { deleteMomentById } from "../moments/moment-action-requests";
import {
  canStartFlashbackToggle,
  isExplicitFlashbackKeyboardToggle,
} from "./flashback-events";
import { revalidateBackupFailsafeAlert } from "../backup/backup-failsafe-loader";
import { SegmentedToggleButton } from "../ui/SegmentedToggleButton";
import {
  readFlashbackFailure,
  shouldRevalidateBackupFailsafeAfterFlashbackFailure,
} from "./flashback-failure";
import {
  readerArticle,
  readerFrame,
  readerPadding,
  readerStatePanel,
} from "./reader-styles";
import { toSafeReaderSourceHref } from "./source-url";
import { useRightRailContent } from "../shell/right-rail-context";
import { revalidateMomentBrowseRows } from "../moments/moments-loader";
import { revalidateReaderMemory } from "./reader-memory-loader";
import { TaxonomyList } from "../taxonomy/TaxonomyList";
import { RouteHeader } from "../layout/RouteHeader";
import { TaxonomyAddControl } from "../memories/TaxonomyAddControl";
import {
  ScrollableUrlDisplay,
  ScrollableUrlLink,
} from "../url/ScrollableUrlText";
import { submitReadCodexModels } from "../settings/settings-submit";

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
const readerContextMenuClass =
  "trauma-reader-context-menu fixed z-[70] inline-flex items-center gap-1 rounded-full border border-transparent p-1 shadow-none";
const readerSourceLinkClass =
  "min-h-9 max-w-full justify-self-start text-sm leading-tight text-trauma-link";

export function MemoryReader(props: MemoryReaderProps) {
  const readyResult = () =>
    props.result.status === "ready" ? props.result : undefined;
  const stateMessage = () =>
    props.result.status === "ready" ? "" : props.result.message;

  return (
    <Show
      keyed
      when={readyResult()}
      fallback={<ReaderState message={stateMessage()} />}
    >
      {(result) => (
        <ReadyMemoryReader
          categoryOptions={props.categoryOptions ?? []}
          flashbackRows={props.flashbackRows}
          navigate={props.navigate}
          result={result}
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
  let selectionMenuRef: ReaderMenuElement;
  let sectionMenuRef: ReaderMenuElement;
  let sectionLongPressTimer: number | undefined;
  const navigate = props.navigate ?? useNavigate();
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
  const allFlashbacks = props.flashbackRows === undefined
    ? createAsync(() => getFlashbackBrowseRows())
    : () => props.flashbackRows;
  const [selectionMenu, setSelectionMenu] =
    createSignal<ReaderSelectionMenuState>();
  const [sectionMenu, setSectionMenu] = createSignal<ReaderSectionMenuState>();
  const [isReaderClientReady, setIsReaderClientReady] = createSignal(false);
  const [pendingMomentKey, setPendingMomentKey] = createSignal("");
  const [pendingSelectionKey, setPendingSelectionKey] = createSignal("");
  const [errorMessage, setErrorMessage] = createSignal("");
  const [translationProgress, setTranslationProgress] =
    createSignal<TranslationProgressState>();
  const [translationDialogOpen, setTranslationDialogOpen] = createSignal(false);
  const [translationFormLanguage, setTranslationFormLanguage] = createSignal<
    SupportedLanguageCode | ""
  >(props.translationTargetLanguage ?? "");
  const [translationFormModel, setTranslationFormModel] = createSignal(
    props.translationModel ?? "",
  );
  const [translationFormEffort, setTranslationFormEffort] = createSignal<
    CodexReasoningEffort | ""
  >(props.translationReasoningEffort ?? "");
  const [translationCatalogModels, setTranslationCatalogModels] = createSignal<
    CodexModelCatalog["models"]
  >([]);
  const [translationCatalogError, setTranslationCatalogError] = createSignal("");
  const { setRightRailContent } = useRightRailContent();
  let translationEventSource: EventSource | undefined;

  const closeSelectionMenu = () => setSelectionMenu(undefined);
  const closeSectionMenu = () => setSectionMenu(undefined);
  const closeReaderMenus = () => {
    closeSelectionMenu();
    closeSectionMenu();
  };
  createEffect(() => {
    if (!translationDialogOpen()) {
      setTranslationFormLanguage(props.translationTargetLanguage ?? "");
      setTranslationFormModel(props.translationModel ?? "");
      setTranslationFormEffort(props.translationReasoningEffort ?? "");
    }
  });
  createEffect(() => {
    props.result.memory.id;
    setCategories([...props.result.memory.categories]);
    setTags([...props.result.memory.tags]);
    setMoments([...props.result.memory.moments]);
    setCurrentFlashbacks([...props.result.memory.flashbacks]);
    setPendingMomentKey("");
    setPendingSelectionKey("");
    setErrorMessage("");
    setTranslationProgress(undefined);
    translationEventSource?.close();
    translationEventSource = undefined;
    closeReaderMenus();
  });
  createEffect(() => {
    setRightRailContent(
      <ReaderRightRailContent
        allFlashbacks={allFlashbacks()}
        currentFlashbacks={currentFlashbacks()}
        moments={moments()}
        memoryId={props.result.memory.id}
        onCreateMoment={(section) => void toggleMoment(section)}
        onOpenSectionMenu={openSectionMenu}
        pendingMomentKey={pendingMomentKey()}
        toc={props.result.rendered.toc}
      />,
    );
  });

  onCleanup(() => {
    translationEventSource?.close();
    setRightRailContent(undefined);
  });

  onMount(() => {
    setIsReaderClientReady(true);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeReaderMenus();
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

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("scroll", closeReaderMenus, true);
    window.addEventListener("hashchange", scrollHashTarget);
    scheduleReaderHashTargetScroll(readerRootRef);
    onCleanup(() => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("scroll", closeReaderMenus, true);
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
    if (menu === undefined || bodyContentRef === undefined) {
      return;
    }

    closeSelectionMenu();
    void toggleReaderSelection({
      container: bodyContentRef,
      langCode: props.result.content.langCode,
      memoryId: props.result.memory.id,
      pendingSelectionKey: pendingSelectionKey(),
      selection: menu.selection,
      setErrorMessage,
      setPendingSelectionKey,
      onFlashbacksChanged: setCurrentFlashbacks,
      onSuccess: () =>
        revalidateAfterFlashbackToggle(props.result.memory.id),
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
  const handleKeyboardSelectionToggle = (event: KeyboardEvent) => {
    if (!isExplicitFlashbackKeyboardToggle(event)) {
      return;
    }

    event.preventDefault();
    openSelectionMenu();
  };
  const deleteMemory = async (memoryId: string): Promise<void> => {
    await deleteReaderMemory({
      memoryId,
      navigate,
    });
  };
  const attachCategory = async (input: {
    memoryId: string;
    name: string;
  }): Promise<void> => {
    const category = await attachReaderCategoryByName(input);
    setCategories((current) => mergeReaderTaxonomyItem(current, category));
    void Promise.all([
      revalidateBrowseMemoryWorkspace(),
      revalidateReaderMemory(input.memoryId),
    ]);
  };
  const attachTag = async (name: string): Promise<void> => {
    setErrorMessage("");
    try {
      const tag = await attachReaderTagByName({
        memoryId: props.result.memory.id,
        name,
      });
      setTags((current) => mergeReaderTaxonomyItem(current, tag));
      void revalidateAfterReaderTaxonomyChange(props.result.memory.id);
    } catch (error) {
      setErrorMessage("Failed to add tag.");
      throw error;
    }
  };
  const detachTag = async (name: string): Promise<void> => {
    setErrorMessage("");
    try {
      const tag = await detachReaderTagByName({
        memoryId: props.result.memory.id,
        name,
      });
      setTags((current) => current.filter((item) => item.id !== tag.id));
      void revalidateAfterReaderTaxonomyChange(props.result.memory.id);
    } catch (error) {
      setErrorMessage("Failed to remove tag.");
      throw error;
    }
  };
  const isTranslatedReader = () => props.result.content.langCode !== undefined;
  const hasConfiguredTargetVariant = () => {
    const langCode = props.translationTargetLanguage;
    return langCode !== undefined &&
      props.result.content.variants.some((variant) => variant.langCode === langCode);
  };
  const canStartTranslation = () =>
    !isTranslatedReader() &&
    props.translationTargetLanguage !== undefined &&
    !hasConfiguredTargetVariant();
  const selectedTranslationModel = createMemo(() => {
    const current = translationFormModel();
    return translationCatalogModels().find((model) =>
      model.model === current || model.id === current
    );
  });
  const translationReasoningEfforts = createMemo(() => {
    const selected = selectedTranslationModel();
    if (selected !== undefined) {
      return selected.supportedReasoningEfforts;
    }
    return translationCatalogModels().find((model) => model.isDefault)
      ?.supportedReasoningEfforts ?? [];
  });
  const refreshTranslationCatalog = async (): Promise<void> => {
    setTranslationCatalogError("");
    try {
      const catalog = await submitReadCodexModels();
      setTranslationCatalogModels(catalog.models);
    } catch (error) {
      setTranslationCatalogError(
        error instanceof Error
          ? error.message
          : "Codex model catalog is unavailable.",
      );
    }
  };
  const openTranslationDialog = (): void => {
    if (!canStartTranslation()) {
      return;
    }
    setTranslationFormLanguage(props.translationTargetLanguage ?? "");
    setTranslationFormModel(props.translationModel ?? "");
    setTranslationFormEffort(props.translationReasoningEffort ?? "");
    setTranslationDialogOpen(true);
    if (translationCatalogModels().length === 0) {
      void refreshTranslationCatalog();
    }
  };
  const connectTranslationProgress = (eventUrl: string, jobId: string) => {
    translationEventSource?.close();
    const eventSource = new EventSource(eventUrl);
    translationEventSource = eventSource;
    const onProgress = (event: MessageEvent) => {
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

      if (envelope.type === "translation.job.completed") {
        const readerUrl = readTranslationReaderUrl(envelope);
        eventSource.close();
        translationEventSource = undefined;
        if (readerUrl !== undefined) {
          navigate(readerUrl);
        }
      } else if (isTerminalTranslationEvent(envelope.type)) {
        eventSource.close();
        translationEventSource = undefined;
      }
    };

    for (const eventName of TRANSLATION_EVENT_NAMES) {
      eventSource.addEventListener(eventName, onProgress);
    }
    eventSource.onerror = () => {
      setTranslationProgress({
        eventUrl,
        jobId,
        message: "Translation stream disconnected.",
        preview: translationProgress()?.preview ?? "",
        status: "failed",
      });
      eventSource.close();
      translationEventSource = undefined;
    };
  };
  const submitTranslationDialog: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (
    event,
  ) => {
    event.preventDefault();
    const langCode = translationFormLanguage();
    if (langCode === "") {
      return;
    }
    const selectedEffort = translationFormEffort();
    void startTranslation({
      langCode,
      model: translationFormModel() === "" ? null : translationFormModel(),
      reasoningEffort: selectedEffort === ""
        ? null
        : selectedEffort,
    });
  };
  const startTranslation = async (input: {
    langCode: SupportedLanguageCode;
    model: string | null;
    reasoningEffort: CodexReasoningEffort | null;
  }): Promise<void> => {
    const langCode = input.langCode;
    if (langCode === undefined || !canStartTranslation()) {
      return;
    }

    setErrorMessage("");
    setTranslationProgress({
      eventUrl: "",
      jobId: "",
      message: `Starting ${langCode} translation...`,
      preview: "",
      status: "starting",
    });
    try {
      const result = await startReaderTranslation({
        langCode,
        memoryId: props.result.memory.id,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
      });
      if (result.status === "current") {
        setTranslationDialogOpen(false);
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
      setTranslationDialogOpen(false);
      connectTranslationProgress(result.event_url, result.job_id);
    } catch (error) {
      setTranslationProgress({
        eventUrl: "",
        jobId: "",
        message: error instanceof Error ? error.message : "Translation failed.",
        preview: "",
        status: "failed",
      });
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
  const toggleMoment = async (
    section: ReaderMomentSection,
  ): Promise<void> => {
    const sectionKey = getReaderMomentKey(section);
    if (pendingMomentKey().length > 0) {
      return;
    }

    setErrorMessage("");
    setPendingMomentKey(sectionKey);
    try {
      const existingMoment = findReaderMomentForSection(
        moments(),
        props.result.rendered.toc,
        section,
      );
      if (existingMoment !== undefined) {
        await deleteMomentById({ momentId: existingMoment.id });
        setMoments((current) =>
          current.filter((moment) => moment.id !== existingMoment.id),
        );
        await Promise.all([
          revalidateMomentBrowseRows(),
          revalidateReaderMemory(props.result.memory.id),
        ]);
        return;
      }

      const result = await createMomentForSection({
        langCode: props.result.content.langCode,
        memoryId: props.result.memory.id,
        section,
      });
      setMoments((current) =>
        mergeReaderMomentItem(current, result.moment),
      );
      await Promise.all([
        revalidateMomentBrowseRows(),
        revalidateReaderMemory(props.result.memory.id),
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Moment failed");
    } finally {
      setPendingMomentKey("");
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
      <RouteHeader
        class={`${readerPadding} trauma-reader-header`}
        leading={() => (
          <a class="grid size-10 place-items-center rounded-full text-trauma-text-muted hover:bg-trauma-bg-elev hover:text-trauma-text-primary" href="/memories" aria-label="Back to memories">
            <ChevronLeftIcon />
          </a>
        )}
        layout="single"
        title="Memory"
        titleElement="p"
      />
      <div class={`${readerPadding} trauma-reader-body py-5 pb-10`}>
        <div class="trauma-fluid-page-shell">
          <header class="mb-5 grid gap-4">
            <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
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
              <div class="flex items-center gap-2">
                <MemoryReadStatusControl
                  initialRead={props.result.memory.read}
                  memoryId={props.result.memory.id}
                  variant="icon"
                  onSaved={() => revalidateAfterReadStatusChange(props.result.memory.id)}
                />
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
          </header>
          <ReaderVariantTabs variants={props.result.content.variants} />
          <Show when={translationProgress()}>
            {(progress) => (
              <section
                aria-live="polite"
                class="mb-5 grid gap-2 rounded-[20px] border border-trauma-border bg-trauma-bg-elev/50 px-4 py-3 text-sm font-bold text-trauma-text-secondary backdrop-blur"
                role="status"
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
          <div
            ref={contentRef}
            aria-busy={pendingSelectionKey().length > 0}
            class={readerArticle}
            data-reader-content
            data-reader-ready={isReaderClientReady() ? "true" : undefined}
            onClick={handleReaderContentClick}
            onKeyUp={handleKeyboardSelectionToggle}
            onMouseUp={openSelectionMenu}
            onPointerCancel={clearSectionLongPress}
            onPointerLeave={clearSectionLongPress}
            onPointerMove={clearSectionLongPress}
            onPointerUp={clearSectionLongPress}
            onPointerDown={handleReaderContentPointerDown}
            tabIndex={0}
          >
            <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
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
              <Show when={canStartTranslation()}>
                <div class="relative flex shrink-0 justify-end" data-reader-noncontent>
                  <button
                    aria-expanded={translationDialogOpen() ? "true" : "false"}
                    aria-haspopup="dialog"
                    aria-label={`Translate memory to ${props.translationTargetLanguage}`}
                    class="group grid h-10 w-10 grid-cols-[2.5rem_minmax(0,1fr)] items-center overflow-hidden rounded-full text-trauma-text-muted transition-[width,background-color,color] duration-200 hover:w-32 hover:bg-trauma-bg-elev hover:text-trauma-text-primary disabled:opacity-60"
                    disabled={translationProgress()?.status === "starting" || translationProgress()?.status === "running"}
                    title={`Translate to ${props.translationTargetLanguage}`}
                    type="button"
                    onClick={openTranslationDialog}
                  >
                    <span class="grid size-10 place-items-center">
                      <CodexIcon size={18} />
                    </span>
                    <span class="whitespace-nowrap pr-4 text-sm font-extrabold opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      Translate
                    </span>
                  </button>
                  <Show when={translationDialogOpen()}>
                    <form
                      class="absolute right-0 top-12 z-20 grid w-[min(18rem,calc(100vw-2rem))] gap-3 rounded-[18px] border border-trauma-border bg-trauma-bg-elev/50 p-3 text-left shadow-lg backdrop-blur"
                      role="dialog"
                      aria-label="Translation settings"
                      onSubmit={submitTranslationDialog}
                    >
                      <label class="grid gap-1 text-xs font-extrabold text-trauma-text-secondary">
                        Language
                        <select
                          class="min-h-10 w-full min-w-0 rounded-lg border border-trauma-border-strong bg-trauma-bg-surface px-3 text-sm font-bold text-trauma-text-primary"
                          value={translationFormLanguage()}
                          onChange={(event) =>
                            setTranslationFormLanguage(
                              event.currentTarget.value as SupportedLanguageCode,
                            )
                          }
                        >
                          {SUPPORTED_TRANSLATION_LANGUAGES.map((option) => (
                            <option value={option.code}>
                              {option.label} ({option.code})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label class="grid gap-1 text-xs font-extrabold text-trauma-text-secondary">
                        Model
                        <select
                          class="min-h-10 w-full min-w-0 rounded-lg border border-trauma-border-strong bg-trauma-bg-surface px-3 text-sm font-bold text-trauma-text-primary"
                          value={translationFormModel()}
                          onChange={(event) =>
                            setTranslationFormModel(event.currentTarget.value)
                          }
                        >
                          <option value="">Codex app-server default</option>
                          <Show
                            when={
                              translationFormModel() !== "" &&
                              !translationCatalogModels().some((model) =>
                                model.id === translationFormModel() ||
                                model.model === translationFormModel()
                              )
                            }
                          >
                            <option value={translationFormModel()}>
                              {translationFormModel()}
                            </option>
                          </Show>
                          {translationCatalogModels().map((model) => (
                            <option value={model.model}>
                              {model.displayName} ({model.model})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label class="grid gap-1 text-xs font-extrabold text-trauma-text-secondary">
                        Reasoning effort
                        <select
                          class="min-h-10 w-full min-w-0 rounded-lg border border-trauma-border-strong bg-trauma-bg-surface px-3 text-sm font-bold text-trauma-text-primary"
                          value={translationFormEffort()}
                          onChange={(event) =>
                            setTranslationFormEffort(
                              event.currentTarget.value as CodexReasoningEffort | "",
                            )
                          }
                        >
                          <option value="">Selected model default</option>
                          <Show
                            when={
                              translationFormEffort() !== "" &&
                              !translationReasoningEfforts().includes(
                                translationFormEffort() as CodexReasoningEffort,
                              )
                            }
                          >
                            <option value={translationFormEffort()}>
                              {translationFormEffort()}
                            </option>
                          </Show>
                          {translationReasoningEfforts().map((effort) => (
                            <option value={effort}>{effort}</option>
                          ))}
                        </select>
                      </label>
                      <Show when={translationCatalogError()}>
                        {(value) => (
                          <p class="mb-0 text-xs font-bold text-trauma-text-muted">
                            {value()}
                          </p>
                        )}
                      </Show>
                      <div class="flex justify-end gap-2">
                        <button
                          class="inline-flex min-h-9 items-center justify-center rounded-full border border-trauma-border-strong px-3 text-sm font-extrabold text-trauma-text-primary"
                          type="button"
                          onClick={() => setTranslationDialogOpen(false)}
                        >
                          Cancel
                        </button>
                        <button
                          class="inline-flex min-h-9 items-center justify-center rounded-full border border-trauma-border-strong bg-trauma-accent/50 px-3 text-sm font-extrabold text-trauma-accent-ink"
                          type="submit"
                        >
                          Translate
                        </button>
                      </div>
                    </form>
                  </Show>
                </div>
              </Show>
            </div>
            <div data-reader-noncontent>
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
            <div
              ref={bodyContentRef}
              class="contents"
              data-reader-mutable-content
              innerHTML={readerBodyHtml()}
            />
          </div>
          <Show when={selectionMenu()}>
            {(menu) => (
              <ReaderContextMenu
                label="Reader text selection actions"
                menuRef={(element) => {
                  selectionMenuRef = element;
                }}
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
          <Show when={errorMessage()}>
            {(message) => (
              <p class="mt-4 rounded-lg border border-trauma-danger bg-trauma-bg-elev px-3 py-2 text-sm font-semibold text-trauma-danger" role="status">
                {message()}
              </p>
            )}
          </Show>
        </div>
      </div>
    </article>
  );
}

function ReaderVariantTabs(props: { variants: ReaderContentVariant[] }) {
  return (
    <Show when={props.variants.length > 1}>
      <nav
        aria-label="Memory content variants"
        class="mb-5 flex flex-wrap gap-2 border-b border-trauma-border pb-3"
      >
        <For each={props.variants}>
          {(variant) => (
            <a
              aria-current={variant.active ? "page" : undefined}
              class="inline-flex min-h-9 items-center rounded-full border border-trauma-border-strong px-3 text-sm font-extrabold text-trauma-text-secondary transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary aria-[current=page]:bg-trauma-bg-elev aria-[current=page]:text-trauma-text-primary"
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
      <span class="relative inline-grid">
        <TaxonomyAddControl
          attachedItems={props.tags}
          id={`memory-${props.memoryId}-tags-add`}
          kind="tag"
          options={props.tagOptions}
          onAttachName={props.onAddTag}
          onDetachName={props.onRemoveTag}
          onError={props.onTaxonomyError}
        />
      </span>
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

function translationProgressStatusForEvent(
  envelope: ReaderTranslationEventEnvelope,
): TranslationProgressState["status"] {
  if (envelope.type === "translation.job.completed") {
    return "completed";
  }
  if (
    isTerminalTranslationEvent(envelope.type) ||
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
  memoryId: string;
  navigate: (path: string) => void;
  revalidate?: (memoryId: string) => Promise<void>;
}): Promise<void> {
  try {
    await deleteMemoryById({
      memoryId: input.memoryId,
      fetch: input.fetch,
    });
  } catch (error) {
    if (isBackupFailsafeMemoryActionError(error)) {
      void revalidateBackupFailsafeAlert();
    }
    throw error;
  }
  await (input.revalidate ?? revalidateAfterMemoryDeletion)(input.memoryId);
  input.navigate("/memories");
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

async function revalidateAfterReadStatusChange(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateReaderMemory(memoryId),
  ]);
}

async function revalidateAfterReaderTaxonomyChange(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateReaderMemory(memoryId),
  ]);
}

async function revalidateAfterMemoryDeletion(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateFlashbackBrowseRows(),
    revalidateMomentBrowseRows(),
    revalidateReaderMemory(memoryId),
  ]);
}

async function revalidateAfterFlashbackToggle(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateFlashbackBrowseRows(),
    revalidateReaderMemory(memoryId),
    revalidateBrowseMemoryWorkspace(),
  ]);
}

function ReaderContextMenu(props: {
  children: JSX.Element;
  label: string;
  menuRef: (element: HTMLDivElement) => void;
  position: ReaderSelectionMenuPosition;
}) {
  return (
    <div
      ref={props.menuRef}
      aria-label={props.label}
      class={readerContextMenuClass}
      role="menu"
      style={{
        left: `${props.position.left}px`,
        top: `${props.position.top}px`,
      }}
    >
      {props.children}
    </div>
  );
}

function ReaderRightRailContent(props: {
  allFlashbacks: FlashbackBrowseRow[] | undefined;
  currentFlashbacks: ReaderFlashbackItem[];
  moments: ReaderMomentItem[];
  memoryId: string;
  onCreateMoment: (section: ReaderMomentSection) => void;
  onOpenSectionMenu: (section: ReaderMomentSection, rect: DOMRect) => void;
  pendingMomentKey: string;
  toc: ReaderTocEntry[];
}) {
  return (
    <div class="grid gap-4">
      <ReaderToc
        moments={props.moments}
        onCreateMoment={props.onCreateMoment}
        onOpenSectionMenu={props.onOpenSectionMenu}
        pendingMomentKey={props.pendingMomentKey}
        toc={props.toc}
      />
      <ReaderFlashbackTabs
        allFlashbacks={props.allFlashbacks}
        currentFlashbacks={props.currentFlashbacks}
        memoryId={props.memoryId}
      />
    </div>
  );
}

export function ReaderFlashbackTabs(props: {
  allFlashbacks: FlashbackBrowseRow[] | undefined;
  currentFlashbacks: ReaderFlashbackItem[];
  initialTab?: "all" | "memory";
  memoryId: string;
}) {
  const [activeTab, setActiveTab] = createSignal<"all" | "memory">(
    props.initialTab ?? "memory",
  );
  const allRows = createMemo(() => props.allFlashbacks ?? []);
  const isLoadingAll = () => props.allFlashbacks === undefined;

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
          onClick={() => setActiveTab("all")}
        >
          All
        </SegmentedToggleButton>
      </div>
      <Show
        when={activeTab() === "memory"}
        fallback={
          <FlashbackShortcutList
            emptyLabel="No flashbacks yet"
            flashbacks={allRows().map((flashback) => ({
              id: flashback.id,
              href: buildMemoryAnchorHref({
                anchorId: flashback.id,
                memoryId: flashback.memoryId,
              }),
              prefix: flashback.prefix,
              suffix: flashback.suffix,
              text: flashback.text,
            }))}
            isLoading={isLoadingAll()}
          />
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
      <div class={readerStatePanel}>
        <h1 class="mb-2 text-3xl font-bold text-trauma-text-primary" id="reader-state-title">{props.message}</h1>
        <p>Open another memory from the archive.</p>
      </div>
    </section>
  );
}

function ReaderToc(props: {
  moments: ReaderMomentItem[];
  onCreateMoment: (section: ReaderMomentSection) => void;
  onOpenSectionMenu: (section: ReaderMomentSection, rect: DOMRect) => void;
  pendingMomentKey: string;
  toc: ReaderTocEntry[];
}) {
  let scrollRef: HTMLOListElement | undefined;
  const [tocScrollState, setTocScrollState] =
    createSignal<TocScrollState>(noTocScrollState);
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

  onMount(() => {
    updateTocScrollHint();
    window.addEventListener("resize", updateTocScrollHint);
    onCleanup(() => window.removeEventListener("resize", updateTocScrollHint));
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
            class={`${readerTocScrollContent} m-0 grid gap-2.5 pl-0`}
            onScroll={updateTocScrollHint}
          >
            {props.toc.map((entry) => (
              <ReaderTocEntryRow
                active={props.moments.some(
                  (moment) =>
                    resolveReaderMomentTarget(moment, props.toc)?.id === entry.id,
                )}
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

export function resolveReaderMomentTarget(
  moment: ReaderMomentItem,
  toc: ReaderTocEntry[],
): ReaderTocEntry | undefined {
  const exact = toc.find((entry) =>
    entry.id === moment.sectionAnchor &&
    entry.path === moment.sectionPath
  );
  if (exact !== undefined) {
    return exact;
  }

  const pathMatches = toc.filter((entry) => entry.path === moment.sectionPath);
  return pathMatches.length === 1 ? pathMatches[0] : undefined;
}

export function findReaderMomentForSection(
  moments: ReaderMomentItem[],
  toc: ReaderTocEntry[],
  section: ReaderMomentSection,
): ReaderMomentItem | undefined {
  return moments.find((moment) =>
    resolveReaderMomentTarget(moment, toc)?.id === section.id
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

  for (const button of input.container.querySelectorAll<HTMLButtonElement>(
    "button[data-reader-moment-trigger='true']",
  )) {
    const sectionElement = findReaderSectionElement(button, input.container);
    const section = sectionElement === undefined
      ? undefined
      : readReaderSection(sectionElement);
    const active = section !== undefined &&
      findReaderMomentForSection(input.moments, input.toc, section) !== undefined;
    button.setAttribute("aria-pressed", String(active));
  }
}

function ReaderTocEntryRow(props: {
  active: boolean;
  entry: ReaderTocEntry;
  onCreateMoment: (section: ReaderMomentSection) => void;
  onOpenSectionMenu: (section: ReaderMomentSection, rect: DOMRect) => void;
  pending: boolean;
}) {
  let rowRef: HTMLLIElement | undefined;
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
      class="group grid grid-cols-[1.125rem_minmax(0,1fr)] items-start gap-1"
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
        class="mt-0.5 grid size-5 place-items-center rounded-full text-trauma-text-muted opacity-0 transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary group-hover:opacity-100 aria-pressed:opacity-100 aria-pressed:text-trauma-link"
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
      <a class="hover:text-trauma-link" href={`#${props.entry.id}`}>
        {props.entry.text}
      </a>
    </li>
  );
}

async function toggleReaderSelection(input: {
  container: HTMLDivElement;
  langCode?: SupportedLanguageCode;
  memoryId: string;
  onFlashbacksChanged: (flashbacks: ReaderFlashbackItem[]) => void;
  onSuccess: () => Promise<void> | void;
  pendingSelectionKey: string;
  selection: ReaderSelection;
  setErrorMessage: (message: string) => void;
  setPendingSelectionKey: (key: string) => void;
}) {
  if (!canStartFlashbackToggle(input.pendingSelectionKey)) {
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

    const failure = await readFlashbackFailure(response);
    if (failure !== undefined) {
      if (shouldRevalidateBackupFailsafeAfterFlashbackFailure(failure)) {
        void revalidateBackupFailsafeAlert();
      }

      throw new Error(failure.message);
    }
    const payload = await readFlashbackToggleSuccess(response);
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
    input.onFlashbacksChanged(payload.result.flashbacks);
    void Promise.resolve(input.onSuccess()).catch(() => undefined);
  } catch {
    input.container.innerHTML = previousHtml;
    input.setErrorMessage("Flashback failed");
  } finally {
    input.setPendingSelectionKey("");
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

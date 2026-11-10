import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AIResponseParser } from '../../utils/ai-response-parser';
import { AIRevampResponse, AIChange } from '../../types/ai-response';
import { Operation, OperationsResponse } from '../../types/operations';
import { parseOperationsResponse } from '../../utils/operation-parser';
import { buildSystemPrompt, PageIndexData } from '../../utils/prompt-builder';
import { resolveAttachmentSources } from '../../utils/attachment-refs';
import { shrinkDataUrl } from '../../utils/image-shrink';
import { countImageSlots, gatherWebImages, keywordsFrom, pageUrlsFrom, WebImageSource } from '../../utils/web-images';
import { Ask, completeReply, describeEmptyReply, ReplyInfo } from '../../utils/reply-continuation';
import { repairOperations } from '../../utils/operation-repair';
import { InspectedElement } from '../../types/inspector';
import ChangePreview, { ChangeItem, PreviewStatus } from './ChangePreview';
import AttachmentChips from './AttachmentChips';
import { pastedImageFiles, useAttachments } from '../use-attachments';
import { attachmentStoreFor, memoryAttachmentStore } from '../attachment-store-instance';
import { chatKey, getTabId } from '../../utils/tab-scope';
import { acceptedFileTypes, getCapabilities, providerLabel } from '../../ai/capabilities';
import { buildRequestMessages } from '../../utils/chat-content';
import { AttachmentMeta } from '../../types/attachments';
import { ensureContentScript } from '../tab-messaging';
import { InspectorControl } from '../use-inspector';

/** The model answered, but with nothing to parse: not an API-key problem, and worth retrying */
class EmptyReplyError extends Error {}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  // Files attached to a user message: metadata only, the content lives in IndexedDB
  attachments?: AttachmentMeta[];
  // Files that were not sent as attached (unsupported by the provider, gone, too large)
  notes?: string[];
  // Legacy single action format (backward compatibility)
  action?: {
    action: 'text' | 'css' | 'html' | 'attribute' | 'script';
    value: any;
    attribute?: string;
    selector?: string;
    scope?: 'element' | 'page';
  };
  // Selector-based structured format (fallback when model ignores the operations format)
  revampResponse?: AIRevampResponse;
  // Operations on indexed elements (preferred format)
  operationsResponse?: OperationsResponse;
}

interface Props {
  inspector: InspectorControl;
  selectedElement?: InspectedElement | null;
  onClear?: () => void;
  /** Text to put in the input box, e.g. coming from the Demo tab */
  initialPrompt?: string | null;
  onPromptConsumed?: () => void;
}

const AIChatBox: React.FC<Props> = ({ inspector, selectedElement, onClear, initialPrompt, onPromptConsumed }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [apiKeysLoaded, setApiKeysLoaded] = useState(false);
  useEffect(() => {
    if (initialPrompt) {
      setInput(initialPrompt);
      onPromptConsumed?.();
    }
  }, [initialPrompt]);

  const [previewStatus, setPreviewStatus] = useState<PreviewStatus | null>(null);
  // Image lists read from pages the user named; kept so later messages can still use them
  const webImageCache = useRef(new Map<string, WebImageSource>());
  // Sections a document rewrite would leave as they were, per assistant message. Not persisted: ids die with the page.
  const [untouched, setUntouched] = useState<Record<string, Array<{ id: number; label: string }>>>({});
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  // Chat and files belong to this browser tab; undefined until resolved, and stays undefined if it cannot be
  const [tabId, setTabId] = useState<number | undefined>(undefined);
  const [tabResolved, setTabResolved] = useState(false);
  const fallbackStore = useRef(memoryAttachmentStore());
  const attachmentStore = useMemo(
    () => (tabId === undefined ? fallbackStore.current : attachmentStoreFor(tabId)),
    [tabId]
  );
  const caps = getCapabilities(provider);
  const attachments = useAttachments(caps, attachmentStore);

  useEffect(() => {
    getTabId().then((id) => {
      setTabId(id);
      setTabResolved(true);
    });
  }, []);

  // Provider labels for display
  const providerLabels: Record<string, string> = {
    openai: 'OpenAI',
    azure: 'Azure OpenAI',
    claude: 'Claude',
    gemini: 'Gemini',
    perplexity: 'Perplexity',
    mistral: 'Mistral',
    cohere: 'Cohere',
    groq: 'Groq',
    openrouter: 'OpenRouter',
  };

  // Default model options (fallback if API fetch fails)
  const defaultModelOptions: Record<string, string[]> = {
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    azure: [],
    claude: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    gemini: ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
    perplexity: ['llama-3.1-sonar-large-128k-online', 'llama-3.1-sonar-small-128k-online'],
    mistral: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo'],
    cohere: ['command-r-plus', 'command-r', 'command'],
    groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    openrouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-exp:free'],
  };

  // Load this tab's chat history on mount
  useEffect(() => {
    // Without a tab id the chat stays in memory: saving to a shared key would leak it into other tabs
    if (!tabResolved || tabId === undefined) return;
    const loadChatHistory = async () => {
      try {
        const result = await chrome.storage.session.get(chatKey(tabId));
        const saved = result[chatKey(tabId)];
        if (Array.isArray(saved)) {
          console.log('[AI Chat] Loaded chat history:', saved.length, 'messages');
          setMessages(saved);
        } else {
          console.log('[AI Chat] No chat history found in storage');
        }
      } catch (error) {
        console.error('[AI Chat] Failed to load chat history:', error);
      } finally {
        setMessagesLoaded(true);
      }
    };

    loadChatHistory();
  }, [tabResolved, tabId]);

  // Save chat history to storage whenever messages change (with debounce)
  useEffect(() => {
    // Don't save until messages are loaded to avoid overwriting with empty array
    if (!messagesLoaded || tabId === undefined) return;

    // Debounce save to avoid too many writes
    const timeoutId = setTimeout(async () => {
      try {
        await chrome.storage.session.set({ [chatKey(tabId)]: messages });
        console.log('[AI Chat] Saved chat history:', messages.length, 'messages');
      } catch (error) {
        console.error('[AI Chat] Failed to save chat history:', error);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [messages, messagesLoaded, tabId]);

  // Load API keys and determine available providers
  useEffect(() => {
    const loadApiKeys = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        if (response.success && response.data.apiKeys) {
          const keys = response.data.apiKeys;
          setApiKeys(keys);
          
          // Filter providers that have API keys set
          const available = Object.entries(keys)
            .filter(([_, value]) => value && (value as string).trim() !== '')
            .map(([key, _]) => key);
          
          setAvailableProviders(available);
          
          // Set default provider to first available
          if (available.length > 0) {
            setProvider(available[0]);
          }
        }
        setApiKeysLoaded(true);
      } catch (error) {
        console.error('[AI Chat] Failed to load API keys:', error);
        setApiKeysLoaded(true);
      }
    };

    loadApiKeys();
  }, []);

  // Fetch models when provider changes
  useEffect(() => {
    const fetchModelsForProvider = async () => {
      if (!provider || !apiKeys[provider]) return;

      // Check if we already have models for this provider
      if (providerModels[provider] && providerModels[provider].length > 0) {
        setModel(providerModels[provider][0]);
        return;
      }

      setLoadingModels(true);
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'FETCH_MODELS',
          payload: { provider, apiKey: apiKeys[provider] }
        });

        if (response.success && response.data && response.data.length > 0) {
          setProviderModels(prev => ({
            ...prev,
            [provider]: response.data
          }));
          setModel(response.data[0]);
        } else {
          // Fallback to defaults
          const defaults = defaultModelOptions[provider] || [];
          setProviderModels(prev => ({
            ...prev,
            [provider]: defaults
          }));
          setModel(defaults[0] || '');
        }
      } catch (error) {
        console.error('[AI Chat] Failed to fetch models:', error);
        // Fallback to defaults
        const defaults = defaultModelOptions[provider] || [];
        setProviderModels(prev => ({
          ...prev,
          [provider]: defaults
        }));
        setModel(defaults[0] || '');
      } finally {
        setLoadingModels(false);
      }
    };

    fetchModelsForProvider();
  }, [provider, apiKeys]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const draftAttachments = attachments.ready;
    const draftText = input;
    const text = input.trim();
    if ((!text && draftAttachments.length === 0) || isLoading || attachments.busy) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      ...(draftAttachments.length > 0 && { attachments: draftAttachments }),
    };
    let requestNotes: string[] = [];

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    attachments.clear();
    setIsLoading(true);

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      // Ensure content script is loaded
      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        throw new Error('Failed to initialize content script. Please refresh the page.');
      }

      // Index the page (or the selected element) so the AI can reference elements by id
      let pageIndexData: PageIndexData | null = null;
      try {
        const indexResponse = await chrome.tabs.sendMessage(tab.id, {
          type: 'GET_PAGE_INDEX',
          selector: selectedElement?.selector?.selector || undefined,
        });

        if (indexResponse.success) {
          pageIndexData = indexResponse.data;
          console.log('[AI Chat] Page index received:', {
            mode: pageIndexData?.mode,
            count: pageIndexData?.count,
            truncated: pageIndexData?.truncated,
          });
        } else {
          console.warn('[AI Chat] Failed to get page index:', indexResponse.error);
        }
      } catch (indexError) {
        console.warn('[AI Chat] Could not get page index:', indexError);
      }

      const images = [...messages.flatMap((m) => m.attachments ?? []), ...draftAttachments]
        .filter((a) => a.kind === 'image')
        .map(({ id, name }) => ({ id, name }));
      const hasAttachments = draftAttachments.length > 0 || messages.some((m) => m.attachments?.length);
      const webImages: WebImageSource[] = [];
      const webNotes: string[] = [];
      // What the pictures should be about: the typed text and the attached documents
      const keywordsOf = async () => {
        const documents = await Promise.all(
          draftAttachments.filter((a) => a.kind === 'document').map((a) => attachmentStore.get(a.id))
        );
        const texts = documents.flatMap((doc) => doc?.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])) ?? []);
        return keywordsFrom([text, ...texts]);
      };
      const slots = countImageSlots(pageIndexData?.index ?? '');
      for (const page of pageUrlsFrom(text)) {
        const cached = webImageCache.current.get(page);
        const result = cached
          ? { ok: true as const, source: cached, fromLibrary: 0 }
          : await gatherWebImages(page, { needed: slots, keywords: slots > 0 ? await keywordsOf() : [] });
        if (result.ok) {
          webImageCache.current.set(page, result.source);
          webImages.push(result.source);
          if (!cached) {
            const library = result.fromLibrary > 0 ? `, ${result.fromLibrary} of them from the site's media library because the page has fewer images than this page has places for` : '';
            webNotes.push(`Read ${result.source.images.length} images from ${new URL(page).host} for the AI to choose from${library}.`);
          }
        } else {
          webNotes.push(`Could not read images from ${page}: ${result.error}.`);
        }
      }
      // Pages named earlier in the chat stay available without reading them again
      for (const entry of messages) {
        if (entry.role !== 'user') continue;
        for (const page of pageUrlsFrom(entry.content)) {
          const cached = webImageCache.current.get(page);
          if (cached && !webImages.includes(cached) && webImages.length < 3) webImages.push(cached);
        }
      }
      const built = await buildRequestMessages({
        systemPrompt: buildSystemPrompt(pageIndexData, { hasAttachments, images, webImages }),
        history: messages.map((m) => ({ role: m.role, text: m.content, attachments: m.attachments })),
        draft: { text, attachments: draftAttachments },
        load: (id) => attachmentStore.get(id),
        caps,
        providerLabel: providerLabel(provider),
      });
      requestNotes = [...built.notes, ...webNotes];
      if (pageIndexData?.truncated) {
        requestNotes.push(
          `The page is long: only its first ${pageIndexData.count} elements were sent, so content further down was not changed. Select a section in the Inspector and repeat for the rest.`
        );
      }

      // Translating or rewriting a whole page needs room: every changed text is returned in full
      const maxTokens = provider === 'azure' || /2\.5|2\.0|gpt-4o|gpt-4\.1/.test(model) ? 8192 : 4096;
      const ask: Ask = (messages, tokens) =>
        chrome.runtime.sendMessage({
          type: 'AI_REQUEST',
          payload: { provider, model, messages, options: { maxTokens: tokens, temperature: 0.3 } },
        });
      // chrome.runtime.sendMessage answers untyped; the usage block is read below
      const response: any = await ask(built.messages, maxTokens);

      if (response.success) {
        // Parse AI response for actionable changes
        let aiContent: string = response.data.content ?? '';
        let cutOff = !!response.data.truncated;
        let lastReply: ReplyInfo | undefined = response.data;
        if (cutOff) {
          const finished = await completeReply(ask, built.messages, maxTokens, { content: aiContent, truncated: true, info: response.data });
          aiContent = finished.content;
          cutOff = finished.truncated;
          lastReply = finished.last ?? lastReply;
          if (finished.extraRequests > 0) {
            requestNotes.push(`The reply hit the output limit, so the AI was asked ${finished.extraRequests} more time(s) to finish it.`);
          }
        }
        
        console.log('[AI Chat] Received AI response, length:', aiContent.length, 'finish reason:', lastReply?.finishReason, 'usage:', lastReply?.usage);
        if (!aiContent.trim()) throw new EmptyReplyError(describeEmptyReply({ ...lastReply, truncated: cutOff }));
        console.log('[AI Chat] Response preview:', aiContent.substring(0, 300));
        
        // Check if response was truncated
        let truncationWarning = '';
        if (response.data.usage && response.data.usage.totalTokens) {
          const usage = response.data.usage;
          // Check for signs of truncation
          if (usage.completionTokens && usage.completionTokens < 100) {
            truncationWarning = '\n\n⚠️ Warning: Response may be incomplete (very short output). Try using a non-experimental model.';
          }
        }
        
        if (cutOff) {
          truncationWarning +=
            '\n\n⚠️ The reply was cut off at the output limit, so some changes may be missing. Ask again for the sections that were not changed.';
        }

        // Preferred: operations on indexed elements
        let operationsResponse = parseOperationsResponse(aiContent);

        // set_html on a section would strip its template styling: have the page check, and ask the model to redo those
        const rebuilds = operationsResponse?.operations.filter((o) => o.op === 'set_html') ?? [];
        if (operationsResponse && rebuilds.length > 0) {
          try {
            const check = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_OPERATIONS', payload: { operations: rebuilds } });
            const problems = check?.success ? check.data.problems : [];
            if (problems.length > 0) {
              const fixed = await repairOperations(ask, built.messages, maxTokens, aiContent, operationsResponse, problems);
              if (fixed.repaired) {
                operationsResponse = fixed.response;
                aiContent = fixed.content;
                requestNotes.push(
                  `${problems.length} change(s) would have broken the layout (they rebuilt a section's HTML), so the AI was asked to redo them as separate text changes.`
                );
              } else {
                requestNotes.push(`${problems.length} change(s) would break the layout and cannot be applied; ask the AI to change those sections element by element.`);
              }
            }
          } catch (checkError) {
            console.warn('[AI Chat] Could not check operations:', checkError);
          }
        }

        // Fallback: selector-based structured response
        const revampResponse = operationsResponse ? null : AIResponseParser.parse(aiContent);
        
        // Fallback: Try legacy single-action format
        let legacyAction;
        if (!operationsResponse && !revampResponse) {
          console.warn('[AI Chat] Structured parsing failed, trying legacy format');
          
          const patterns = [
            /```json\s*\n?([\s\S]*?)\n?```/,
            /```\s*\n?(\{[\s\S]*?\})\s*\n?```/,
            /\{\s*"action"\s*:[\s\S]*?\}/,
          ];

          for (const pattern of patterns) {
            const match = aiContent.match(pattern);
            if (match) {
              try {
                const jsonStr = match[1] || match[0];
                const cleanJson = jsonStr.trim();
                legacyAction = JSON.parse(cleanJson);
                
                if (legacyAction && legacyAction.action) {
                  console.log('[AI Chat] Successfully parsed legacy action:', legacyAction);
                  break;
                }
              } catch (e) {
                console.warn('[AI Chat] Failed to parse with pattern:', pattern, e);
              }
            }
          }
          
          // If still no valid format found, log warning
          if (!legacyAction) {
            console.warn('[AI Chat] No actionable changes found in AI response');
            console.warn('[AI Chat] AI may have responded with explanation only, or JSON was malformed');
          }
        }

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: aiContent + truncationWarning,
          timestamp: Date.now(),
          ...(requestNotes.length > 0 && { notes: requestNotes }),
          action: legacyAction,
          revampResponse: revampResponse || undefined,
          operationsResponse: operationsResponse || undefined,
        };
        
        if (operationsResponse) {
          console.log('[AI Chat] Parsed', operationsResponse.operations.length, 'operations');
        } else if (revampResponse) {
          console.log('[AI Chat] Parsed structured response with', revampResponse.changes.length, 'changes');
        } else if (legacyAction) {
          console.log('[AI Chat] Parsed legacy single action');
        } else {
          console.log('[AI Chat] No actionable changes found in response');
        }
        
        setMessages((prev) => [...prev, assistantMessage]);

        // A document replaces the page's content: find the sections it left out so they can be hidden
        const fromDocument = draftAttachments.some((a) => a.kind === 'document' || a.kind === 'pdf');
        if (fromDocument && operationsResponse && operationsResponse.operations.length > 0 && pageIndexData?.mode === 'page') {
          try {
            const coverage = await chrome.tabs.sendMessage(tab.id, {
              type: 'SECTION_COVERAGE',
              payload: { targets: operationsResponse.operations.map((o) => o.target) },
            });
            const left = coverage?.success ? coverage.data.untouched : [];
            if (left.length > 0) setUntouched((prev) => ({ ...prev, [assistantMessage.id]: left }));
          } catch (coverageError) {
            console.warn('[AI Chat] Could not check section coverage:', coverageError);
          }
        }
      } else {
        throw new Error(response.error || 'AI request failed');
      }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: error instanceof EmptyReplyError ? error.message : `Error: ${error}. Please check your API key in Settings.`,
        timestamp: Date.now(),
      };
      // The request did not go through: give the draft back and keep the failed turn (and its files) out of the history
      setMessages((prev) => [...prev.filter((m) => m.id !== userMessage.id), errorMessage]);
      setInput(draftText);
      attachments.restore(draftAttachments);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = async () => {
    console.log('[AI Chat] Clear button clicked, messages count:', messages.length);
    if (messages.length === 0) {
      console.log('[AI Chat] No messages to clear');
      return;
    }
    if (confirm('Clear all chat messages? This will permanently delete chat history.')) {
      console.log('[AI Chat] Clearing messages and storage');
      setUntouched({});
      
      // Clear state first
      setMessages([]);
      attachments.clear();
      attachmentStore.clear().catch((error) => console.error('[AI Chat] Failed to clear attachments:', error));
      
      if (tabId !== undefined) {
        try {
          await chrome.storage.session.remove(chatKey(tabId));
          console.log('[AI Chat] ✓ Chat history cleared from storage');
        } catch (error) {
          console.error('[AI Chat] Failed to clear chat history from storage:', error);
        }
      }
    } else {
      console.log('[AI Chat] Clear cancelled by user');
    }
  };

  // Run an action against the active tab, making sure the content script is up
  const withActiveTab = async <T,>(fn: (tabId: number) => Promise<T>): Promise<T | undefined> => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) throw new Error('No active tab');

    const ready = await ensureContentScript(tab.id);
    if (!ready) {
      alert('Failed to reach the page. Please refresh it and try again.');
      return undefined;
    }
    return fn(tab.id);
  };

  const asParsedResponse = (change: AIChange) => ({
    success: true,
    explanation: change.explanation,
    changes: [change],
    estimatedImpact: 'low',
  });

  // Toggle highlight of a change's target elements on the page
  const togglePreview = async (message: Message, changeId: string) => {
    try {
      await withActiveTab(async (tabId) => {
        // Second click on the active eye turns the highlight off
        if (previewStatus?.changeId === changeId) {
          await chrome.tabs.sendMessage(tabId, { type: 'CLEAR_PREVIEW' });
          setPreviewStatus(null);
          return;
        }

        setPreviewStatus({ changeId });

        const operation = message.operationsResponse?.operations.find((o) => o.id === changeId);
        const legacy = message.revampResponse?.changes.find((c) => c.id === changeId);

        const response = operation
          ? await chrome.tabs.sendMessage(tabId, {
              type: 'PREVIEW_OPERATIONS',
              payload: { operations: [operation] },
            })
          : legacy
          ? await chrome.tabs.sendMessage(tabId, {
              type: 'PREVIEW_CHANGES',
              payload: { parsedResponse: asParsedResponse(legacy) },
            })
          : null;

        if (response?.success) {
          setPreviewStatus({
            changeId,
            matches: response.data?.matches?.[changeId] ?? 0,
            error: response.data?.errors?.[changeId],
          });
        } else {
          setPreviewStatus({ changeId, error: response?.error || 'Preview failed' });
        }
      });
    } catch (error) {
      console.error('[AI Chat] Error previewing change:', error);
      setPreviewStatus({ changeId, error: 'Could not reach the page' });
    }
  };

  // Apply a chosen subset of a message's changes
  const applySelectedChanges = async (message: Message, ids: string[]) => {
    if (ids.length === 0) return;

    try {
      await withActiveTab(async (tabId) => {
        // Uploaded images travel as "attachment:<id>"; the page needs the actual data URL
        const { operations, errors: unresolved } = await resolveAttachmentSources(
          (message.operationsResponse?.operations || []).filter((o) => ids.includes(o.id)),
          (id) => attachmentStore.get(id),
          shrinkDataUrl
        );
        const legacyChanges = (message.revampResponse?.changes || []).filter((c) => ids.includes(c.id));
        if (unresolved.length > 0) {
          alert(unresolved.map((e) => e.error).join('\n'));
          if (operations.length === 0 && legacyChanges.length === 0) return;
        }

        const response = operations.length > 0
          ? await chrome.tabs.sendMessage(tabId, {
              type: 'APPLY_OPERATIONS',
              payload: { operations },
            })
          : await chrome.tabs.sendMessage(tabId, {
              type: 'APPLY_AI_REVAMP',
              payload: {
                parsedResponse: {
                  success: true,
                  explanation: '',
                  changes: legacyChanges,
                  estimatedImpact: 'low',
                },
              },
            });
        setPreviewStatus(null);

        if (response.success) {
          let text = `✓ ${response.data.summary}`;
          const failures = response.data.failures;
          if (failures && failures.length > 0) {
            text += `\n\n⚠️ ${failures.length} change(s) failed:`;
            failures.forEach((f: any) => {
              text += `\n- ${f.error}`;
            });
          }
          alert(text);
        } else {
          alert(`Failed to apply changes: ${response.error}`);
        }
      });
    } catch (error) {
      console.error('[AI Chat] Error applying changes:', error);
      alert(`Error: ${error}`);
    }
  };

  const hideUntouched = async (messageId: string) => {
    const sections = untouched[messageId] ?? [];
    if (sections.length === 0) return;

    try {
      await withActiveTab(async (tabId) => {
        const operations: Operation[] = sections.map((s) => ({
          id: `hide-${s.id}`,
          op: 'set_visibility',
          target: s.id,
          visible: false,
          explanation: `Hide ${s.label}`,
        }));
        const response = await chrome.tabs.sendMessage(tabId, { type: 'APPLY_OPERATIONS', payload: { operations } });
        if (response?.success) {
          setUntouched((prev) => {
            const next = { ...prev };
            delete next[messageId];
            return next;
          });
        } else {
          alert(`Failed to hide sections: ${response?.error}`);
        }
      });
    } catch (error) {
      console.error('[AI Chat] Error hiding sections:', error);
      alert(`Error: ${error}`);
    }
  };

  // Undo the most recent applied change on the page
  const undoLast = async () => {
    try {
      await withActiveTab(async (tabId) => {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'UNDO_CHANGE' });
        if (!response?.success) alert('Nothing to undo.');
      });
    } catch (error) {
      console.error('[AI Chat] Undo failed:', error);
    }
  };

  const changeItems = (message: Message): ChangeItem[] => {
    if (message.operationsResponse) {
      return message.operationsResponse.operations.map((op: Operation) => ({
        id: op.id,
        badge: op.op,
        target: op.op === 'move' ? `[${op.target}] → ${op.position} [${op.ref}]` : `[${op.target}]`,
        explanation: op.explanation,
      }));
    }
    return (message.revampResponse?.changes || []).map((c) => ({
      id: c.id,
      badge: c.action,
      target: c.selector,
      explanation: c.explanation,
    }));
  };

  const applyAction = async (message: Message) => {
    if (!message.action) {
      alert('No action to apply');
      return;
    }

    const action = message.action;
    
    // For page-level changes with custom selector, we don't need selectedElement
    const isPageLevel = action.selector || action.scope === 'page';
    
    if (!isPageLevel && !selectedElement) {
      alert('No element selected. This action requires element selection.');
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      // Ensure content script is loaded
      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        alert('Failed to apply changes. Please refresh the page.');
        return;
      }

      // Prepare payload
      const payload: any = {
        action: action.action,
        value: action.value,
      };

      // Add selector: use custom selector if provided, otherwise use selected element
      if (action.selector) {
        payload.selector = { 
          selector: action.selector, 
          type: 'css-path',
          confidence: 'high'
        };
      } else if (selectedElement) {
        payload.selector = selectedElement.selector;
      }

      // Add attribute if present
      if (action.attribute) {
        payload.attribute = action.attribute;
      }

      console.log('[AI Chat] Applying action:', payload);

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_AI_CHANGE',
        payload,
      });

      console.log('[AI Chat] Apply response:', response);

      if (response.success) {
        const scope = isPageLevel ? 'page-wide' : 'element';
        const count = response.data?.appliedCount || 1;
        alert(`✓ Changes applied successfully to ${count} element(s) (${scope})!`);
      } else {
        alert(`Failed to apply: ${response.error}`);
      }
    } catch (error) {
      console.error('[AI Chat] Apply error:', error);
      alert(`Error: ${error}`);
    }
  };

  // Optimize prompt by reducing verbosity


  return (
    <div
      className={`flex flex-col h-full ${draggingFiles ? 'ring-2 ring-inset ring-blue-400' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDraggingFiles(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDraggingFiles(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDraggingFiles(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0 && !isLoading) void attachments.addFiles(files);
      }}
    >
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900">AI Assistant</h3>
          <div className="flex gap-2">
            <button
              onClick={inspector.toggle}
              className={`text-xs px-3 py-1 rounded ${
                inspector.active
                  ? 'bg-red-100 text-red-700 border border-red-300'
                  : 'bg-blue-100 text-blue-700 border border-blue-300'
              }`}
              title="Toggle Inspector"
            >
              {inspector.active ? '⊗ Stop' : '⊕ Inspector'}
            </button>
            <button
              onClick={clearChat}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                messages.length === 0
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-gray-600 hover:text-red-600 hover:bg-red-50'
              }`}
              disabled={messages.length === 0}
              title={messages.length === 0 ? 'No messages to clear' : 'Clear all messages'}
            >
              Clear Chat
            </button>
          </div>
        </div>

        {/* Element context banner */}
        {selectedElement && (
          <div className="bg-green-50 border border-green-200 rounded p-2 text-xs mb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-green-800">Selected:</span>
                <code className="bg-green-100 px-1 py-0.5 rounded text-green-900">
                  {selectedElement.tagName}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-600 text-xs">✓ Ready</span>
                {onClear && (
                  <button
                    onClick={onClear}
                    className="text-xs text-green-700 hover:text-red-600 hover:underline transition-colors"
                    title="Clear selected element"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="mt-1 text-green-700 truncate" title={selectedElement.selector.selector}>
              {selectedElement.selector.selector}
            </div>
          </div>
        )}

        {/* Provider selection - Only show providers with API keys */}
        {!apiKeysLoaded ? (
          <div className="text-xs text-gray-500 text-center py-2">Loading providers...</div>
        ) : availableProviders.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-800">
            ⚠️ No API keys configured. Go to <strong>Settings</strong> tab to add your API keys.
          </div>
        ) : (
          <div className="flex gap-2">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
            >
              {availableProviders.map((p) => (
                <option key={p} value={p}>
                  {providerLabels[p] || p}
                </option>
              ))}
            </select>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
              disabled={loadingModels}
            >
              {loadingModels ? (
                <option value="">Loading models...</option>
              ) : (
                (providerModels[provider] || defaultModelOptions[provider] || []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))
              )}
            </select>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-xs mt-8">
            <p className="mb-2">👋 Hi! I can help you with:</p>
            <ul className="text-xs text-left max-w-xs mx-auto space-y-1">
              <li>• <strong>Element-level:</strong> Rewrite text, modify attributes</li>
              <li>• <strong>Page-wide:</strong> Change colors, fonts, spacing across page</li>
              <li>• <strong>Layout:</strong> Redesign sections, adjust structure</li>
              <li>• <strong>CSS:</strong> Apply styles to multiple elements</li>
              <li>• <strong>HTML:</strong> Generate or modify content</li>
            </ul>
            <div className="mt-3 text-xs bg-blue-50 border border-blue-200 rounded p-2">
              <strong>Two modes:</strong><br/>
              <span className="text-green-700">✓ With element selected:</span> Targeted changes<br/>
              <span className="text-purple-700">✓ Without selection:</span> Page-wide transformations
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-900'
              }`}
            >
              {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
              {message.attachments && message.attachments.length > 0 && (
                <div className={message.content ? 'mt-2' : ''}>
                  <AttachmentChips
                    items={message.attachments.map((a) => ({
                      key: a.id, name: a.name, kind: a.kind, size: a.size, thumb: a.thumb, status: 'ready' as const,
                    }))}
                  />
                </div>
              )}
              {message.notes && message.notes.length > 0 && (
                <ul className="mt-2 text-[10px] text-gray-500 list-disc pl-4">
                  {message.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}
              
              {/* Structured response: operations on indexed elements, or selector-based changes */}
              {message.role === 'assistant' && changeItems(message).length > 0 && (
                <>
                  <ChangePreview
                    changes={changeItems(message)}
                    previewStatus={previewStatus}
                    onApply={(id) => applySelectedChanges(message, [id])}
                    onApplySelected={(ids) => applySelectedChanges(message, ids)}
                    onTogglePreview={(id) => togglePreview(message, id)}
                  />
                  {message.operationsResponse?.warnings && message.operationsResponse.warnings.length > 0 && (
                    <ul className="mt-1 text-[10px] text-yellow-700 list-disc pl-4">
                      {message.operationsResponse.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                  {(untouched[message.id]?.length ?? 0) > 0 && (
                    <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded p-2 text-[11px] text-yellow-800">
                      <div>
                        {untouched[message.id].length === 1 ? '1 section keeps' : `${untouched[message.id].length} sections keep`} its old content:{' '}
                        {untouched[message.id].slice(0, 4).map((s) => s.label).join(', ')}
                        {untouched[message.id].length > 4 && `, and ${untouched[message.id].length - 4} more`}
                      </div>
                      <button
                        onClick={() => hideUntouched(message.id)}
                        className="mt-1 underline hover:text-yellow-900"
                      >
                        {untouched[message.id].length === 1 ? 'Hide it' : 'Hide them'}
                      </button>
                    </div>
                  )}
                  <button
                    onClick={undoLast}
                    className="mt-1 text-[10px] text-gray-500 hover:text-gray-800 underline"
                  >
                    ↩ Undo last applied change
                  </button>
                </>
              )}

              {/* Legacy: Single action button (backward compatibility) */}
              {message.role === 'assistant' && message.action && !message.revampResponse && !message.operationsResponse && (
                <button
                  onClick={() => applyAction(message)}
                  className="mt-2 w-full bg-green-600 hover:bg-green-700 text-white text-xs font-medium py-1 px-3 rounded transition-colors"
                  title={
                    message.action.selector 
                      ? `Apply to: ${message.action.selector}` 
                      : selectedElement 
                        ? `Apply to selected element` 
                        : 'No target specified'
                  }
                >
                  ✓ Apply {message.action.selector ? '(Page-wide)' : message.action.scope === 'page' ? '(Page)' : '(Element)'}
                </button>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <div className="animate-spin h-3 w-3 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                <span className="text-gray-600">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3 bg-white">
        {attachments.chips.length > 0 && (
          <div className="mb-2 space-y-1">
            <AttachmentChips items={attachments.chips} onRemove={attachments.remove} />
            <p className="text-[10px] text-gray-500">Files are sent to {providerLabel(provider) || 'the selected AI provider'}.</p>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept={acceptedFileTypes(caps)}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length > 0) void attachments.addFiles(files);
          }}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            title="Attach files: images, PDF, video or documents"
            aria-label="Attach files"
            className="self-end rounded border border-gray-300 px-2 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            📎
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = pastedImageFiles(Array.from(e.clipboardData.files), e.clipboardData.getData('text/plain'));
              if (files.length > 0) {
                e.preventDefault();
                void attachments.addFiles(files);
              }
            }}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              selectedElement
                ? `Ask about ${selectedElement.tagName}...`
                : 'Ask about page styling, layout, or select an element...'
            }
            className="flex-1 text-sm border border-gray-300 rounded px-3 py-2 resize-none"
            rows={3}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || attachments.busy || (!input.trim() && attachments.ready.length === 0)}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed self-end"
          >
            Send
          </button>
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
};

export default AIChatBox;

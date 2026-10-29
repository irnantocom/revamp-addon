import React, { useState, useEffect, useRef } from 'react';
import { AIResponseParser } from '../../utils/ai-response-parser';
import { AIRevampResponse, AIChange } from '../../types/ai-response';
import { Operation, OperationsResponse } from '../../types/operations';
import { parseOperationsResponse } from '../../utils/operation-parser';
import { buildSystemPrompt, PageIndexData } from '../../utils/prompt-builder';
import { resolveAttachmentSources } from '../../utils/attachment-refs';
import { InspectedElement } from '../../types/inspector';
import ChangePreview, { ChangeItem, PreviewStatus } from './ChangePreview';
import AttachmentChips from './AttachmentChips';
import { pastedImageFiles, useAttachments } from '../use-attachments';
import { attachmentStore } from '../attachment-store-instance';
import { acceptedFileTypes, getCapabilities, providerLabel } from '../../ai/capabilities';
import { buildRequestMessages } from '../../utils/chat-content';
import { AttachmentMeta } from '../../types/attachments';

// Helper to ensure content script is ready
const ensureContentScript = async (tabId: number): Promise<boolean> => {
  const maxRetries = 10;
  const retryDelay = 200;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      console.log(`[AI Chat] Content script ready (attempt ${i + 1})`);
      return true;
    } catch (error) {
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  console.error('[AI Chat] Content script failed to load after retries');
  return false;
};

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
  selectedElement?: InspectedElement | null;
  onClear?: () => void;
  /** Text to put in the input box, e.g. coming from the Demo tab */
  initialPrompt?: string | null;
  onPromptConsumed?: () => void;
}

const AIChatBox: React.FC<Props> = ({ selectedElement, onClear, initialPrompt, onPromptConsumed }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [inspectorActive, setInspectorActive] = useState(false);
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
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const caps = getCapabilities(provider);
  const attachments = useAttachments(caps, attachmentStore);

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

  // Load chat history from storage on mount
  useEffect(() => {
    const loadChatHistory = async () => {
      try {
        const result = await chrome.storage.local.get(['chatHistory']);
        if (result.chatHistory && Array.isArray(result.chatHistory)) {
          console.log('[AI Chat] Loaded chat history:', result.chatHistory.length, 'messages');
          setMessages(result.chatHistory);
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
  }, []);

  // Save chat history to storage whenever messages change (with debounce)
  useEffect(() => {
    // Don't save until messages are loaded to avoid overwriting with empty array
    if (!messagesLoaded) return;

    // Debounce save to avoid too many writes
    const timeoutId = setTimeout(async () => {
      try {
        await chrome.storage.local.set({ chatHistory: messages });
        console.log('[AI Chat] Saved chat history:', messages.length, 'messages');
      } catch (error) {
        console.error('[AI Chat] Failed to save chat history:', error);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [messages, messagesLoaded]);

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

  // Listen for inspector state changes from content script
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'INSPECTOR_STATE_CHANGED') {
        setInspectorActive(message.isActive);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  // Listen for storage changes (sync across popup instances)
  useEffect(() => {
    const handleStorageChange = (changes: any, areaName: string) => {
      if (areaName === 'local' && changes.chatHistory) {
        console.log('[AI Chat] Storage changed externally, syncing...');
        const newValue = changes.chatHistory.newValue;
        if (newValue && Array.isArray(newValue)) {
          setMessages(newValue);
          console.log('[AI Chat] Synced', newValue.length, 'messages from storage');
        } else if (newValue === undefined || newValue === null) {
          // Storage was cleared
          setMessages([]);
          console.log('[AI Chat] Storage cleared, resetting messages');
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

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
      const built = await buildRequestMessages({
        systemPrompt: buildSystemPrompt(pageIndexData, { hasAttachments, images }),
        history: messages.map((m) => ({ role: m.role, text: m.content, attachments: m.attachments })),
        draft: { text, attachments: draftAttachments },
        load: (id) => attachmentStore.get(id),
        caps,
        providerLabel: providerLabel(provider),
      });
      requestNotes = built.notes;

      const response = await chrome.runtime.sendMessage({
        type: 'AI_REQUEST',
        payload: {
          provider,
          model,
          messages: built.messages,
          options: {
            // Translating or rewriting a whole page needs room: every changed text is returned in full
            maxTokens: provider === 'azure' || /2\.5|2\.0|gpt-4o|gpt-4\.1/.test(model) ? 8192 : 4096,
            temperature: 0.3,
          },
        },
      });

      if (response.success) {
        // Parse AI response for actionable changes
        const aiContent = response.data.content;
        
        console.log('[AI Chat] Received AI response, length:', aiContent.length);
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
        
        // Preferred: operations on indexed elements
        const operationsResponse = parseOperationsResponse(aiContent);

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
      } else {
        throw new Error(response.error || 'AI request failed');
      }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error}. Please check your API key in Settings.`,
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
      
      // Clear state first
      setMessages([]);
      attachments.clear();
      attachmentStore.clear().catch((error) => console.error('[AI Chat] Failed to clear attachments:', error));
      
      // Then clear from storage to ensure it's synced
      try {
        await chrome.storage.local.remove(['chatHistory']);
        console.log('[AI Chat] ✓ Chat history cleared from storage');
        
        // Verify deletion
        const verify = await chrome.storage.local.get(['chatHistory']);
        if (verify.chatHistory) {
          console.warn('[AI Chat] Storage still has data, trying again...');
          await chrome.storage.local.set({ chatHistory: [] });
        }
      } catch (error) {
        console.error('[AI Chat] Failed to clear chat history from storage:', error);
      }
    } else {
      console.log('[AI Chat] Clear cancelled by user');
    }
  };

  const toggleInspector = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      // Ensure content script is loaded
      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        alert('Failed to load inspector. Please refresh the page and try again.');
        return;
      }

      if (inspectorActive) {
        await chrome.tabs.sendMessage(tab.id, { type: 'STOP_INSPECTOR' });
        setInspectorActive(false);
      } else {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_INSPECTOR' });
        setInspectorActive(true);
      }
    } catch (error) {
      console.error('[AI Chat] Failed to toggle inspector:', error);
      alert('Failed to start inspector: ' + error);
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
          (id) => attachmentStore.get(id)
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
              onClick={toggleInspector}
              className={`text-xs px-3 py-1 rounded ${
                inspectorActive
                  ? 'bg-red-100 text-red-700 border border-red-300'
                  : 'bg-blue-100 text-blue-700 border border-blue-300'
              }`}
              title="Toggle Inspector"
            >
              {inspectorActive ? '⊗ Stop' : '⊕ Inspector'}
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

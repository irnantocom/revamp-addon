import React, { useState, useEffect, useRef } from 'react';
import { AIResponseParser } from '../../utils/ai-response-parser';
import { AIRevampResponse, AIChange } from '../../types/ai-response';
import { SubtreeSnapshot } from '../../types/dom-snapshot';
import ChangePreview from './ChangePreview';

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

/**
 * Build element context from subtree snapshot
 */
const buildElementContext = (snapshot: SubtreeSnapshot | null): string => {
  if (!snapshot) {
    return 'No element selected. Operating on entire page (body tag).';
  }

  const mode = snapshot.mode === 'element' ? 'ELEMENT-LEVEL' : 'PAGE-LEVEL';
  
  // Build children summary
  const childrenSummary = snapshot.children
    .filter(child => child.isVisible)
    .map(child => {
      const parts = [`  - <${child.tag}>`];
      if (child.id) parts.push(`id="${child.id}"`);
      if (child.classes.length > 0) parts.push(`class="${child.classes.slice(0, 3).join(' ')}"`);
      if (child.src) parts.push(`src="${child.src}"`);
      if (child.href) parts.push(`href="${child.href}"`);
      if (child.textContent && child.textContent.length > 0) {
        const preview = child.textContent.substring(0, 100);
        parts.push(`text="${preview}${child.textContent.length > 100 ? '...' : ''}"`);
      }
      parts.push(`→ selector: "${child.selector}"`);
      return parts.join(' ');
    })
    .join('\n');

  // Build ALL IMAGES summary (includes nested images)
  const imagesSummary = snapshot.allImages && snapshot.allImages.length > 0
    ? snapshot.allImages
        .filter(img => img.isVisible)
        .map((img, index) => {
          return `  [IMG-${index + 1}] src="${img.src}" → selector: "${img.selector}"`;
        })
        .join('\n')
    : '  (no images found)';

  return `MODE: ${mode}

ROOT ELEMENT:
- Tag: <${snapshot.rootTag}>
- Selector: "${snapshot.rootSelector}"
- Attributes: ${JSON.stringify(snapshot.attributes.slice(0, 5))}
- Text Content: "${snapshot.textContent.substring(0, 200)}${snapshot.textContent.length > 200 ? '...' : ''}"

CHILDREN (${snapshot.children.length} total, ${snapshot.children.filter(c => c.isVisible).length} visible):
${childrenSummary || '  (no visible children)'}

⚠️ ALL IMAGES IN THIS ELEMENT (${snapshot.allImages?.length || 0} total, IMPORTANT FOR IMAGE CHANGES):
${imagesSummary}

INNER HTML (first 1000 chars):
${snapshot.innerHTML.substring(0, 1000)}${snapshot.innerHTML.length > 1000 ? '\n...(truncated)' : ''}
`;
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  // Legacy single action format (backward compatibility)
  action?: {
    action: 'text' | 'css' | 'html' | 'attribute' | 'script';
    value: any;
    attribute?: string;
    selector?: string;
    scope?: 'element' | 'page';
  };
  // New structured format
  revampResponse?: AIRevampResponse;
}

interface Props {
  selectedElement?: {
    selector: { selector: string; type: string };
    tagName: string;
    textContent: string;
  } | null;
  onClear?: () => void;
}

const AIChatBox: React.FC<Props> = ({ selectedElement, onClear }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [inspectorActive, setInspectorActive] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [apiKeysLoaded, setApiKeysLoaded] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Provider labels for display
  const providerLabels: Record<string, string> = {
    openai: 'OpenAI',
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
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
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

      // Fetch subtree snapshot of selected element (or body if none selected)
      let snapshot: SubtreeSnapshot | null = null;
      try {
        const snapshotResponse = await chrome.tabs.sendMessage(tab.id, {
          type: 'GET_SUBTREE_SNAPSHOT',
          selector: selectedElement?.selector?.selector || undefined,
        });

        if (snapshotResponse.success) {
          snapshot = snapshotResponse.snapshot;
          console.log('[AI Chat] Subtree snapshot received:', {
            mode: snapshot?.mode,
            rootSelector: snapshot?.rootSelector,
            childrenCount: snapshot?.children.length
          });
        } else {
          console.warn('[AI Chat] Failed to get snapshot:', snapshotResponse.error);
        }
      } catch (snapshotError) {
        console.warn('[AI Chat] Could not get subtree snapshot:', snapshotError);
      }

      // Build adaptive context with subtree information
      const elementContext = buildElementContext(snapshot);

      const response = await chrome.runtime.sendMessage({
        type: 'AI_REQUEST',
        payload: {
          provider,
          model,
          messages: [
            {
              role: 'system',
              content: `You are an AI assistant specialized in live web page transformation and DOM manipulation inside a Chrome Extension.

You can operate in TWO MODES depending on the context:

────────────────────────────
MODE 1: ELEMENT-LEVEL EDITING
────────────────────────────
When a specific element is selected, focus on targeted changes within that element and its children.
Analyze the children structure carefully to identify what needs to be changed.

MODE 2: PAGE-LEVEL TRANSFORMATION
────────────────────────────
When no element is selected (body tag), analyze and transform the entire page structure.

────────────────────────────
CURRENT CONTEXT
────────────────────────────
${elementContext}

────────────────────────────
IMPORTANT INSTRUCTIONS
────────────────────────────
1. When user provides a link with content, analyze that content and map it to the CHILDREN and IMAGES
2. ALWAYS check the "ALL IMAGES IN THIS ELEMENT" section - these are the actual img tags to modify
3. For wrappers with text and images, create MULTIPLE targeted changes:
   - One change for each text element (action: "text")
   - One change for EACH image (action: "attribute" with attribute: "src")
4. Use the selectors from "ALL IMAGES" section for image changes - these are guaranteed to work
5. If user mentions content from a URL:
   - Extract/infer text content → map to text elements
   - Extract/infer image URLs → map to [IMG-1], [IMG-2], etc.
6. Each image must have its OWN change object - do NOT skip images
7. Look at both CHILDREN and ALL IMAGES sections to understand full structure
8. Example: If there are 4 images in ALL IMAGES section, create 4 separate attribute changes
9. **CRITICAL**: Keep ALL explanations SHORT (max 10 words) to prevent truncation
10. Focus on accuracy over verbose descriptions

────────────────────────────
OUTPUT FORMAT (STRICT JSON)
────────────────────────────

You MUST respond with this EXACT JSON structure wrapped in a code block:

\`\`\`json
{
  "success": true,
  "explanation": "Brief summary (max 1 sentence)",
  "changes": [
    {
      "id": "change-1",
      "action": "css|html|text|attribute|remove|insert",
      "selector": "CSS selector from CHILDREN list above",
      "value": "The new value to apply",
      "attribute": "attribute name (required for action: 'attribute')",
      "explanation": "Short reason (max 10 words)"
    }
  ],
  "warnings": ["Any potential issues (optional)"],
  "estimatedImpact": "low|medium|high"
}
\`\`\`

────────────────────────────
ACTION TYPES & EXAMPLES
────────────────────────────

### css - Modify styles
\`\`\`json
{
  "id": "change-1",
  "action": "css",
  "selector": "h1",
  "value": {
    "color": "#1a365d",
    "font-family": "'Inter', sans-serif"
  },
  "explanation": "Updating heading style"
}
\`\`\`

### text - Change text content
\`\`\`json
{
  "id": "change-2",
  "action": "text",
  "selector": "[data-id='abc123'] > p",
  "value": "Revolutionary AI platform for modern teams",
  "explanation": "Updating description text"
}
\`\`\`

### attribute - Modify element attributes
\`\`\`json
{
  "id": "change-3",
  "action": "attribute",
  "selector": "img.hero-image",
  "attribute": "src",
  "value": "https://example.com/new-hero.jpg",
  "explanation": "Replacing hero image"
}
\`\`\`

────────────────────────────
IMPORTANT RULES
────────────────────────────
1. ALWAYS output valid JSON inside \`\`\`json code block
2. ALWAYS include explanation for overall change and each individual change
3. Use specific selectors from the CHILDREN list provided above
4. For wrapper with multiple elements (text + image), create SEPARATE changes for each
5. Estimate impact: low (styling), medium (content), high (structure)
6. DO NOT combine multiple element changes into one change object

Use context7 for reasoning and best practices.`,
            },
            ...messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            {
              role: 'user',
              content: input,
            },
          ],
          options: {
            maxTokens: model.includes('2.5') || model.includes('2.0') ? 8192 : 4096,
            temperature: 0.7,
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
        
        // Try to parse structured response first (new format)
        const revampResponse = AIResponseParser.parse(aiContent);
        
        // Fallback: Try legacy single-action format
        let legacyAction;
        if (!revampResponse) {
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
          action: legacyAction,
          revampResponse: revampResponse || undefined,
        };
        
        if (revampResponse) {
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
      setMessages((prev) => [...prev, errorMessage]);
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

  // Apply single structured change
  const applyStructuredChange = async (_message: Message, change: AIChange) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        alert('Failed to apply changes. Please refresh the page.');
        return;
      }

      console.log('[AI Chat] Applying single change:', change);

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_AI_REVAMP',
        payload: {
          parsedResponse: {
            success: true,
            explanation: change.explanation,
            changes: [change],
            estimatedImpact: 'low'
          }
        }
      });

      if (response.success) {
        alert(`✓ Change applied successfully!\n${response.data.summary}`);
      } else {
        alert(`Failed to apply: ${response.error}`);
      }
    } catch (error) {
      console.error('[AI Chat] Error applying change:', error);
      alert(`Error: ${error}`);
    }
  };

  // Apply all changes from structured response
  const applyAllChanges = async (message: Message) => {
    if (!message.revampResponse) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        alert('Failed to apply changes. Please refresh the page.');
        return;
      }

      console.log('[AI Chat] Applying all changes:', message.revampResponse.changes.length);

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_AI_REVAMP',
        payload: {
          parsedResponse: message.revampResponse
        }
      });

      if (response.success) {
        const summary = response.data.summary;
        const failures = response.data.failures;
        let message = `✓ ${summary}`;
        
        if (failures && failures.length > 0) {
          message += `\n\n⚠️ ${failures.length} change(s) failed:`;
          failures.forEach((f: any) => {
            message += `\n- ${f.error}`;
          });
        }
        
        alert(message);
      } else {
        alert(`Failed to apply changes: ${response.error}`);
      }
    } catch (error) {
      console.error('[AI Chat] Error applying all changes:', error);
      alert(`Error: ${error}`);
    }
  };

  // Preview single change
  const previewChange = async (change: AIChange) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      await chrome.tabs.sendMessage(tab.id, {
        type: 'PREVIEW_CHANGES',
        payload: {
          parsedResponse: {
            success: true,
            explanation: change.explanation,
            changes: [change],
            estimatedImpact: 'low'
          }
        }
      });

      // Auto-clear preview after 3 seconds
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id!, { type: 'CLEAR_PREVIEW' });
        } catch (e) {
          // Ignore if tab closed
        }
      }, 3000);

    } catch (error) {
      console.error('[AI Chat] Error previewing change:', error);
    }
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
    <div className="flex flex-col h-full">
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
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
              
              {/* New: Structured revamp response with multiple changes */}
              {message.role === 'assistant' && message.revampResponse && message.revampResponse.changes.length > 0 && (
                <ChangePreview
                  changes={message.revampResponse.changes}
                  onApply={(change) => applyStructuredChange(message, change)}
                  onApplyAll={() => applyAllChanges(message)}
                  onPreview={(change) => previewChange(change)}
                />
              )}
              
              {/* Legacy: Single action button (backward compatibility) */}
              {message.role === 'assistant' && message.action && !message.revampResponse && (
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
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
            disabled={isLoading || !input.trim()}
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

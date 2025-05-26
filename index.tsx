/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { marked } from 'marked';
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';

// --- Environment Variable Configuration ---
const GEMINI_API_KEY = process.env.API_KEY;
const USER_SPECIFIED_MODEL = process.env.MODEL_NAME;
const ALLOWED_TEXT_MODEL = 'gemini-2.5-flash-preview-04-17';
let geminiModelName = ALLOWED_TEXT_MODEL;

if (USER_SPECIFIED_MODEL) {
  if (USER_SPECIFIED_MODEL === ALLOWED_TEXT_MODEL) {
    geminiModelName = USER_SPECIFIED_MODEL;
  } else {
    console.warn(`Specified MODEL_NAME "${USER_SPECIFIED_MODEL}" is not an allowed text model. Defaulting to "${ALLOWED_TEXT_MODEL}".`);
  }
}

// --- API Key Check ---
const errorDisplay = document.getElementById('errorDisplay') as HTMLDivElement;
const searchButtonElement = document.getElementById('searchButton') as HTMLButtonElement;
const searchInputElement = document.getElementById('searchInput') as HTMLInputElement;

if (!GEMINI_API_KEY) {
  console.error("API_KEY environment variable not set.");
  if (errorDisplay) {
    errorDisplay.textContent = 'Configuration error: API_KEY is missing. Please ensure it is set in your environment.';
    errorDisplay.style.display = 'block';
  }
  if (searchButtonElement) searchButtonElement.disabled = true;
  if (searchInputElement) searchInputElement.disabled = true;
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

// --- DOM Elements ---
const loadingIndicator = document.getElementById('loadingIndicator') as HTMLDivElement;
const resultsContainer = document.getElementById('resultsContainer') as HTMLDivElement;
const overviewContent = document.getElementById('overviewContent') as HTMLDivElement;
const referencesList = document.getElementById('referencesList') as HTMLUListElement;
const suggestionContainer = document.getElementById('suggestionContainer') as HTMLDivElement;
const suggestionContent = document.getElementById('suggestionContent') as HTMLDivElement;
const libraryContainer = document.getElementById('libraryContainer') as HTMLDivElement;
const libraryList = document.getElementById('libraryList') as HTMLUListElement;
const currentYearSpan = document.getElementById('currentYear') as HTMLSpanElement;

// Search Type Toggle Elements
const searchTypeToggle = document.getElementById('searchTypeToggle') as HTMLInputElement;
const semanticLabel = document.getElementById('semanticLabel') as HTMLSpanElement;
const keywordLabel = document.getElementById('keywordLabel') as HTMLSpanElement;
const searchTypeHelp = document.getElementById('searchTypeHelp') as HTMLParagraphElement;

// Action Buttons
const actionsContainer = document.getElementById('actionsContainer') as HTMLDivElement;
const copyButton = document.getElementById('copyButton') as HTMLButtonElement;
const downloadMdButton = document.getElementById('downloadMdButton') as HTMLButtonElement;
const downloadPdfButton = document.getElementById('downloadPdfButton') as HTMLButtonElement;

// --- State for Export ---
let currentQuery: string | null = null;
let currentOverviewHTML: string | null = null; // Store the HTML from marked for overview
let currentEnrichedReferences: EnrichedReference[] = [];
let currentSuggestionHTML: string | null = null; // Store the HTML from marked for suggestion
let currentLibraryItems: LibraryItem[] = [];


// --- Event Listeners ---
if (searchButtonElement) {
    searchButtonElement.addEventListener('click', handleSearch);
}
if (searchInputElement) {
    searchInputElement.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleSearch();
        }
    });
}

// Search Type Toggle Logic
if (searchTypeToggle && semanticLabel && keywordLabel && searchTypeHelp) {
    const updateSearchTypeDisplay = () => {
        const isKeyword = searchTypeToggle.checked;
        if (isKeyword) { // Keyword is active
            semanticLabel.classList.remove('active');
            semanticLabel.setAttribute('aria-pressed', 'false');
            keywordLabel.classList.add('active');
            keywordLabel.setAttribute('aria-pressed', 'true');
            searchTypeHelp.textContent = "Toggle to switch between semantic search (focus on meaning and context) and keyword search (focus on exact terms). Current mode is Keyword.";
        } else { // Semantic is active
            semanticLabel.classList.add('active');
            semanticLabel.setAttribute('aria-pressed', 'true');
            keywordLabel.classList.remove('active');
            keywordLabel.setAttribute('aria-pressed', 'false');
            searchTypeHelp.textContent = "Toggle to switch between semantic search (focus on meaning and context) and keyword search (focus on exact terms). Current mode is Semantic.";
        }
    };

    searchTypeToggle.addEventListener('change', updateSearchTypeDisplay);

    const toggleSearchType = (targetType: 'semantic' | 'keyword') => {
        const isKeyword = targetType === 'keyword';
        if (searchTypeToggle.checked !== isKeyword) {
            searchTypeToggle.checked = isKeyword;
            updateSearchTypeDisplay();
        }
    };

    semanticLabel.addEventListener('click', () => toggleSearchType('semantic'));
    semanticLabel.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            toggleSearchType('semantic');
            event.preventDefault();
        }
    });

    keywordLabel.addEventListener('click', () => toggleSearchType('keyword'));
    keywordLabel.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            toggleSearchType('keyword');
            event.preventDefault();
        }
    });
    updateSearchTypeDisplay(); // Set initial state
}

// Action Button Listeners
if (copyButton) copyButton.addEventListener('click', handleCopyResults);
if (downloadMdButton) downloadMdButton.addEventListener('click', handleDownloadMarkdown);
if (downloadPdfButton) downloadPdfButton.addEventListener('click', handleDownloadPdf);


// --- Footer Year ---
if (currentYearSpan) {
    currentYearSpan.textContent = new Date().getFullYear().toString();
}

// --- Interfaces ---
interface RawReference {
  uri: string;
  title?: string;
}

interface EnrichedReference {
  original_url: string;
  original_title: string;
  description: string;
  is_paper: boolean;
}

type LibraryItemType = 'Paper' | 'News' | 'Blog' | 'Other';

interface LibraryItem {
  original_url: string;
  original_title: string;
  description: string;
  type: LibraryItemType;
}

interface EnrichmentData {
  enriched_references: EnrichedReference[];
  suggestion: string;
  library_items?: LibraryItem[];
}

// --- Main Search Handler ---
async function handleSearch() {
  const query = searchInputElement.value.trim();
  if (!query) {
    displayError('Please enter a search query.');
    hideResults();
    return;
  }
  currentQuery = query; // Store query

  if (!GEMINI_API_KEY) {
    displayError('API Key is not configured. Cannot perform search.');
    hideResults();
    return;
  }

  let rawReferences: RawReference[] = [];

  showLoading();
  clearPreviousResults(); // Clears data and disables action buttons

  try {
    const initialResponse: GenerateContentResponse = await ai.models.generateContent({
      model: geminiModelName,
      contents: query,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const overviewText = initialResponse.text;
    currentOverviewHTML = overviewText ? await marked.parse(overviewText) : '<p>No overview available.</p>';
    overviewContent.innerHTML = currentOverviewHTML;


    const groundingMetadata = initialResponse.candidates?.[0]?.groundingMetadata;
    if (groundingMetadata?.groundingChunks && groundingMetadata.groundingChunks.length > 0) {
      rawReferences = groundingMetadata.groundingChunks
        .filter(chunk => chunk.web && chunk.web.uri)
        .map(chunk => ({ uri: chunk.web.uri!, title: chunk.web.title || chunk.web.uri! }));
    }

    if (rawReferences.length > 0) {
      const currentSearchType = searchTypeToggle?.checked ? 'keyword' : 'semantic';
      let searchStrategyInstruction = "";

      if (currentSearchType === 'keyword') {
        searchStrategyInstruction = `When processing these results, adopt a **Keyword Search Strategy**:
- For 'enriched_references' descriptions: Focus on how directly the content matches the keywords in "${query}". The description should highlight these keyword connections.
- For 'library_items' selection and description: Prioritize items that explicitly contain the keywords from "${query}". Descriptions should emphasize these literal keyword occurrences. Choose items that are direct hits for the keywords.
- For 'suggestion': Suggest a follow-up question or topic that explores specific keyword variations or related exact terms.`;
      } else { // semantic (default)
        searchStrategyInstruction = `When processing these results, adopt a **Semantic Search Strategy**:
- For 'enriched_references' descriptions: Focus on the conceptual relevance of the content to the query "${query}". The description should explain its relevance even if keywords aren't exact matches.
- For 'library_items' selection and description: Prioritize items based on their thematic and conceptual alignment with "${query}". Descriptions should highlight this broader relevance.
- For 'suggestion': Suggest a follow-up question or topic that explores related concepts or deeper aspects of "${query}".`;
      }

      const enrichmentPrompt = `
Given the user query "${query}" and the following search results:
${JSON.stringify(rawReferences.map(r => ({ title: r.title, url: r.uri })))}.

**Adopt the following search strategy for your analysis and response:**
${searchStrategyInstruction}

Your response MUST be a single, valid JSON object with NO extra characters, comments, or markdown. The JSON object must strictly follow this structure:
{
  "enriched_references": [
    { "original_url": "URL_STRING", "original_title": "TITLE_STRING", "description": "CONCISE_ONE_SENTENCE_DESCRIPTION (reflecting the chosen search strategy)", "is_paper": BOOLEAN }
  ],
  "suggestion": "ONE_RELEVANT_SUGGESTION_STRING_FOR_A_FOLLOW_UP_TOPIC_OR_QUESTION (reflecting the chosen search strategy)",
  "library_items": [
    { "original_url": "URL_STRING", "original_title": "TITLE_STRING", "description": "CONCISE_ONE_SENTENCE_DESCRIPTION_OF_THE_CONTENT (reflecting the chosen search strategy)", "type": "Paper" | "News" | "Blog" | "Other" }
  ]
}

Detailed instructions for each field, adhering to the chosen search strategy:
- "enriched_references": Provide 'description' and 'is_paper' flag for each. The description should be concise and reflect the applied search strategy (Keyword or Semantic).
- "suggestion": Provide one relevant suggestion for a follow-up, guided by the search strategy.
- "library_items": Analyze the search results based on the specified search strategy. Identify up to 5-7 items. For each, provide original URL, title, a concise one-sentence description reflecting the strategy, and its 'type' ('Paper', 'News', 'Blog', or 'Other'). If a result doesn't fit under the current strategy, omit it. If none fit, provide an empty array for "library_items".

Ensure all string values within the JSON are properly escaped. Output only the JSON object.`;


      const enrichmentResponse: GenerateContentResponse = await ai.models.generateContent({
        model: geminiModelName,
        contents: enrichmentPrompt,
        config: {
          responseMimeType: "application/json",
        }
      });

      let jsonStr = enrichmentResponse.text.trim();
      const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
      const match = jsonStr.match(fenceRegex);
      if (match && match[2]) {
        jsonStr = match[2].trim();
      }

      try {
        const enrichmentData = JSON.parse(jsonStr) as EnrichmentData;
        currentEnrichedReferences = enrichmentData.enriched_references || [];
        currentSuggestionHTML = enrichmentData.suggestion ? await marked.parse(enrichmentData.suggestion) : null;
        currentLibraryItems = enrichmentData.library_items || [];

        renderEnrichedReferences(currentEnrichedReferences);
        renderSuggestion(currentSuggestionHTML);
        renderLibraryItems(currentLibraryItems);
      } catch (e) {
        console.error("Failed to parse JSON from enrichment response:", e, "\nRaw response text:", jsonStr);
        displayError((errorDisplay.textContent ? errorDisplay.textContent + ' ' : '') + 'Could not process additional details. Displaying basic references.');
        renderRawReferences(rawReferences); // Fallback
        currentEnrichedReferences = rawReferences.map(r => ({ original_url: r.uri, original_title: r.title || r.uri, description: 'N/A', is_paper: false })); // Basic fallback for export
      }
    } else {
      renderRawReferences([]); // Handles "No references found"
    }

    showResultsContainers();
    if (actionsContainer) actionsContainer.style.display = 'flex'; // Show actions
    enableActionButtons(true);


  } catch (error) {
    console.error('Error during API interaction:', error);
    let errorMessage = 'Failed to fetch or process data. Please try again.';
    if (error instanceof Error) {
        errorMessage += ` Details: ${error.message}`;
    }
    displayError(errorMessage);
    if (overviewContent.innerHTML && rawReferences.length > 0 && referencesList.children.length === 0) {
        renderRawReferences(rawReferences);
        showResultsContainers(false);
    }
    currentQuery = null; // Reset query on error
  } finally {
    hideLoading();
  }
}

// --- Rendering Functions ---
function renderRawReferences(references: RawReference[]) {
    referencesList.innerHTML = '';
    if (references.length > 0) {
        references.forEach(ref => {
            const listItem = document.createElement('li');
            const link = document.createElement('a');
            link.href = ref.uri;
            link.textContent = ref.title || ref.uri;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            listItem.appendChild(link);
            referencesList.appendChild(listItem);
        });
    } else {
        const listItem = document.createElement('li');
        listItem.textContent = 'No references found for this query.';
        referencesList.appendChild(listItem);
    }
}

function renderEnrichedReferences(enrichedRefs: EnrichedReference[]) {
    referencesList.innerHTML = '';
    if (enrichedRefs.length > 0) {
        enrichedRefs.forEach(ref => {
            const listItem = document.createElement('li');
            const link = document.createElement('a');
            link.href = ref.original_url;
            link.textContent = ref.original_title || ref.original_url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            listItem.appendChild(link);

            if (ref.is_paper) {
                const paperTag = document.createElement('span');
                paperTag.className = 'tag paper-tag';
                paperTag.textContent = ' [Paper]';
                listItem.appendChild(paperTag);
            }

            if (ref.description) {
                const descriptionPara = document.createElement('p');
                descriptionPara.className = 'reference-description';
                descriptionPara.textContent = ref.description;
                listItem.appendChild(descriptionPara);
            }
            referencesList.appendChild(listItem);
        });
    } else {
        const listItem = document.createElement('li');
        listItem.textContent = 'No detailed references available for this query.';
        referencesList.appendChild(listItem);
    }
}

async function renderSuggestion(suggestionHTML: string | null) {
    if (suggestionHTML && suggestionHTML.trim() !== "") {
        suggestionContent.innerHTML = suggestionHTML;
        suggestionContainer.style.display = 'block';
    } else {
        suggestionContainer.style.display = 'none';
    }
}

function renderLibraryItems(libraryItems: LibraryItem[]) {
    libraryList.innerHTML = '';
    if (libraryItems.length > 0) {
        libraryItems.forEach(item => {
            const listItem = document.createElement('li');
            const link = document.createElement('a');
            link.href = item.original_url;
            link.textContent = item.original_title || item.original_url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            listItem.appendChild(link);

            const typeTag = document.createElement('span');
            typeTag.className = `tag library-item-type ${item.type.toLowerCase()}-tag`;
            typeTag.textContent = ` [${item.type}]`;
            listItem.appendChild(typeTag);

            if (item.description) {
                const descriptionPara = document.createElement('p');
                descriptionPara.className = 'reference-description';
                descriptionPara.textContent = item.description;
                listItem.appendChild(descriptionPara);
            }
            libraryList.appendChild(listItem);
        });
        libraryContainer.style.display = 'block';
    } else {
        libraryContainer.style.display = 'none';
    }
}

// --- UI Helper Functions ---
function showLoading() {
    if (loadingIndicator) loadingIndicator.style.display = 'block';
    if (errorDisplay) errorDisplay.style.display = 'none';
    hideResults();
}

function hideLoading() {
    if (loadingIndicator) loadingIndicator.style.display = 'none';
}

function displayError(message: string) {
    if (errorDisplay) {
        errorDisplay.textContent = message;
        errorDisplay.style.display = 'block';
    }
    enableActionButtons(false); // Disable on error
    if (actionsContainer) actionsContainer.style.display = 'none';
}

function clearPreviousResults() {
    overviewContent.innerHTML = '';
    referencesList.innerHTML = '';
    suggestionContent.innerHTML = '';
    libraryList.innerHTML = '';
    suggestionContainer.style.display = 'none';
    libraryContainer.style.display = 'none';
    if (actionsContainer) actionsContainer.style.display = 'none';

    currentQuery = null;
    currentOverviewHTML = null;
    currentEnrichedReferences = [];
    currentSuggestionHTML = null;
    currentLibraryItems = [];
    enableActionButtons(false);
}

function hideResults() {
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (suggestionContainer) suggestionContainer.style.display = 'none';
    if (libraryContainer) libraryContainer.style.display = 'none';
    if (actionsContainer) actionsContainer.style.display = 'none';
    enableActionButtons(false);
}

function showResultsContainers(showAll = true) {
    if (resultsContainer) resultsContainer.style.display = 'block';
    if (actionsContainer) actionsContainer.style.display = 'flex';
    enableActionButtons(true);
    // Visibility of suggestion & library is controlled by their respective render functions
    if (!showAll) {
      if (suggestionContainer) suggestionContainer.style.display = 'none';
      if (libraryContainer) libraryContainer.style.display = 'none';
    }
}

function enableActionButtons(enable: boolean) {
    if (copyButton) copyButton.disabled = !enable;
    if (downloadMdButton) downloadMdButton.disabled = !enable;
    if (downloadPdfButton) downloadPdfButton.disabled = !enable;
}

// --- Export Functions ---
function getPlainTextContent(): string {
    let content = `Search Query: ${currentQuery || 'N/A'}\n\n`;

    if (currentOverviewHTML) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = currentOverviewHTML;
        content += "## Overview\n";
        content += tempDiv.textContent || tempDiv.innerText || "";
        content += "\n\n";
    }

    if (currentEnrichedReferences.length > 0) {
        content += "## References\n";
        currentEnrichedReferences.forEach(ref => {
            content += `- ${ref.original_title || 'N/A'} (${ref.original_url})\n`;
            if (ref.description) content += `  ${ref.description}\n`;
            if (ref.is_paper) content += `  [Paper]\n`;
        });
        content += "\n";
    }

    if (currentSuggestionHTML) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = currentSuggestionHTML;
        content += "## Suggestion\n";
        content += tempDiv.textContent || tempDiv.innerText || "";
        content += "\n\n";
    }

    if (currentLibraryItems.length > 0) {
        content += "## Library Items\n";
        currentLibraryItems.forEach(item => {
            content += `- [${item.type}] ${item.original_title || 'N/A'} (${item.original_url})\n`;
            if (item.description) content += `  ${item.description}\n`;
        });
        content += "\n";
    }
    return content.trim();
}

async function handleCopyResults() {
    if (!copyButton || copyButton.disabled) return;
    const textToCopy = getPlainTextContent();
    if (!textToCopy) {
        displayError("No content available to copy.");
        return;
    }

    try {
        await navigator.clipboard.writeText(textToCopy);
        const originalText = copyButton.textContent;
        copyButton.textContent = 'Copied!';
        setTimeout(() => {
            copyButton.textContent = originalText;
        }, 2000);
    } catch (err) {
        console.error('Failed to copy results: ', err);
        displayError('Failed to copy results. Your browser might not support this feature or permissions are denied.');
    }
}

// Helper to convert HTML to Markdown (very basic, primarily for overview/suggestion if they were complex)
// For now, assuming 'marked' output is what we want for MD.
function htmlToMarkdown(html: string): string {
    // This is a placeholder. True HTML-to-Markdown can be complex.
    // For 'marked' output, it's already Markdown-like.
    // If we needed to reverse complex HTML, a library like Turndown would be better.
    // For now, we assume currentOverviewHTML and currentSuggestionHTML are simple enough
    // or we can directly use the text version from Gemini if available.
    // Let's re-parse with marked to be sure for a "clean" markdown structure if needed,
    // but for now, we'll use the raw HTML from marked and rely on its structure.
    // For this app, the overview/suggestion are generated as markdown by Gemini and rendered via marked.
    // So, currentOverviewHTML and currentSuggestionHTML are already HTML generated *from* markdown.
    // To get back to markdown, we'd ideally use the original markdown string.
    // Let's assume overviewText and suggestion.text from API response are the raw markdown.
    // We need to store those if we want pure original markdown.
    // For now, we will construct from the HTML using a temporary element.
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return tempDiv.innerText || tempDiv.textContent || ''; // Basic text extraction
}


function getMarkdownContent(): string {
    let mdContent = `# Search Results for: ${currentQuery || 'N/A'}\n\n`;

    if (currentOverviewHTML) {
        // Since currentOverviewHTML is generated by marked, it's HTML.
        // For MD, we would ideally use the original markdown text from the API.
        // For simplicity, let's just add a header and the HTML (browsers/editors might render it)
        // or try a very basic text extraction. A proper HTML-to-MD is out of scope here.
        // Let's try to get the text content, which is often good enough.
        const tempDivOverview = document.createElement('div');
        tempDivOverview.innerHTML = currentOverviewHTML;
        mdContent += `## Overview\n\n${tempDivOverview.textContent || ''}\n\n`;
    }

    if (currentEnrichedReferences.length > 0) {
        mdContent += "## References\n\n";
        currentEnrichedReferences.forEach(ref => {
            mdContent += `*   **[${ref.original_title || 'Untitled'}](${ref.original_url})**\n`;
            if (ref.description) mdContent += `    *${ref.description.replace(/\n/g, '\n    ')}*\n`;
            if (ref.is_paper) mdContent += `    *Type: Paper*\n`;
        });
        mdContent += "\n";
    }

    if (currentSuggestionHTML) {
        const tempDivSuggestion = document.createElement('div');
        tempDivSuggestion.innerHTML = currentSuggestionHTML;
        mdContent += `## Suggestion\n\n${tempDivSuggestion.textContent || ''}\n\n`;
    }

    if (currentLibraryItems.length > 0) {
        mdContent += "## Library Items\n\n";
        currentLibraryItems.forEach(item => {
            mdContent += `*   **[${item.type}] [${item.original_title || 'Untitled'}](${item.original_url})**\n`;
            if (item.description) mdContent += `    *${item.description.replace(/\n/g, '\n    ')}*\n`;
        });
        mdContent += "\n";
    }
    return mdContent;
}

function handleDownloadMarkdown() {
    if (!downloadMdButton || downloadMdButton.disabled) return;
    const markdown = getMarkdownContent();
    if (!markdown) {
        displayError("No content available to download.");
        return;
    }

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `search_results_${(currentQuery || 'export').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleDownloadPdf() {
    if (!downloadPdfButton || downloadPdfButton.disabled) return;
    // Print functionality will use @media print CSS for formatting.
    // The user will then choose "Save as PDF" in their browser's print dialog.
    window.print();
}

// Initial setup
enableActionButtons(false);
if (actionsContainer) actionsContainer.style.display = 'none';

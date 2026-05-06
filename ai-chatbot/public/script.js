const inputField = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const messagesContainer = document.getElementById('messages');
const MAX_INTERACTIONS = 5;
let conversationHistory = [];

const fileInput = document.getElementById("file-input");

// Read the query string from the current page URL so we can extract values like participantID and systemID
const params = new URLSearchParams(window.location.search);

// Retrieve participantID and system ID from localStorage
const participantID = params.get('participantID') || localStorage.getItem('participantID');
const systemID = params.get('systemID');

// Mark the body so CSS can hide enhanced-only features for baseline participants.
const isBaseline = parseInt(systemID) === 1;
if (isBaseline && document.body) {
    document.body.classList.add('baseline');
}

// ---- Workflow progress gating ----
// Each step must be completed before the next can be entered. Progress is
// stored in localStorage keyed to the participant ID so survives reloads.
const progressKey = `flow-progress-${participantID}`;

function getProgress() {
    try { return JSON.parse(localStorage.getItem(progressKey)) || {}; }
    catch (e) { return {}; }
}

function markStepDone(step) {
    const p = getProgress();
    p[step] = true;
    localStorage.setItem(progressKey, JSON.stringify(p));
}

function requirePrevStep(prevStep, prevStepLabel) {
    const p = getProgress();
    if (!p[prevStep]) {
        alert(`Please complete step "${prevStepLabel}" before moving on.`);
        return false;
    }
    return true;
}

// Prototype button and Task button
const prototypeBtn = document.getElementById('prototype-btn');
if (prototypeBtn) {
    prototypeBtn.addEventListener('click', () => {
        if (!requirePrevStep('step2', 'Read the task')) return;
        markStepDone('step3');
        window.location.href = `/chat.html?participantID=${participantID}&systemID=${systemID}`;
    });
}

const taskBtn = document.getElementById('task-btn');
if (taskBtn) {
    taskBtn.addEventListener('click', () => {
        if (!requirePrevStep('step1', 'Complete the demographics & pre-task questionnaire')) return;
        // step2 is only marked done after the participant clicks Continue on
        // the task page itself, so back-arrowing out of /task.html does not
        // count as completing the task.
        window.location.href = `/task.html?participantID=${participantID}&systemID=${systemID}`;
    });
}

// Alert and prompt if no participantID
if (!participantID) {
  alert('Please enter a participant ID.');
  // Redirect to login if no participantID is set
  window.location.href = '/';
}

async function sendMessage(inputElement) {
    const trimmedInput = inputElement.value.trim();
    if (trimmedInput === "") {
        alert("Please enter a message");
        return;
    }

    // Add user message to UI
    appendUserMessage(trimmedInput);
    inputElement.value = '';

    // Add to conversation history
    conversationHistory.push({ role: 'user', content: trimmedInput });

    // Get recent history (last N messages, where N = MAX_INTERACTIONS * 2 for user+bot pairs)
    const recentHistory = conversationHistory.slice(-MAX_INTERACTIONS * 2);

    // Get retrieval method
    const retrievalMethod = retrievalDropdown ? retrievalDropdown.value : 'semantic';

    try {
        const payload = {
            participantID: participantID,
            input: trimmedInput,
            history: recentHistory,
            systemID: parseInt(systemID) || 1,
            retrievalMethod: retrievalMethod
        };

        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            appendBotMessage(data.botResponse, data.confidenceMetrics, data.retrievedDocuments, data.hasDocuments);

            // Add bot response to conversation history
            conversationHistory.push({ role: 'assistant', content: data.botResponse });

        } catch (error) {
            console.error('Error sending message:', error);
            appendBotMessage('Error: Failed to get response from bot', null, null);
        }
    }

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

function appendUserMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'msg msg-user';
    bubble.textContent = text;
    messagesContainer.appendChild(bubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

let botMessageCounter = 0;

function splitTradeoffs(text) {
    const match = text.match(/\n*TRADE-OFFS:\s*\n([\s\S]+)$/i);
    if (!match) return { mainText: text, tradeoffs: null };
    const mainText = text.slice(0, match.index).trim();
    const bullets = match[1]
        .split('\n')
        .map(line => line.replace(/^\s*[-*•]\s*/, '').trim())
        .filter(line => line.length > 0);
    return { mainText, tradeoffs: bullets };
}

function appendBotMessage(text, confidenceMetrics, retrievedDocuments, hasDocuments) {
    const bubbleId = `bot-msg-${++botMessageCounter}`;
    const bubble = document.createElement('div');
    bubble.className = 'msg msg-bot';
    bubble.id = bubbleId;

    const { mainText, tradeoffs } = splitTradeoffs(text);

    if (!isBaseline) {
        bubble.draggable = true;
        bubble.addEventListener('dragstart', (e) => {
            const dragText = tradeoffs && tradeoffs.length > 0
                ? mainText + '\n\nTrade-offs:\n' + tradeoffs.map(t => '- ' + t).join('\n')
                : mainText;
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('application/x-bot-message', dragText);
            e.dataTransfer.setData('text/plain', dragText);
        });
    }

    const body = document.createElement('div');
    body.className = 'msg-text';
    body.innerHTML = renderTextWithCitationChips(mainText, bubbleId, (retrievedDocuments || []).length);
    bubble.appendChild(body);

    if (tradeoffs && tradeoffs.length > 0) {
        const block = document.createElement('div');
        block.className = 'tradeoffs-block';
        const heading = document.createElement('div');
        heading.className = 'tradeoffs-heading';
        heading.textContent = 'Trade-offs';
        block.appendChild(heading);
        const ul = document.createElement('ul');
        tradeoffs.forEach(t => {
            const li = document.createElement('li');
            li.innerHTML = renderTextWithCitationChips(t, bubbleId, (retrievedDocuments || []).length);
            ul.appendChild(li);
        });
        block.appendChild(ul);
        bubble.appendChild(block);
    }

    const meta = document.createElement('div');
    meta.className = 'msg-meta';

    const showChip = confidenceMetrics && (
        hasDocuments === true ||
        (retrievedDocuments && retrievedDocuments.length > 0)
    );
    if (showChip) {
        const pct = confidenceMetrics.overallConfidence * 100;
        const chip = document.createElement('span');
        chip.className = 'confidence-chip ' + confidenceLevel(pct);
        chip.textContent = `${pct.toFixed(0)}% confidence · ${confidenceMetrics.retrievalMethod}`;
        meta.appendChild(chip);
    }

    if (retrievedDocuments && retrievedDocuments.length > 0) {
        const details = document.createElement('details');
        details.className = 'sources';
        details.id = `${bubbleId}-sources`;
        const summary = document.createElement('summary');
        summary.textContent = `View ${retrievedDocuments.length} source${retrievedDocuments.length === 1 ? '' : 's'}`;
        details.appendChild(summary);

        const list = document.createElement('ol');
        retrievedDocuments.forEach((doc, i) => {
            const score = (doc.relevanceScore ?? doc.score ?? 0);
            const preview = doc.chunkText.length > 240 ? doc.chunkText.substring(0, 240) + '…' : doc.chunkText;
            const li = document.createElement('li');
            li.id = `${bubbleId}-src-${i + 1}`;
            li.innerHTML = `<span class="src-doc">${escapeHtml(doc.documentName)}</span>
                            <span class="src-score">${(score * 100).toFixed(1)}% match</span>
                            <p class="src-preview">${escapeHtml(preview)}</p>`;
            list.appendChild(li);
        });
        details.appendChild(list);
        meta.appendChild(details);
    }

    if (meta.childNodes.length > 0) {
        bubble.appendChild(meta);
    }

    messagesContainer.appendChild(bubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

let quillEditor = null;

function setupScratchpadEditor() {
    if (isBaseline) return;
    const container = document.getElementById('scratchpad-editor');
    if (!container || typeof Quill === 'undefined') return;

    const storageKey = `scratchpad-quill-${participantID}`;

    quillEditor = new Quill('#scratchpad-editor', {
        theme: 'snow',
        placeholder: 'Type notes, or drag a bot reply in...',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline'],
                [{ list: 'ordered' }, { list: 'bullet' }],
                [{ header: [1, 2, false] }]
            ]
        }
    });

    const saved = localStorage.getItem(storageKey);
    if (saved) {
        try {
            quillEditor.setContents(JSON.parse(saved));
        } catch (err) {
            console.warn('Could not restore scratchpad contents:', err);
        }
    }

    quillEditor.on('text-change', () => {
        localStorage.setItem(storageKey, JSON.stringify(quillEditor.getContents()));
    });

    const editorRoot = quillEditor.root;

    editorRoot.addEventListener('dragover', (e) => {
        const types = Array.from(e.dataTransfer.types || []);
        if (!types.includes('application/x-bot-message')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        editorRoot.classList.add('drag-over');
    }, true);

    editorRoot.addEventListener('dragleave', (e) => {
        if (e.target === editorRoot) {
            editorRoot.classList.remove('drag-over');
        }
    }, true);

    editorRoot.addEventListener('drop', (e) => {
        const types = Array.from(e.dataTransfer.types || []);
        if (!types.includes('application/x-bot-message')) return;
        e.preventDefault();
        e.stopPropagation();
        editorRoot.classList.remove('drag-over');
        const text = e.dataTransfer.getData('application/x-bot-message');
        if (!text) return;
        const length = quillEditor.getLength();
        quillEditor.insertText(length - 1, '\n' + text + '\n', { italic: true });
    }, true);
}

function renderTextWithCitationChips(text, bubbleId, sourceCount) {
    const escaped = escapeHtml(text);
    if (isBaseline) {
        return escaped;
    }
    return escaped.replace(/\[Source\s+(\d+)\]/gi, (match, n) => {
        const idx = parseInt(n, 10);
        if (idx < 1 || idx > sourceCount) {
            return `<span class="cite-chip cite-chip-missing" title="Source ${idx} not in retrieved evidence">[${idx}]</span>`;
        }
        return `<a href="#${bubbleId}-src-${idx}" class="cite-chip" data-bubble="${bubbleId}" data-src="${idx}">[${idx}]</a>`;
    });
}

document.addEventListener('click', (e) => {
    const chip = e.target.closest('.cite-chip[data-bubble]');
    if (!chip) return;
    e.preventDefault();
    const bubbleId = chip.getAttribute('data-bubble');
    const srcIdx = chip.getAttribute('data-src');
    logEvent('click', `Citation Chip [${srcIdx}]`);
    const details = document.getElementById(`${bubbleId}-sources`);
    const li = document.getElementById(`${bubbleId}-src-${srcIdx}`);
    if (details && !details.open) details.open = true;
    if (li) {
        li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        li.classList.add('src-flash');
        setTimeout(() => li.classList.remove('src-flash'), 1500);
    }
});

function confidenceLevel(pct) {
    if (pct >= 60) return 'conf-high';
    if (pct >= 30) return 'conf-mid';
    return 'conf-low';
}

// Function to fetch and load existing conversation history
async function loadConversationHistory() {
    const response = await fetch('/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send participantID to the server and maximum conversation exchanges
        body: JSON.stringify({ participantID, limit: MAX_INTERACTIONS })
    });
    const data = await response.json();

    if (data.interactions && data.interactions.length > 0) {
        data.interactions.forEach(interaction => {
            appendUserMessage(interaction.userInput);
            appendBotMessage(
                interaction.botResponse,
                interaction.confidenceMetrics,
                interaction.retrievedDocuments
            );

            // Add to conversation history
            conversationHistory.push({ role: 'user', content: interaction.userInput });
            conversationHistory.push({ role: 'assistant', content: interaction.botResponse });
        });
    }
}

function setupScratchpadToggle() {
    if (isBaseline) return;
    const scratchpad = document.getElementById('scratchpad');
    const toggle = document.getElementById('scratchpad-toggle');
    if (!scratchpad || !toggle) return;

    const collapseKey = `scratchpad-collapsed-${participantID}`;
    const wasCollapsed = localStorage.getItem(collapseKey) === '1';
    if (wasCollapsed) {
        scratchpad.classList.add('collapsed');
        toggle.textContent = '+';
        toggle.title = 'Expand';
    }

    toggle.addEventListener('click', () => {
        const nowCollapsed = scratchpad.classList.toggle('collapsed');
        toggle.textContent = nowCollapsed ? '+' : '−';
        toggle.title = nowCollapsed ? 'Expand' : 'Collapse';
        localStorage.setItem(collapseKey, nowCollapsed ? '1' : '0');
        logEvent('click', nowCollapsed ? 'Scratchpad Collapse' : 'Scratchpad Expand');
    });
}

// Load history and scratchpad when chat loads
window.onload = () => {
    loadConversationHistory();
    setupScratchpadEditor();
    setupScratchpadToggle();
};

const sendButton = document.getElementById("send-btn");
if (sendButton) {
    sendButton.addEventListener("click", (event) => {
        event.preventDefault();
        logEvent( 'click', 'Send Button');
        sendMessage(inputField);
    });
}

const inputElement = document.getElementById("user-input");
if (inputElement) {
    inputElement.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            sendMessage(inputElement);
        }
    });
}

const retrievalDropdown = document.querySelector("#retrieval-method select");

// Prevent form submit from reloading the page
const chatForm = document.querySelector('#chat-container form');
if (chatForm) {
    chatForm.addEventListener('submit', (event) => {
        event.preventDefault();
    });
}


if (retrievalDropdown) {
    retrievalDropdown.addEventListener("change", () => {
        console.log("Selected retrieval method: ", retrievalDropdown.value);
    });
}

// Log hover and focus events on the input field
const userInput = document.getElementById('user-input');
if (userInput) {
    userInput.addEventListener('mouseover', () => {
        logEvent('hover', 'User Input');
    });

    userInput.addEventListener('focus', () => {
        logEvent('focus', 'User Input');
    });
}

// Function to log events to the server
function logEvent(type, element) {
    fetch('/log-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantID: participantID, eventType: type, elementName: element, timestamp: new Date() })
    }).catch(error => {
        console.error('Error logging event:', error);
    });
}

const uploadBtn = document.getElementById("upload-btn");
if (uploadBtn) {
    uploadBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    logEvent('click', 'Upload Button');

    const fileInput = document.getElementById("file-input");
    const file = fileInput.files[0];

    if (!file) {
        alert("Choose a file first.");
        return;
    }
    console.log("Selected file: ", file.name);
  
    const formData = new FormData();
    formData.append("document", file);
    formData.append("participantID", participantID);

    const response = await fetch("/upload-document", {
        method: "POST",
        body: formData
    });
  
    const data = await response.json();
    console.log(data);
    
    await loadDocuments();
    });
}

async function loadDocuments() {
    const documentsList = document.getElementById('documents-list');
    const placeholder = document.getElementById('uploaded-docs-placeholder');
    if (!documentsList || !placeholder) {
        return;
    }
    try {
        const response = await fetch(`/documents?participantID=${encodeURIComponent(participantID)}`);
        const docs = await response.json();
        console.log("Docs:", docs);

        documentsList.innerHTML = "";

        if (docs.length === 0) {
            placeholder.style.display = '';
            return;
        }
        placeholder.style.display = 'none';

        docs.forEach((doc) => {
            const li = document.createElement("li");
            li.className = 'doc-item';
            const label = document.createElement('span');
            label.textContent = `${doc.filename} - ${doc.processingStatus}`;
            const delBtn = document.createElement('button');
            delBtn.className = 'doc-delete-btn';
            delBtn.textContent = '×';
            delBtn.title = 'Delete document';
            delBtn.addEventListener('click', () => deleteDocument(doc._id, doc.filename));
            li.appendChild(label);
            li.appendChild(delBtn);
            documentsList.appendChild(li);
        });
    } catch (e) {
        console.error('loadDocuments:', e);
    }
}

async function deleteDocument(id, filename) {
    logEvent('click', 'Delete Document');
    if (!confirm(`Delete "${filename}"?`)) return;
    try {
        const response = await fetch(`/documents/${id}?participantID=${encodeURIComponent(participantID)}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            alert(`Could not delete: ${err.error || response.status}`);
            return;
        }
        await loadDocuments();
    } catch (e) {
        console.error('deleteDocument:', e);
    }
}

loadDocuments();

// Generic redirect to a Qualtrics survey by surveyType.
function redirectToQualtrics(surveyType) {
    fetch('/redirect-to-survey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantID, surveyType })
    })
      .then(response => response.text())
      .then(url => {
        logEvent('redirect', `Qualtrics Survey: ${surveyType}`);
        window.location.href = url;
      })
      .catch(error => {
        console.error('Error redirecting to survey:', error);
        alert('There was an error redirecting to the survey. Please try again.');
      });
}

// Wire each study-workflow survey button: gate on previous step + mark current done.
const surveyBtn = document.getElementById('survey-btn');
if (surveyBtn) {
    surveyBtn.addEventListener('click', () => {
        // Step 1 has no prerequisite.
        markStepDone('step1');
        redirectToQualtrics('demographics');
    });
}

const posttaskBtn = document.getElementById('posttask-btn');
if (posttaskBtn) {
    posttaskBtn.addEventListener('click', () => {
        if (!requirePrevStep('step3', 'Use the AI system')) return;
        markStepDone('step4');
        redirectToQualtrics('posttask');
    });
}

const usabilityBtn = document.getElementById('usability-btn');
if (usabilityBtn) {
    usabilityBtn.addEventListener('click', () => {
        if (!requirePrevStep('step4', 'Complete the post-task questionnaire')) return;
        markStepDone('step5');
        redirectToQualtrics('usability');
    });
}

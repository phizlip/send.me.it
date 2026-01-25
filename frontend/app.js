let peer = null;
let selectedFiles = [];
let currentFileIndex = 0;
let currentConnection = null;
let isReceiver = false;
let globalTransferStartTime = null;
let confirmedChunks = 0;
let transferCancelled = false;

document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupDragAndDrop();
});

function initializeApp() {
    // Check for any stored message from cancelled transfer
    const transferMessage = sessionStorage.getItem('transferMessage');
    if (transferMessage) {
        sessionStorage.removeItem('transferMessage');
        alert(transferMessage);
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    const peerId = urlParams.get('peer');
    
    if (peerId) {
        isReceiver = true;
        showReceiverSection();
        connectToPeer(peerId);
    } else {
        showSenderSection();
    }
}

function setupDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    
    dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', function(e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            selectedFiles = Array.from(files);
            currentFileIndex = 0;
            
            displayFileList();
            
            document.getElementById('file-info').style.display = 'block';
            
            initializePeer();
        }
    });
    
    dropZone.addEventListener('click', function(e) {
        if (e.target !== document.getElementById('file-input')) {
            document.getElementById('file-input').click();
        }
    });
}

function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    
    if (files.length > 0) {
        selectedFiles = files;
        currentFileIndex = 0;
        
        displayFileList();
        
        document.getElementById('file-info').style.display = 'block';
        
        initializePeer();
    }
}

function displayFileList() {
    const fileList = document.getElementById('file-list');
    
    fileList.innerHTML = '';
    
    selectedFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-size">${formatFileSize(file.size)}</div>
            </div>
            <button type="button" class="btn btn-remove" onclick="removeFile(${index})" title="Remove file">X</button>
        `;
        fileList.appendChild(fileItem);
    });
}

function getPeerConfig() {
    const isSecure = window.location.protocol === 'https:';
    return {
        host: window.location.hostname,
        port: isSecure ? (parseInt(window.location.port) || 443) : 9000,
        path: '/peerjs',
        secure: isSecure,
        debug: 2
    };
}

function initializePeer() {
    const peerId = generatePeerId();
    
    peer = new Peer(peerId, getPeerConfig());
    
    peer.on('open', function(id) {
        const shareLink = `${window.location.origin}${window.location.pathname}?peer=${id}`;
        document.getElementById('share-link').value = shareLink;
        
        peer.on('connection', function(conn) {
            currentConnection = conn;
            handleConnection(conn);
        });
    });
    
    peer.on('error', function(err) {
        console.error('Peer error:', err);
        updateStatus('Connection error: ' + err.message);
    });
}

function generatePeerId() {
    return 'peer-' + Math.random().toString(36).substr(2, 9);
}

function handleConnection(conn) {
    updateStatus('Recipient connected! Starting file transfer...');
    
    globalTransferStartTime = Date.now();
    confirmedChunks = 0;
    transferCancelled = false;
    
    conn.on('open', function() {
        sendNextFile(conn);
    });
    
    conn.on('data', function(data) {
        if (data.type === 'transfer_complete') {
            const totalTime = data.totalTime;
            const senderTotalTime = globalTransferStartTime ? (Date.now() - globalTransferStartTime) / 1000 : 0;
            updateStatus(`TRANSFER COMPLETE - All files received successfully! (${Math.round(senderTotalTime)}s)`, true);
        } else if (data.type === 'chunk_ack') {
            confirmedChunks = data.confirmedIndex;
        } else if (data.type === 'file_received') {
            updateStatus(`File ${currentFileIndex + 1} confirmed received by recipient.`);
            currentFileIndex++;
            confirmedChunks = 0;
            
            if (currentFileIndex < selectedFiles.length) {
                setTimeout(() => {
                    sendNextFile(conn);
                }, 500);
            } else {
                conn.send({ type: 'complete' });
                updateStatus('All files sent and confirmed! You may close this tab.', true);
            }
        } else if (data.type === 'transfer_cancelled') {
            transferCancelled = true;
            sessionStorage.setItem('transferMessage', 'Transfer cancelled by recipient.');
            window.location.href = window.location.origin + window.location.pathname;
        }
    });
    
    conn.on('close', function() {
        if (!transferCancelled) {
            // Connection closed without explicit cancel - recipient likely cancelled
            transferCancelled = true;
            sessionStorage.setItem('transferMessage', 'Transfer cancelled by recipient.');
            window.location.href = window.location.origin + window.location.pathname;
        }
    });
    
    conn.on('error', function(err) {
        console.error('Connection error:', err);
        if (!transferCancelled) {
            updateStatus('Transfer error: ' + err.message);
        }
    });
}

function sendNextFile(conn) {
    if (currentFileIndex >= selectedFiles.length) {
        updateStatus('All files sent and confirmed! You may close this tab.', true);
        return;
    }
    
    const currentFile = selectedFiles[currentFileIndex];
    
    const metadata = {
        type: 'metadata',
        name: currentFile.name,
        size: currentFile.size,
        fileIndex: currentFileIndex,
        totalFiles: selectedFiles.length
    };
    
    conn.send(metadata);
    
    sendFileInChunks(conn, currentFile);
}

function sendFileInChunks(conn, file) {
    const chunkSize = 16384;
    const totalChunks = Math.ceil(file.size / chunkSize);
    let currentChunk = 0;
    let startTime = Date.now();
    let lastUpdateTime = 0;
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
        // Stop if transfer was cancelled
        if (transferCancelled || !conn.open) {
            return;
        }
        
        const chunk = e.target.result;
        const chunkData = {
            type: 'chunk',
            data: chunk,
            index: currentChunk,
            total: totalChunks
        };
        
        conn.send(chunkData);
        currentChunk++;
        
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateTime;
        
        // Update progress once per second or on completion
        if (timeSinceLastUpdate >= 1000 || currentChunk === totalChunks) {
            lastUpdateTime = now;
            
            const sentProgress = Math.round((currentChunk / totalChunks) * 100);
            const confirmedProgress = Math.round((confirmedChunks / totalChunks) * 100);
            const elapsed = (now - startTime) / 1000;
            const bytesConfirmed = confirmedChunks * chunkSize;
            const speed = bytesConfirmed / elapsed;
            const remainingBytes = file.size - bytesConfirmed;
            const eta = speed > 0 ? Math.round(remainingBytes / speed) + 's' : '...';
            
            updateSenderProgress(
                file.name,
                sentProgress,
                confirmedProgress,
                formatFileSize(speed) + '/s',
                eta,
                currentFileIndex,
                selectedFiles.length
            );
        }
        
        if (transferCancelled || !conn.open) {
            return;
        }
        
        if (currentChunk < totalChunks) {
            const start = currentChunk * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            reader.readAsArrayBuffer(file.slice(start, end));
        } else {
            conn.send({ type: 'file_complete', fileIndex: currentFileIndex });
            updateStatus(`File ${currentFileIndex + 1}/${selectedFiles.length} sent. Waiting for confirmation...`);
        }
    };
    
    reader.onerror = function() {
        updateStatus('Error reading file');
    };
    
    const start = 0;
    const end = Math.min(chunkSize, file.size);
    reader.readAsArrayBuffer(file.slice(start, end));
}

function connectToPeer(peerId) {
    peer = new Peer(getPeerConfig());
    
    peer.on('open', function(id) {
        const conn = peer.connect(peerId);
        
        conn.on('open', function() {
            currentConnection = conn;
            transferCancelled = false;
            updateReceiverStatus('Connected to sender. Waiting for file...');
            setupReceiverConnection(conn);
        });
        
        conn.on('error', function(err) {
            console.error('Connection error:', err);
            updateReceiverStatus('Connection error: ' + err.message);
        });
    });
    
    peer.on('error', function(err) {
        console.error('Peer error:', err);
        updateReceiverStatus('Connection error: ' + err.message);
    });
}

function setupReceiverConnection(conn) {
    let receivedChunks = [];
    let fileMetadata = null;
    let totalChunks = 0;
    let receivedChunksCount = 0;
    let globalStartTime = Date.now();
    let fileStartTime = Date.now();
    let totalFiles = 0;
    let currentFileIndex = 0;
    let receivedFiles = [];
    let lastUpdateTime = 0;
    
    conn.on('data', function(data) {
        if (data.type === 'metadata') {
            fileMetadata = data;
            totalChunks = Math.ceil(data.size / 16384);
            receivedChunks = new Array(totalChunks);
            receivedChunksCount = 0;
            
            totalFiles = data.totalFiles || 1;
            currentFileIndex = data.fileIndex || 0;
            
            updateReceiverStatus(`Receiving file ${currentFileIndex + 1}/${totalFiles}: ${data.name} (${formatFileSize(data.size)})`);
        } else if (data.type === 'chunk') {
            receivedChunks[data.index] = data.data;
            receivedChunksCount++;
            
            const progress = Math.round((receivedChunksCount / totalChunks) * 100);
            // Progress is now shown in the status box
            
            // Send ACK every 50 chunks
            if (receivedChunksCount % 50 === 0) {
                conn.send({ type: 'chunk_ack', confirmedIndex: receivedChunksCount });
            }
            
            const now = Date.now();
            const timeSinceLastUpdate = now - lastUpdateTime;
            
            // Update progress once per second or on completion
            if (timeSinceLastUpdate >= 1000 || receivedChunksCount === totalChunks) {
                lastUpdateTime = now;
                
                const elapsed = (now - fileStartTime) / 1000;
                const bytesReceived = receivedChunksCount * 16384;
                const speed = bytesReceived / elapsed;
                const remainingBytes = (totalChunks - receivedChunksCount) * 16384;
                const eta = speed > 0 ? Math.round(remainingBytes / speed) + 's' : '...';
                
                updateReceiverProgress(
                    fileMetadata.name,
                    formatFileSize(fileMetadata.size),
                    progress,
                    formatFileSize(speed) + '/s',
                    eta,
                    currentFileIndex,
                    totalFiles
                );
            }
        } else if (data.type === 'file_complete') {
            // Send final ACK for this file
            conn.send({ type: 'chunk_ack', confirmedIndex: receivedChunksCount });
            
            // Filter out any undefined entries from sparse array
            const validChunks = receivedChunks.filter(chunk => chunk !== undefined);
            
            // Log warning if chunks are missing
            if (validChunks.length !== totalChunks) {
                console.warn(`Missing chunks: expected ${totalChunks}, got ${validChunks.length}`);
            }
            
            const fileBlob = new Blob(validChunks);
            receivedFiles.push({
                name: fileMetadata.name,
                blob: fileBlob
            });

            downloadFile(fileBlob, fileMetadata.name);

            updateReceiverStatus(`FILE RECEIVED: ${fileMetadata.name} - Download started!`);

            conn.send({ type: 'file_received', fileIndex: currentFileIndex });

            receivedChunks = [];
            receivedChunksCount = 0;
            fileStartTime = Date.now();
        } else if (data.type === 'complete') {
            const totalTime = (Date.now() - globalStartTime) / 1000;
            updateReceiverStatus(`TRANSFER COMPLETE - All ${totalFiles} file(s) received in ${Math.round(totalTime)}s!`, true);
            
            conn.send({ type: 'transfer_complete', totalTime: totalTime });
        } else if (data.type === 'transfer_cancelled') {
            transferCancelled = true;
            sessionStorage.setItem('transferMessage', 'Transfer cancelled by sender.');
            window.location.href = window.location.origin + window.location.pathname;
        }
    });
    
    conn.on('close', function() {
        if (!transferCancelled) {
            // Connection closed without explicit cancel - sender likely cancelled
            transferCancelled = true;
            sessionStorage.setItem('transferMessage', 'Transfer cancelled by sender.');
            window.location.href = window.location.origin + window.location.pathname;
        }
    });
}

function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showSenderSection() {
    document.getElementById('sender-section').style.display = 'flex';
    document.getElementById('receiver-section').style.display = 'none';
}

function showReceiverSection() {
    document.getElementById('sender-section').style.display = 'none';
    document.getElementById('receiver-section').style.display = 'flex';
}

function updateStatus(message, isComplete = false) {
    const messageEl = document.getElementById('status-message');
    
    // Hide all progress rows, show message only
    messageEl.style.display = 'flex';
    messageEl.querySelector('span').textContent = message;
    
    ['status-file', 'status-progress', 'status-speed', 'status-eta', 'status-overall'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
    
    if (isComplete) {
        document.getElementById('connection-status').className = 'status-complete';
        document.getElementById('sender-cancel-btn').style.display = 'none';
    } else {
        document.getElementById('connection-status').className = 'status-box';
    }
}

function updateSenderProgress(fileName, sentPercent, confirmedPercent, speed, eta, fileIndex, totalFiles) {
    document.getElementById('status-message').style.display = 'none';
    
    document.getElementById('status-file-value').textContent = fileName;
    document.getElementById('status-file').style.display = 'flex';
    
    document.getElementById('status-progress-value').textContent = `Sent ${sentPercent}% | Confirmed ${confirmedPercent}%`;
    document.getElementById('status-progress').style.display = 'flex';
    
    document.getElementById('status-speed-value').textContent = speed;
    document.getElementById('status-speed').style.display = 'flex';
    
    document.getElementById('status-eta-value').textContent = eta;
    document.getElementById('status-eta').style.display = 'flex';
    
    document.getElementById('status-overall-value').textContent = `${fileIndex} of ${totalFiles} files`;
    document.getElementById('status-overall').style.display = 'flex';
}

function updateReceiverStatus(message, isComplete = false) {
    const messageEl = document.getElementById('receiver-status-message');
    
    // Hide all progress rows, show message only
    messageEl.style.display = 'flex';
    messageEl.querySelector('span').textContent = message;
    
    ['receiver-status-file', 'receiver-status-size', 'receiver-status-progress', 'receiver-status-speed', 'receiver-status-eta', 'receiver-status-overall'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
    
    if (isComplete) {
        document.getElementById('receiver-info').className = 'status-complete';
        document.getElementById('receiver-cancel-btn').style.display = 'none';
    } else {
        document.getElementById('receiver-info').className = 'status-box';
    }
}

function updateReceiverProgress(fileName, fileSize, percent, speed, eta, fileIndex, totalFiles) {
    document.getElementById('receiver-status-message').style.display = 'none';
    
    document.getElementById('receiver-status-file-value').textContent = fileName;
    document.getElementById('receiver-status-file').style.display = 'flex';
    
    document.getElementById('receiver-status-size-value').textContent = fileSize;
    document.getElementById('receiver-status-size').style.display = 'flex';
    
    document.getElementById('receiver-status-progress-value').textContent = percent + '%';
    document.getElementById('receiver-status-progress').style.display = 'flex';
    
    document.getElementById('receiver-status-speed-value').textContent = speed;
    document.getElementById('receiver-status-speed').style.display = 'flex';
    
    document.getElementById('receiver-status-eta-value').textContent = eta;
    document.getElementById('receiver-status-eta').style.display = 'flex';
    
    document.getElementById('receiver-status-overall-value').textContent = `${fileIndex} of ${totalFiles} files`;
    document.getElementById('receiver-status-overall').style.display = 'flex';
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    
    if (currentFileIndex >= selectedFiles.length) {
        currentFileIndex = Math.max(0, selectedFiles.length - 1);
    }
    
    displayFileList();
    
    if (selectedFiles.length === 0) {
        document.getElementById('file-info').style.display = 'none';
        document.getElementById('file-input').value = '';
        if (peer) {
            peer.destroy();
            peer = null;
        }
    }
}

function copyLink() {
    const linkInput = document.getElementById('share-link');
    linkInput.select();
    linkInput.setSelectionRange(0, 99999);
    
    try {
        document.execCommand('copy');
        const copyBtn = document.querySelector('.btn-secondary');
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyBtn.textContent = originalText;
        }, 2000);
    } catch (err) {
        console.error('Failed to copy:', err);
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function cancelTransfer() {
    // Set flag to stop any ongoing transfers
    transferCancelled = true;
    
    // Notify the other party before closing
    if (currentConnection) {
        try {
            currentConnection.send({ type: 'transfer_cancelled' });
        } catch (e) {
            console.log('Could not send cancel message:', e);
        }
    }
    
    // Delay to allow message to send before redirecting
    setTimeout(() => {
        // Close the current connection
        if (currentConnection) {
            try {
                currentConnection.close();
            } catch (e) {}
        }
        
        // Destroy the peer
        if (peer) {
            try {
                peer.destroy();
            } catch (e) {}
        }
        
        // Redirect to home page (force refresh)
        window.location.href = window.location.origin + window.location.pathname;
    }, 500);
}

function resetToHome() {
    // Clean up peer connection
    if (currentConnection) {
        currentConnection.close();
        currentConnection = null;
    }
    if (peer) {
        peer.destroy();
        peer = null;
    }
    
    selectedFiles = [];
    currentFileIndex = 0;
    isReceiver = false;
    globalTransferStartTime = null;
    confirmedChunks = 0;
    transferCancelled = false;
    
    document.getElementById('file-info').style.display = 'none';
    document.getElementById('file-input').value = '';
    
    showSenderSection();
    
    document.getElementById('drop-zone').classList.remove('dragover');
    
    // Reset sender status
    updateStatus('Waiting for recipient...');
    
    // Reset receiver status  
    const receiverInfo = document.getElementById('receiver-info');
    if (receiverInfo) {
        receiverInfo.className = 'status-box';
    }
    const receiverMessage = document.getElementById('receiver-status-message');
    if (receiverMessage) {
        receiverMessage.style.display = 'flex';
        receiverMessage.querySelector('span').textContent = 'Connecting to sender...';
    }
    ['receiver-status-file', 'receiver-status-size', 'receiver-status-progress', 'receiver-status-speed', 'receiver-status-eta', 'receiver-status-overall'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    
    if (window.history && window.history.pushState) {
        const baseUrl = window.location.origin + window.location.pathname;
        window.history.pushState({}, '', baseUrl);
    }
}

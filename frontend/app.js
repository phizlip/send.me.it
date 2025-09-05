let peer = null;
let selectedFiles = [];
let currentFileIndex = 0;
let currentConnection = null;
let isReceiver = false;
let globalTransferStartTime = null;

document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupDragAndDrop();
});

function initializeApp() {
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
    console.log('File input change event triggered');
    console.log('Files selected:', event.target.files);
    
    const files = Array.from(event.target.files);
    console.log('Files array:', files);
    
    if (files.length > 0) {
        selectedFiles = files;
        currentFileIndex = 0;
        
        console.log('Selected files:', selectedFiles);
        
        displayFileList();
        
        document.getElementById('file-info').style.display = 'block';
        
        initializePeer();
    }
}

function displayFileList() {
    const fileList = document.getElementById('file-list');
    const totalFiles = document.getElementById('total-files');
    const totalSize = document.getElementById('total-size');
    
    fileList.innerHTML = '';
    
    const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    
        selectedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
                <span class="file-remove" onclick="removeFile(${index})" title="Remove file">×</span>
            `;
            fileList.appendChild(fileItem);
        });
    
    totalFiles.textContent = selectedFiles.length;
    totalSize.textContent = formatFileSize(totalBytes);
}

function initializePeer() {
    const peerId = generatePeerId();
    
    peer = new Peer(peerId, {
        host: window.location.hostname,
        path: '/peerjs',
        debug: 2
    });
    
    peer.on('open', function(id) {
        console.log('Peer connection opened with ID:', id);
        
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
    
    conn.on('open', function() {
        sendNextFile(conn);
    });
    
    conn.on('data', function(data) {
        if (data.type === 'transfer_complete') {
            const totalTime = data.totalTime;
            const senderTotalTime = globalTransferStartTime ? (Date.now() - globalTransferStartTime) / 1000 : 0;
            updateStatus(`All files transferred successfully! Receiver time: ${Math.round(totalTime)}s, Sender time: ${Math.round(senderTotalTime)}s`);
        } else if (data.type === 'speed_update') {
            receiverSpeed = data.speed;
        } else if (data.type === 'file_received') {
            updateStatus(`File ${currentFileIndex + 1} confirmed received! Moving to next file...`);
            currentFileIndex++;
            
            updateOverallProgress();
            
            if (currentFileIndex < selectedFiles.length) {
                setTimeout(() => {
                    sendNextFile(conn);
                }, 500);
            } else {
                conn.send({ type: 'complete' });
                updateStatus('All files sent! Waiting for receiver to confirm... DO NOT CLOSE THIS TAB!');
            }
        }
    });
    
    conn.on('error', function(err) {
        console.error('Connection error:', err);
        updateStatus('Transfer error: ' + err.message);
    });
}

function sendFileInChunks(conn) {
    const chunkSize = 16384;
    const totalChunks = Math.ceil(currentFile.size / chunkSize);
    let currentChunk = 0;
    let startTime = Date.now();
    let speedHistory = [];
    let lastUpdateTime = startTime;
    let receiverSpeed = null;
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
        const chunk = e.target.result;
        const chunkData = {
            type: 'chunk',
            data: chunk,
            index: currentChunk,
            total: totalChunks
        };
        
        conn.send(chunkData);
        currentChunk++;
        
        const progress = Math.round((currentChunk / totalChunks) * 100);
        updateProgress(progress);
        
        if (currentChunk % 100 === 0 || currentChunk === totalChunks) {
            const now = Date.now();
            const elapsed = (now - startTime) / 1000;
            const bytesSent = currentChunk * chunkSize;
            
            const currentSpeed = bytesSent / elapsed;
            
            speedHistory.push(currentSpeed);
            if (speedHistory.length > 5) {
                speedHistory.shift();
            }
            
            const smoothedSpeed = speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length;
            
            conn.send({ type: 'speed_update', speed: smoothedSpeed });
            
            // The transfer is limited by the slower of upload vs download speeds
            let effectiveTransferRate = smoothedSpeed * 0.8;
            const remainingChunks = totalChunks - currentChunk;
            
            if (receiverSpeed) {
                effectiveTransferRate = Math.min(smoothedSpeed, receiverSpeed);
                const eta = Math.round(remainingChunks * (chunkSize / effectiveTransferRate));
                updateStatus(`Sending: ${progress}% - ${formatFileSize(smoothedSpeed)}/s (upload) / ${formatFileSize(receiverSpeed)}/s (download) - ETA: <span class="eta-number">${eta.toString().padStart(3, ' ')}</span>s (bottleneck: ${formatFileSize(effectiveTransferRate)}/s)`);
            } else {
                const eta = Math.round(remainingChunks * (chunkSize / effectiveTransferRate));
                updateStatus(`Sending: ${progress}% - ${formatFileSize(smoothedSpeed)}/s - ETA: <span class="eta-number">${eta.toString().padStart(3, ' ')}</span>s (bottleneck-aware)`);
            }
            
            lastUpdateTime = now;
        }
        
        if (currentChunk < totalChunks) {
            const start = currentChunk * chunkSize;
            const end = Math.min(start + chunkSize, currentFile.size);
            reader.readAsArrayBuffer(currentFile.slice(start, end));
        } else {
            conn.send({ type: 'complete' });
            updateStatus('File sent! Waiting for receiver to confirm... DO NOT CLOSE THIS TAB!');
        }
    };
    
    reader.onerror = function() {
        updateStatus('Error reading file');
    };
    
    const start = 0;
    const end = Math.min(chunkSize, currentFile.size);
    reader.readAsArrayBuffer(currentFile.slice(start, end));
}

function sendNextFile(conn) {
    if (currentFileIndex >= selectedFiles.length) {
        updateStatus('All files sent! Waiting for receiver to confirm... DO NOT CLOSE THIS TAB!');
        return;
    }
    
    const currentFile = selectedFiles[currentFileIndex];
    
    document.getElementById('current-file-name').textContent = currentFile.name;
    
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
    let speedHistory = [];
    let lastUpdateTime = startTime;
    let receiverSpeed = null;
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
        const chunk = e.target.result;
        const chunkData = {
            type: 'chunk',
            data: chunk,
            index: currentChunk,
            total: totalChunks
        };
        
        conn.send(chunkData);
        currentChunk++;
        
        const progress = Math.round((currentChunk / totalChunks) * 100);
        updateProgress(progress);
        
        updateOverallProgress();
        
        if (currentChunk % 100 === 0 || currentChunk === totalChunks) {
            const now = Date.now();
            const elapsed = (now - startTime) / 1000;
            const bytesSent = currentChunk * chunkSize;
            
            const currentSpeed = bytesSent / elapsed;
            
            speedHistory.push(currentSpeed);
            if (speedHistory.length > 5) {
                speedHistory.shift();
            }
            
            const smoothedSpeed = speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length;
            
            conn.send({ type: 'speed_update', speed: smoothedSpeed });
            
            // The transfer is limited by the slower of upload vs download speeds
            let effectiveTransferRate = smoothedSpeed * 0.8;
            const remainingChunks = totalChunks - currentChunk;
            
            if (receiverSpeed) {
                effectiveTransferRate = Math.min(smoothedSpeed, receiverSpeed);
                updateStatus(`Sending file ${currentFileIndex + 1} of ${selectedFiles.length}: ${progress}% - ${formatFileSize(smoothedSpeed)}/s (upload) / ${formatFileSize(receiverSpeed)}/s (download) - ETA: <span class="eta-number">${Math.round(remainingChunks * (chunkSize / effectiveTransferRate))}</span>s (bottleneck: ${formatFileSize(effectiveTransferRate)}/s)`);
            } else {
                const eta = remainingChunks * (chunkSize / effectiveTransferRate);
                updateStatus(`Sending file ${currentFileIndex + 1} of ${selectedFiles.length}: ${progress}% - ${formatFileSize(smoothedSpeed)}/s - ETA: <span class="eta-number">${Math.round(eta)}</span>s (bottleneck-aware)`);
            }
            
            lastUpdateTime = now;
        }
        
        if (currentChunk < totalChunks) {
            const start = currentChunk * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            reader.readAsArrayBuffer(file.slice(start, end));
        } else {
            conn.send({ type: 'file_complete', fileIndex: currentFileIndex });
            updateStatus(`File ${currentFileIndex + 1} of ${selectedFiles.length} sent! Waiting for receiver confirmation...`);
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
    peer = new Peer({
        host: window.location.hostname,
        path: '/peerjs',
        debug: 2
    });
    
    peer.on('open', function(id) {
        console.log('Receiver peer opened with ID:', id);
        
        const conn = peer.connect(peerId);
        
        conn.on('open', function() {
            updateReceiverStatus('Connected to sender. Receiving file...');
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
    let speedHistory = [];
    let senderSpeed = null;
    let totalFiles = 0;
    let currentFileIndex = 0;
    let receivedFiles = [];
    
    conn.on('data', function(data) {
        if (data.type === 'metadata') {
            fileMetadata = data;
            totalChunks = Math.ceil(data.size / 16384);
            receivedChunks = new Array(totalChunks);
            receivedChunksCount = 0;
            
            totalFiles = data.totalFiles || 1;
            currentFileIndex = data.fileIndex || 0;
            
            document.getElementById('receiver-current-file-name').textContent = data.name;
            
            updateReceiverOverallProgress(currentFileIndex, totalFiles);
            
            updateReceiverStatus(`Receiving file ${currentFileIndex + 1} of ${totalFiles}: ${data.name} (${formatFileSize(data.size)})`);
            showReceiverProgress();
        } else if (data.type === 'chunk') {
            receivedChunks[data.index] = data.data;
            receivedChunksCount++;
            
            const progress = Math.round((receivedChunksCount / totalChunks) * 100);
            updateReceiverProgress(progress);
            
                   if (receivedChunksCount % 100 === 0 || receivedChunksCount === totalChunks) {
                       const now = Date.now();
                       const elapsed = (now - fileStartTime) / 1000;
                       const bytesReceived = receivedChunksCount * 16384;
                
                const currentSpeed = bytesReceived / elapsed;
                
                speedHistory.push(currentSpeed);
                if (speedHistory.length > 5) {
                    speedHistory.shift();
                }
                
                const smoothedSpeed = speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length;
                
                conn.send({ type: 'speed_update', speed: smoothedSpeed });
                
                // The transfer is limited by the slower of upload vs download speeds
                let effectiveTransferRate = smoothedSpeed * 0.8;
                const remainingChunks = totalChunks - receivedChunksCount;
                
                if (senderSpeed) {
                    effectiveTransferRate = Math.min(smoothedSpeed, senderSpeed);
                    const eta = Math.round(remainingChunks * (16384 / effectiveTransferRate));
                    updateReceiverStatus(`Receiving: ${progress}% - ${formatFileSize(smoothedSpeed)}/s (download) / ${formatFileSize(senderSpeed)}/s (upload) - ETA: <span class="eta-number">${eta.toString().padStart(3, ' ')}</span>s (bottleneck: ${formatFileSize(effectiveTransferRate)}/s)`);
                } else {
                    const eta = Math.round(remainingChunks * (16384 / effectiveTransferRate));
                    updateReceiverStatus(`Receiving: ${progress}% - ${formatFileSize(smoothedSpeed)}/s - ETA: <span class="eta-number">${eta.toString().padStart(3, ' ')}</span>s (bottleneck-aware)`);
                }
            }
        } else if (data.type === 'speed_update') {
            senderSpeed = data.speed;
                } else if (data.type === 'file_complete') {
            const fileBlob = new Blob(receivedChunks);
            receivedFiles.push({
                name: fileMetadata.name,
                blob: fileBlob
            });

            // Download the file immediately for all files except the last one
            downloadFile(fileBlob, fileMetadata.name);

            updateReceiverStatus(`File ${currentFileIndex + 1} of ${totalFiles} received! Confirming to sender...`);

            conn.send({ type: 'file_received', fileIndex: currentFileIndex });

            receivedChunks = [];
            receivedChunksCount = 0;
            speedHistory = [];
            fileStartTime = Date.now();
        } else if (data.type === 'complete') {
            // Only download the last file if there are still chunks to process
            if (receivedChunksCount > 0) {
                const fileBlob = new Blob(receivedChunks);
                receivedFiles.push({
                    name: fileMetadata.name,
                    blob: fileBlob
                });
                
                // Download the last file, prevents 0 byte ghost files
                downloadFile(fileBlob, fileMetadata.name);
            }
            
            const totalTime = (Date.now() - globalStartTime) / 1000;
            updateReceiverStatus(`All ${totalFiles} files received successfully in ${Math.round(totalTime)}s! (Total transfer time)`);
            
            conn.send({ type: 'transfer_complete', totalTime: totalTime });
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
    document.getElementById('sender-section').style.display = 'block';
    document.getElementById('receiver-section').style.display = 'none';
}

function showReceiverSection() {
    document.getElementById('sender-section').style.display = 'none';
    document.getElementById('receiver-section').style.display = 'block';
}

function updateStatus(message) {
    const statusElement = document.getElementById('connection-status');
    statusElement.innerHTML = `<p>${message}</p>`;
}

function updateReceiverStatus(message) {
    const statusElement = document.getElementById('receiver-info');
    const firstParagraph = statusElement.querySelector('p');
    if (firstParagraph) {
        firstParagraph.innerHTML = message;
    } else {
        statusElement.innerHTML = `<p>${message}</p>`;
    }
}

function showReceiverProgress() {
    document.getElementById('receiver-progress').style.display = 'block';
}

function updateProgress(percentage) {
    document.getElementById('progress-fill').style.width = percentage + '%';
    document.getElementById('progress-text').textContent = percentage + '%';
    
    if (percentage > 0) {
        document.getElementById('transfer-progress').style.display = 'block';
    }
}

function updateOverallProgress() {
    const overallProgressFill = document.getElementById('overall-progress-fill');
    const overallProgressText = document.getElementById('overall-progress-text');
    
    if (overallProgressFill && overallProgressText) {
        const overallProgress = Math.round(((currentFileIndex) / selectedFiles.length) * 100);
        overallProgressFill.style.width = overallProgress + '%';
        overallProgressText.textContent = `${currentFileIndex} of ${selectedFiles.length} files`;
    }
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    
    if (currentFileIndex >= selectedFiles.length) {
        currentFileIndex = Math.max(0, selectedFiles.length - 1);
    }
    
    displayFileList();
    
    if (selectedFiles.length === 0) {
        document.getElementById('file-info').style.display = 'none';
        if (peer) {
            peer.destroy();
            peer = null;
        }
    }
}

function updateReceiverProgress(percentage) {
    document.getElementById('receiver-progress-fill').style.width = percentage + '%';
    document.getElementById('receiver-progress-text').textContent = percentage + '%';
}

function updateReceiverOverallProgress(currentFileIndex, totalFiles) {
    const overallProgressFill = document.getElementById('receiver-overall-progress-fill');
    const overallProgressText = document.getElementById('receiver-overall-progress-text');
    
    if (overallProgressFill && overallProgressText) {
        const completedFiles = currentFileIndex + 1;
        const overallProgress = Math.round((completedFiles / totalFiles) * 100);
        overallProgressFill.style.width = overallProgress + '%';
        overallProgressText.textContent = `${completedFiles} of ${totalFiles} files`;
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
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function resetToHome() {
    peer = null;
    selectedFiles = [];
    currentFileIndex = 0;
    currentConnection = null;
    isReceiver = false;
    globalTransferStartTime = null;
    
    document.getElementById('file-info').style.display = 'none';
    document.getElementById('transfer-progress').style.display = 'none';
    
    document.getElementById('file-input').value = '';
    
    showSenderSection();
    
    document.getElementById('drop-zone').classList.remove('dragover');
    
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        statusElement.innerHTML = '<p>Waiting for recipient to connect...</p>';
    }
    
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) {
        progressFill.style.width = '0%';
    }
    const progressText = document.getElementById('progress-text');
    if (progressText) {
        progressText.textContent = '0%';
    }
    
    const receiverProgressFill = document.getElementById('receiver-progress-fill');
    if (receiverProgressFill) {
        receiverProgressFill.style.width = '0%';
    }
    const receiverProgressText = document.getElementById('receiver-progress-text');
    if (receiverProgressText) {
        receiverProgressText.textContent = '0%';
    }
    
    const receiverProgress = document.getElementById('receiver-progress');
    if (receiverProgress) {
        receiverProgress.style.display = 'none';
    }
    
    if (window.history && window.history.pushState) {
        const baseUrl = window.location.origin + window.location.pathname;
        window.history.pushState({}, '', baseUrl);
    }
}

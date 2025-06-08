// Get references to HTML elements
const startCaptureBtn = document.getElementById('start-capture-btn');
const captureFrameBtn = document.getElementById('capture-frame-btn');
const stopCaptureBtn = document.getElementById('stop-capture-btn');
const selectCropAreaBtn = document.getElementById('select-crop-area-btn');
const downloadAllZipBtn = document.getElementById('download-all-zip-btn');
const downloadAllPdfBtn = document.getElementById('download-all-pdf-btn');
const clearScreenshotsBtn = document.getElementById('clear-screenshots-btn');
const videoPreviewContainer = document.getElementById('video-preview-container');
const videoPreview = document.getElementById('video-preview');
const cropOverlay = document.getElementById('crop-overlay');
const screenshotsContainer = document.getElementById('screenshots-container');
const messageBox = document.getElementById('message-box');

// References for screenshot output preview
const screenshotOutputPreviewContainer = document.getElementById('screenshot-output-preview-container');
const screenshotOutputPreviewCanvas = document.getElementById('screenshot-output-preview-canvas');
const previewDimensionsText = document.getElementById('preview-dimensions-text');
const previewCtx = screenshotOutputPreviewCanvas.getContext('2d');


let mediaStream; // Stores the screen sharing stream
let screenshots = []; // Array to store captured image data: [{ id: number, dataUrl: string }]
let uniqueScreenshotIdCounter = 0; // Generates unique IDs for each screenshot

// Cropping state variables
let isDrawing = false;
let startX, startY; // Mouse coordinates where drawing started (relative to videoPreview)
let cropX = 0, cropY = 0, cropWidth = 0, cropHeight = 0; // Relative crop coordinates on videoPreview

// PDF image margin (in jsPDF units, default is 'mm' or 'pt')
const pdfImageMargin = 10; // 10mm or 10pt margin on all sides within the PDF page

// Function to display a temporary message to the user
function showMessage(message, duration = 3000) {
    messageBox.textContent = message;
    messageBox.classList.add('show');
    setTimeout(() => {
        messageBox.classList.remove('show');
    }, duration);
}

// Function to update button states based on capture status
function updateButtonStates(isCapturing) {
    startCaptureBtn.disabled = isCapturing;
    captureFrameBtn.disabled = !isCapturing;
    selectCropAreaBtn.disabled = !isCapturing; // Enable crop button when capturing
    stopCaptureBtn.disabled = !isCapturing;

    const hasScreenshots = screenshots.length > 0;
    downloadAllZipBtn.disabled = !hasScreenshots;
    downloadAllPdfBtn.disabled = !hasScreenshots;
    clearScreenshotsBtn.disabled = !hasScreenshots;

    // Show/hide video preview container and output preview container
    if (isCapturing) {
        videoPreviewContainer.classList.remove('hidden');
        screenshotOutputPreviewContainer.classList.remove('hidden');
    } else {
        videoPreviewContainer.classList.add('hidden');
        screenshotOutputPreviewContainer.classList.add('hidden');
        cropOverlay.classList.add('hidden'); // Ensure crop overlay is hidden when not capturing
    }
    updateScreenshotPreview(); // Update preview
}

// Function to update the screenshot output preview based on the live stream and current crop
async function updateScreenshotPreview() {
    let imgBitmap;
    if (mediaStream && mediaStream.getVideoTracks().length > 0) {
        const videoTrack = mediaStream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(videoTrack);
        try {
            imgBitmap = await imageCapture.grabFrame();
        } catch (error) {
            console.error('Failed to grab frame for preview:', error);
            imgBitmap = null; // Set to null if frame grab fails
        }
    }

    let sourceX = 0, sourceY = 0, sourceWidth = 0, sourceHeight = 0;
    let previewCanvasWidth = 0, previewCanvasHeight = 0;

    if (imgBitmap) {
        // Determine source dimensions based on videoPreview's intrinsic size
        const videoIntrinsicWidth = videoPreview.videoWidth;
        const videoIntrinsicHeight = videoPreview.videoHeight;

        // Get current displayed dimensions of videoPreview
        const videoDisplayedWidth = videoPreview.offsetWidth;
        const videoDisplayedHeight = videoPreview.offsetHeight;

        // Calculate scaling factors for crop coordinates from displayed pixels to intrinsic pixels
        const scaleX = videoIntrinsicWidth / videoDisplayedWidth;
        const scaleY = videoIntrinsicHeight / videoDisplayedHeight;

        // Calculate final crop coordinates in intrinsic pixels
        let finalCropX = cropX * scaleX;
        let finalCropY = cropY * scaleY;
        let finalCropWidth = cropWidth * scaleX;
        let finalCropHeight = cropHeight * scaleY;

        // If no crop area is selected, preview the entire stream
        if (cropWidth === 0 || cropHeight === 0) {
            sourceX = 0;
            sourceY = 0;
            sourceWidth = imgBitmap.width;
            sourceHeight = imgBitmap.height;
        } else {
            // Apply crop and clamp to imageBitmap boundaries
            sourceX = Math.max(0, Math.min(finalCropX, imgBitmap.width));
            sourceY = Math.max(0, Math.min(finalCropY, imgBitmap.height));
            sourceWidth = Math.max(0, Math.min(finalCropWidth, imgBitmap.width - sourceX));
            sourceHeight = Math.max(0, Math.min(finalCropHeight, imgBitmap.height - sourceY));
        }

        // Set preview canvas dimensions to the size of the *cropped* area
        previewCanvasWidth = sourceWidth;
        previewCanvasHeight = sourceHeight;

    } else {
        // Default placeholder size if no stream
        previewCanvasWidth = 640; // A reasonable default for preview
        previewCanvasHeight = 360;
    }

    // Update canvas dimensions
    screenshotOutputPreviewCanvas.width = previewCanvasWidth;
    screenshotOutputPreviewCanvas.height = previewCanvasHeight;

    // Clear canvas
    previewCtx.clearRect(0, 0, previewCanvasWidth, previewCanvasHeight);

    if (imgBitmap) {
        // Draw the cropped/full image bitmap onto the preview canvas
        previewCtx.drawImage(
            imgBitmap,
            sourceX, sourceY, sourceWidth, sourceHeight, // Source rectangle (from original imageBitmap)
            0, 0, previewCanvasWidth, previewCanvasHeight // Destination rectangle (on preview canvas)
        );
        previewDimensionsText.textContent = `Preview dimensions: ${Math.round(sourceWidth)}x${Math.round(sourceHeight)}px`;
    } else {
        // Draw a placeholder if no stream is active
        previewCtx.fillStyle = '#e2e8f0'; // Light gray
        previewCtx.fillRect(0, 0, previewCanvasWidth, previewCanvasHeight);
        previewCtx.fillStyle = '#718096'; // Darker gray
        previewCtx.font = '20px Inter, sans-serif';
        previewCtx.textAlign = 'center';
        previewCtx.textBaseline = 'middle';
        previewCtx.fillText('No Stream Active', previewCanvasWidth / 2, previewCanvasHeight / 2 - 20);
        previewDimensionsText.textContent = `Preview dimensions: --x--`;
    }
}


// --- Cropping Event Listeners ---

// This listener is crucial for drawing the crop rectangle on the video preview.
videoPreview.addEventListener('mousedown', (e) => {
    // Only allow drawing if stream is active AND user has clicked 'Select Crop Area'
    if (!mediaStream || selectCropAreaBtn.disabled) return; // Only if selectCropAreaBtn is enabled (meaning not in drawing mode)

    isDrawing = true;
    const rect = videoPreview.getBoundingClientRect(); // Get position of video element
    startX = e.clientX - rect.left; // Calculate mouse position relative to video element
    startY = e.clientY - rect.top;

    // Initialize crop dimensions to start at click point
    cropX = startX;
    cropY = startY;
    cropWidth = 0;
    cropHeight = 0;

    // Position and show the crop overlay
    cropOverlay.style.left = `${startX}px`;
    cropOverlay.style.top = `${startY}px`;
    cropOverlay.style.width = '0px';
    cropOverlay.style.height = '0px';
    cropOverlay.classList.remove('hidden'); // Make overlay visible when drawing starts
});

videoPreview.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;

    const rect = videoPreview.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    // Calculate current width and height of the rectangle
    const width = currentX - startX;
    const height = currentY - startY;

    // Adjust cropX, cropY, cropWidth, cropHeight for drawing from any corner
    // Ensures the rectangle's top-left corner is always the true top-left
    cropX = Math.min(startX, currentX);
    cropY = Math.min(startY, currentY);
    cropWidth = Math.abs(width);
    cropHeight = Math.abs(height);

    // Update overlay style to show the rectangle
    cropOverlay.style.left = `${cropX}px`;
    cropOverlay.style.top = `${cropY}px`;
    cropOverlay.style.width = `${cropWidth}px`;
    cropOverlay.style.height = `${cropHeight}px`;

    updateScreenshotPreview(); // Update preview as crop is being drawn
});

videoPreview.addEventListener('mouseup', () => {
    isDrawing = false;
    // Ensure minimum crop area, otherwise reset
    if (cropWidth < 10 || cropHeight < 10) { // Small threshold for accidental clicks
        resetCropArea();
        showMessage('Crop area too small or invalid, reset.', 2000);
    } else {
        showMessage(`Crop area selected: ${Math.round(cropWidth)}x${Math.round(cropHeight)}px`, 2000);
    }
    selectCropAreaBtn.disabled = false; // Re-enable the "Select Crop Area" button
    updateScreenshotPreview(); // Final update after mouse up
});

// Internal function to reset crop area
function resetCropArea() {
    cropX = 0;
    cropY = 0;
    cropWidth = 0;
    cropHeight = 0;
    cropOverlay.style.width = '0px';
    cropOverlay.style.height = '0px';
    cropOverlay.classList.add('hidden'); // Hide the overlay
}


// --- Main Event Listeners ---

// Select Crop Area Button
selectCropAreaBtn.addEventListener('click', () => {
    if (!mediaStream) {
        showMessage('Please start screen capture first to select an area.', 3000);
        return;
    }
    resetCropArea(); // Clear any existing crop to start fresh
    selectCropAreaBtn.disabled = true; // Disable this button while in drawing mode
    showMessage('Click and drag your mouse over the video preview to select the area you want to screenshot. Release to finalize.', 5000);
});

// Start Screen Capture Button
startCaptureBtn.addEventListener('click', async () => {
    try {
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always'
            },
            audio: false
        });

        videoPreview.srcObject = mediaStream;
        videoPreview.style.display = 'block';

        mediaStream.getVideoTracks()[0].addEventListener('ended', () => {
            stopCapture();
            showMessage('Screen sharing stopped by user.', 3000);
        });

        showMessage('Screen sharing started! Please select the screen, window, or tab you wish to share in the browser prompt. Then use "Select Crop Area" to define your region.', 7000);
        updateButtonStates(true);
        resetCropArea(); // Ensure crop is reset when a new stream starts
    }
    catch (err) {
        console.error("Error accessing display media: ", err);
        if (err.name === 'NotAllowedError') {
            showMessage('Permission denied. Please allow screen sharing to use this feature.', 5000);
        } else if (err.name === 'NotFoundError') {
            showMessage('No display media found. Ensure you have a screen to share.', 5000);
        } else if (err.name === 'AbortError') {
             showMessage('Screen sharing cancelled by user.', 3000);
        } else {
            showMessage(`Error starting capture: ${err.name}. Please try again.`, 5000);
        }
        updateButtonStates(false);
    }
});

// Take Screenshot Button
captureFrameBtn.addEventListener('click', () => {
    if (mediaStream && mediaStream.getVideoTracks().length > 0) {
        const videoTrack = mediaStream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(videoTrack);

        imageCapture.grabFrame()
            .then(imageBitmap => {
                // Determine source dimensions based on videoPreview's intrinsic size
                const videoIntrinsicWidth = videoPreview.videoWidth;
                const videoIntrinsicHeight = videoPreview.videoHeight;

                // Get current displayed dimensions of videoPreview
                const videoDisplayedWidth = videoPreview.offsetWidth;
                const videoDisplayedHeight = videoPreview.offsetHeight;

                // Calculate scaling factors for crop coordinates from displayed pixels to intrinsic pixels
                const scaleX = videoIntrinsicWidth / videoDisplayedWidth;
                const scaleY = videoIntrinsicHeight / videoDisplayedHeight;

                let finalCropX = cropX * scaleX;
                let finalCropY = cropY * scaleY;
                let finalCropWidth = cropWidth * scaleX;
                let finalCropHeight = cropHeight * scaleY;

                // If no valid crop area is selected, capture the entire stream
                if (cropWidth === 0 || cropHeight === 0) {
                    finalCropX = 0;
                    finalCropY = 0;
                    finalCropWidth = imageBitmap.width;
                    finalCropHeight = imageBitmap.height;
                }

                // Ensure crop dimensions don't exceed imageBitmap boundaries
                finalCropX = Math.max(0, Math.min(finalCropX, imageBitmap.width));
                finalCropY = Math.max(0, Math.min(finalCropY, imageBitmap.height));
                finalCropWidth = Math.max(0, Math.min(finalCropWidth, imageBitmap.width - finalCropX));
                finalCropHeight = Math.max(0, Math.min(finalCropHeight, imageBitmap.height - finalCropY));

                // Create a canvas to draw the cropped image
                const canvas = document.createElement('canvas');
                canvas.width = finalCropWidth; // Set canvas to the cropped dimensions
                canvas.height = finalCropHeight;
                const ctx = canvas.getContext('2d');

                // Draw the *cropped* portion of the imageBitmap onto the canvas
                ctx.drawImage(
                    imageBitmap,
                    finalCropX, finalCropY, finalCropWidth, finalCropHeight, // Source rectangle
                    0, 0, finalCropWidth, finalCropHeight // Destination rectangle
                );

                // Convert canvas content to a Data URL (PNG format)
                const imageDataUrl = canvas.toDataURL('image/png');
                uniqueScreenshotIdCounter++; // Increment for new unique ID
                screenshots.push({ id: uniqueScreenshotIdCounter, dataUrl: imageDataUrl }); // Store as object

                displayAllScreenshots(); // Re-display all screenshots to ensure correct numbering

                showMessage(`Screenshot #${uniqueScreenshotIdCounter} taken at ${Math.round(finalCropWidth)}x${Math.round(finalCropHeight)}px!`, 1500);
                updateButtonStates(true);
            })
            .catch(error => {
                console.error('grabFrame() error: ', error);
                showMessage('Failed to take screenshot. Is screen sharing active?', 3000);
            });
    } else {
        showMessage('No active screen sharing. Please click "Start Screen Capture" first.', 3000);
    }
});

// Stop Capture Button
stopCaptureBtn.addEventListener('click', () => {
    stopCapture();
    showMessage('Screen capture stopped.', 3000);
    screenshotOutputPreviewContainer.classList.add('hidden');
    resetCropArea(); // Also reset crop area and hide overlay when stopping
    selectCropAreaBtn.disabled = true; // Ensure crop button is disabled
});

// Download All as ZIP Button
downloadAllZipBtn.addEventListener('click', async () => {
    if (screenshots.length === 0) {
        showMessage('No screenshots to download!', 3000);
        return;
    }

    showMessage('Preparing ZIP file...', 2000);
    const zip = new JSZip();

    screenshots.forEach((screenshotObj, index) => { // Iterate over screenshot objects
        const base64Data = screenshotObj.dataUrl.split(',')[1];
        zip.file(`screenshot_${screenshotObj.id}.png`, base64Data, { base64: true }); // Use unique ID for filename
    });

    try {
        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'screenshots.zip'; // Name of the downloaded ZIP file
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage(`Downloaded ${screenshots.length} screenshots as ZIP.`, 3000);
    } catch (error) {
        console.error('Error generating ZIP:', error);
        showMessage('Failed to generate ZIP file.', 3000);
    }
});

// Download All as PDF Button
downloadAllPdfBtn.addEventListener('click', async () => {
    if (screenshots.length === 0) {
        showMessage('No screenshots to create PDF from!', 3000);
        return;
    }

    showMessage('Generating PDF document...', 2000);

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        let imagesProcessed = 0;

        for (let i = 0; i < screenshots.length; i++) {
            const screenshotObj = screenshots[i]; // Get screenshot object
            const img = new Image();
            img.src = screenshotObj.dataUrl; // Use dataUrl from object

            await new Promise((resolve) => {
                img.onload = () => {
                    const imgWidth = img.width;
                    const imgHeight = img.height;

                    const pageWidth = doc.internal.pageSize.getWidth() - (2 * pdfImageMargin);
                    const pageHeight = doc.internal.pageSize.getHeight() - (2 * pdfImageMargin);

                    const ratio = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
                    const scaledWidth = imgWidth * ratio;
                    const scaledHeight = imgHeight * ratio;

                    const x = pdfImageMargin + (pageWidth - scaledWidth) / 2;
                    const y = pdfImageMargin + (pageHeight - scaledHeight) / 2;

                    if (imagesProcessed > 0) {
                        doc.addPage();
                    }

                    doc.addImage(screenshotObj.dataUrl, 'PNG', x, y, scaledWidth, scaledHeight);
                    imagesProcessed++;
                    resolve();
                };
                img.onerror = () => {
                    console.error(`Failed to load image for PDF: Screenshot ID ${screenshotObj.id}`);
                    showMessage(`Could not add screenshot ID ${screenshotObj.id} to PDF.`, 3000);
                    resolve();
                };
            });
        }

        doc.save('my_screenshots.pdf');
        showMessage(`Downloaded ${screenshots.length} screenshots as PDF.`, 3000);

    } catch (error) {
        console.error('Error generating PDF:', error);
        showMessage('Failed to generate PDF document. Check console for details.', 5000);
    }
});


// Clear Screenshots Button
clearScreenshotsBtn.addEventListener('click', () => {
    screenshots = []; // Clear the array
    uniqueScreenshotIdCounter = 0; // Reset ID counter
    displayAllScreenshots(); // Re-display (will show placeholder)
    showMessage('All screenshots cleared.', 2000);
});

// --- Helper Functions ---

// Stops the media stream and resets the UI
function stopCapture() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    videoPreview.srcObject = null;
    videoPreview.style.display = 'none';
    updateButtonStates(false);
}

/**
 * Displays a single captured screenshot item in the DOM.
 * @param {object} screenshotObj - Object containing { id: number, dataUrl: string }
 * @param {number} displayIndex - The current 0-based index of this screenshot in the `screenshots` array for display numbering.
 */
function displayScreenshotItem(screenshotObj, displayIndex) {
    const screenshotItem = document.createElement('div');
    screenshotItem.classList.add('screenshot-item');
    // Store the unique ID on the DOM element for easy lookup during removal
    screenshotItem.dataset.screenshotId = screenshotObj.id;
    screenshotItem.dataset.displayIndex = displayIndex; // Store display index for correct removal

    const img = document.createElement('img');
    img.src = screenshotObj.dataUrl;
    img.alt = `Screenshot ${displayIndex + 1}`;
    img.style.maxHeight = '120px';
    img.style.objectFit = 'contain';

    const controlsDiv = document.createElement('div');
    controlsDiv.classList.add('flex', 'gap-2', 'mt-2'); // Tailwind for flexbox with gap

    const downloadLink = document.createElement('a');
    downloadLink.href = screenshotObj.dataUrl;
    downloadLink.download = `screenshot_${screenshotObj.id}.png`; // Use unique ID for download filename
    downloadLink.textContent = 'Download';
    downloadLink.classList.add('download-btn', 'primary-button');

    const removeButton = document.createElement('button');
    removeButton.classList.add('remove-screenshot-btn', 'danger-button', 'px-3', 'py-1', 'text-sm');
    removeButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    `;
    removeButton.title = 'Remove Screenshot';

    removeButton.addEventListener('click', (event) => {
        const itemToRemove = event.target.closest('.screenshot-item');
        if (itemToRemove) {
            const idToRemove = parseInt(itemToRemove.dataset.screenshotId, 10);

            // Find the index of the screenshot object by its unique ID
            const arrayIndexToRemove = screenshots.findIndex(s => s.id === idToRemove);

            if (arrayIndexToRemove !== -1) {
                screenshots.splice(arrayIndexToRemove, 1); // Remove from array
                displayAllScreenshots(); // Re-display all to update numbering and state
                showMessage('Screenshot removed.', 1500);
            } else {
                showMessage('Error: Screenshot not found.', 2000);
            }
            updateButtonStates(mediaStream && mediaStream.active);
        }
    });

    controlsDiv.appendChild(downloadLink);
    controlsDiv.appendChild(removeButton);

    screenshotItem.appendChild(img);
    screenshotItem.appendChild(controlsDiv);
    screenshotsContainer.appendChild(screenshotItem); // Append to keep order consistent
}

/**
 * Clears the current display and re-renders all screenshots from the `screenshots` array.
 * This ensures display numbering and DOM element data attributes are always correct.
 */
function displayAllScreenshots() {
    screenshotsContainer.innerHTML = ''; // Clear existing display
    if (screenshots.length > 0) {
        // Iterate through the array and display each screenshot item
        screenshots.forEach((screenshotObj, index) => {
            displayScreenshotItem(screenshotObj, index);
        });
    } else {
        screenshotsContainer.innerHTML = '<p>No screenshots captured yet. Start sharing your screen to begin!</p>';
    }
}

// Initial button state setup on page load
window.onload = () => {
    updateButtonStates(false);
    updateScreenshotPreview(); // Show initial placeholder
    displayAllScreenshots(); // Initial display of screenshots (will be empty)
};

// ===================================================================
// 0. FIREBASE CONFIGURATION
// ===================================================================
// User's Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyDSRA4RqadqhmHsetr6b71aHR7hgKt-grY",
  authDomain: "sathack-81cd8.firebaseapp.com",
  projectId: "sathack-81cd8",
  storageBucket: "sathack-81cd8.firebasestorage.app",
  messagingSenderId: "430669390630",
  appId: "1:430669390630:web:8ed7489688c0a0c7aa97e7",
  measurementId: "G-QNWF8CN47B"
};

// Initialize Firebase
// These 'firebase' objects are available globally because
// we imported the compat scripts in the index.html
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const participantsCollection = db.collection("participants");

// Simple anonymous auth for the hackathon.
// In a real app, you'd have proper admin/user/guard roles.
firebase.auth().signInAnonymously().catch((error) => {
    console.error("Error signing in anonymously:", error);
});

// ===================================================================
// 1. GLOBAL APP LOGIC (View Switching)
// ===================================================================
const views = document.querySelectorAll('.view');

// We make this function global by attaching it to 'window'
// so that the 'onclick' attributes in the HTML can find it.
window.showView = (viewId) => {
    views.forEach(view => {
        view.classList.add('hidden');
    });
    const activeView = document.getElementById(viewId);
    if (activeView) {
        activeView.classList.remove('hidden');
    }
    
    // Stop scanner if we navigate away from guard view
    if (viewId !== 'guard-view' && window.html5QrcodeScanner) {
        // This function is defined in the Guard View logic section
        stopScanner();
    }
};
// Show admin view by default
showView('home-view');

// ===================================================================
// 2. ADMIN VIEW LOGIC
// =================================S==================================
const createParticipantForm = document.getElementById('create-participant-form');
const adminMessage = document.getElementById('admin-message');

// Check if the form exists before adding listener (prevents errors)
// --- CREATE PARTICIPANT (with Auto-Incrementing Roll Number) ---
if (createParticipantForm) {
    createParticipantForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        adminMessage.innerHTML = "Creating participant...";
        adminMessage.className = "mt-4 text-center text-gray-500";

        // 1. Get all the data from the form
        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const accommodation = document.getElementById('accommodation').value;
        const college = document.getElementById('college').value;
        const collegeId = document.getElementById('college-id').value;

        const allowedLocations = [];
        const photoFile = document.getElementById('photo-upload').files[0];
        if (!photoFile) {
            adminMessage.innerHTML = "Please select a photo for the participant.";
            adminMessage.className = "mt-4 text-center text-red-600";
            return;
        }
        document.querySelectorAll('.allowed-location:checked').forEach(checkbox => {
            allowedLocations.push(checkbox.value);
        });

        // 2. Define the counter document
        const counterRef = db.collection('metadata').doc('counters');

        try {
            // 3. Run a Firestore Transaction (this is the magic!)
            const photoBase64 = await resizeAndEncodeImage(photoFile);
            const newRollNumber = await db.runTransaction(async (transaction) => {
                const counterDoc = await transaction.get(counterRef);

                let currentCount = 0;
                if (counterDoc.exists && counterDoc.data().participantCount) {
                    currentCount = counterDoc.data().participantCount;
                }

                // 4. Increment the count and format the new ID
                const newCount = currentCount + 1;
                // This formats "9" as "009", "10" as "010", etc.
                const newRollNumberString = `EVT-${String(newCount).padStart(3, '0')}`;

                // 5. Set up the new participant's data
                const newParticipantRef = participantsCollection.doc(newRollNumberString);
                const newParticipantData = {
                    name: name,
                    email: email,
                    accommodation: accommodation,
                    allowedLocations: allowedLocations,
                    college: college,
                    collegeId: collegeId,
                    eventRollNumber: newRollNumberString, // The new ID
                    currentLocation: "Campus",
                    photoBase64: photoBase64,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                // 6. Commit the changes (set participant, update counter)
                transaction.set(newParticipantRef, newParticipantData);
                transaction.update(counterRef, { participantCount: newCount });

                // 7. Return the new roll number to use in the success message
                return newRollNumberString;
            });

            // 8. Handle Success
            const participantEmail = email;
            const subject = "Your Event QR ID";
            const body = `Hi ${name},\n\nWelcome to the event! Here is your unique participant ID.\n\nYour Event Roll Number: ${newRollNumber}\n\nUse this roll number in the "Participant View" of the app to get your QR code.`;
            const mailtoLink = `mailto:${participantEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

            adminMessage.innerHTML = `Success! Participant created. ID: ${newRollNumber}<br>
                <a href="${mailtoLink}" target="_blank" class="text-blue-600 hover:underline">
                    Click here to email ID to ${name}
                </a>`;
            adminMessage.className = "mt-4 text-center text-green-600";
            createParticipantForm.reset();

            navigator.clipboard.writeText(newRollNumber).then(() => {
                adminMessage.innerHTML = `Success! Participant created. ID: ${newRollNumber} (Copied!)<br>
                    <a href="${mailtoLink}" target="_blank" class="text-blue-600 hover:underline">
                        Click here to email ID to ${name}
                    </a>`;
            });

        } catch (error) {
            console.error("Error creating participant:", error);
            adminMessage.innerHTML = "Error: Could not create participant. Check console.";
            adminMessage.className = "mt-4 text-center text-red-600";
        }
    });
}

// --- Admin Dashboard (Real-time) ---
const statTotal = document.getElementById('stat-total');
const statAccommodation = document.getElementById('stat-accommodation');
const statCampus = document.getElementById('stat-campus');
const statEventX = document.getElementById('stat-event-x');

// This is the "magic" for the hackathon!
// onSnapshot listens for ANY change in the participants collection.
participantsCollection.onSnapshot(snapshot => {
    let total = 0;
    let accommodation = 0;
    let campus = 0;
    let eventX = 0;

    snapshot.forEach(doc => {
        total++;
        const location = doc.data().currentLocation;
        if (location === "Accommodation") {
            accommodation++;
        } else if (location === "Campus") {
            campus++;
        } else if (location === "Event X") {
            eventX++;
        }
    });

    // Update the dashboard UI in real-time
    // We check if these elements exist in case one view is removed
    if (statTotal) statTotal.textContent = total;
    if (statAccommodation) statAccommodation.textContent = accommodation;
    if (statCampus) statCampus.textContent = campus;
    if (statEventX) statEventX.textContent = eventX;

}, error => {
    console.error("Error with dashboard snapshot: ", error);
});

// --- Admin Participant List (Real-time & Searchable) ---
const searchBar = document.getElementById('search-bar');
const participantListBody = document.getElementById('participant-list-body');
let allParticipants = []; // We will store a local copy for fast searching

// Function to render the list in the HTML table
function renderParticipantList(participants) {
    if (!participantListBody) return; // safety check

    participantListBody.innerHTML = ''; // Clear the table

    if (participants.length === 0) {
        participantListBody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-gray-500">No participants found.</td></tr>';
        return;
    }

    participants.forEach(participant => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm font-medium text-gray-900">${participant.name}</div>
                <div class="text-sm text-gray-500">${participant.email}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${participant.eventRollNumber}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${participant.college}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    participant.currentLocation === 'Accommodation' ? 'bg-blue-100 text-blue-800' :
                    participant.currentLocation === 'Campus' ? 'bg-green-100 text-green-800' :
                    participant.currentLocation === 'Event X' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                }">
                    ${participant.currentLocation}
                </span>
            </td>
        `;
        participantListBody.appendChild(tr);
    });
}

// NEW Snapshot listener. This one gets *all* data for the list.
participantsCollection.onSnapshot(snapshot => {
    allParticipants = []; // Reset the local array
    snapshot.forEach(doc => {
        allParticipants.push(doc.data());
    });

    // Render the list with the current search term (if any)
    const searchTerm = searchBar.value.toLowerCase();
    const filteredList = allParticipants.filter(p => 
        p.name.toLowerCase().includes(searchTerm) ||
        p.eventRollNumber.toLowerCase().includes(searchTerm) ||
        p.college.toLowerCase().includes(searchTerm)
    );
    renderParticipantList(filteredList);

}, error => {
    console.error("Error with participant list snapshot: ", error);
    participantListBody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-red-500">Error loading data.</td></tr>';
});

// Add listener for the search bar
if (searchBar) {
    searchBar.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredList = allParticipants.filter(p => 
            p.name.toLowerCase().includes(searchTerm) ||
            p.eventRollNumber.toLowerCase().includes(searchTerm) ||
            p.college.toLowerCase().includes(searchTerm)
        );
        renderParticipantList(filteredList);
    });
}

// --- 3. PARTICIPANT VIEW LOGIC ---

// Get references to all elements in this view
const loadParticipantBtn = document.getElementById('load-participant-btn');
const participantIdInput = document.getElementById('participant-id-input');
const participantDetailsSection = document.getElementById('participant-details-section'); // <-- Note the name change
const qrcodeDisplay = document.getElementById('qrcode-display');

// We use 'let' because these will change
let qrcode = null; 
let participantUnsub = null; // To stop the real-time listener
if (loadParticipantBtn) {
    loadParticipantBtn.addEventListener('click', async () => {
        const participantId = participantIdInput.value.trim();
        if (!participantId) {
            alert("Please enter a participant ID.");
            return;
        }

        // 1. Clear old data
        participantDetailsSection.classList.add('hidden');
        qrcodeDisplay.innerHTML = '';
        // Stop any previous real-time listener
        if (participantUnsub) {
            participantUnsub();
            participantUnsub = null;
        }

        try {
            // 2. Get the participant's document
            const doc = await participantsCollection.doc(participantId).get();

            if (doc.exists) {
                // 3. THIS IS THE LINE THAT WAS MISSING
                // We must define 'data' *before* we can use it.
                const data = doc.data(); 

                // 4. Fill in all the HTML elements
                document.getElementById('participant-name-display').textContent = data.name;
                document.getElementById('participant-email').textContent = data.email;
                document.getElementById('participant-accommodation').textContent = data.accommodation;
                document.getElementById('participant-roll-number').textContent = data.eventRollNumber;
                document.getElementById('participant-college').textContent = data.college;
                document.getElementById('participant-college-id').textContent = data.collegeId;

                // 5. THIS IS THE NEW PHOTO CODE, NOW IN THE CORRECT PLACE
                const photoEl = document.getElementById('participant-photo');
                if (data.photoBase64) {
                    photoEl.src = data.photoBase64;
                    photoEl.classList.remove('hidden');
                } else {
                    // Hide the image element if there is no photo
                    photoEl.src = "httpsimg"; 
                    photoEl.classList.add('hidden'); 
                }

                // 6. Generate the QR Code
                if (qrcode) {
                    qrcode.clear(); // Clear old QR code
                } else {
                    qrcode = new QRCode(qrcodeDisplay, {
                        text: participantId,
                        width: 200,
                        height: 200,
                    });
                }
                qrcode.makeCode(participantId); // Generate new one

                // 7. Start a NEW real-time listener for just this participant's status
                participantUnsub = participantsCollection.doc(participantId).onSnapshot(doc => {
                    if (doc.exists) {
                        // We define 'data' again *inside* the listener
                        // to get the most up-to-date information
                        const data = doc.data(); 
                        document.getElementById('participant-status').textContent = data.currentLocation;
                    }
                });

                // 8. Show the details section
                participantDetailsSection.classList.remove('hidden');

            } else {
                // Document not found
                console.error("No such document!");
                alert("Participant not found!");
            }
        } catch (error) {
            console.error("Error getting document:", error);
            alert("Error loading participant. Check console.");
        }
    });
}

// ===================================================================
// 4. GUARD VIEW LOGIC
// ===================================================================
const guardLocationSelect = document.getElementById('guard-location');
const scannerMessageContainer = document.getElementById('scanner-message-container');
const scannerMessage = document.getElementById('scanner-message');
const scanResultTitle = document.getElementById('scan-result-title');
const scanResultName = document.getElementById('scan-result-name');
const scanResultDetails = document.getElementById('scan-result-details');
const startScanBtn = document.getElementById('start-scan-btn');

// Make scanner global to be accessible by showView and other functions
window.html5QrcodeScanner = null;

// --- On Scan Success ---
async function onScanSuccess(decodedText, decodedResult) {
    // decodedText is the eventRollNumber (e.g., "EVT-001")
    const participantId = decodedText;

    // Stop the camera
    try {
        html5QrcodeScanner.pause(true); // 'true' keeps the video feed on
    } catch (error) {
        console.warn("Scanner pause failed (this is often OK):", error);
    }

    // 1. Get references to all the new HTML elements
    const guardCard = document.getElementById('guard-verification-card');
    const verifyPhoto = document.getElementById('guard-verify-photo');
    const verifyName = document.getElementById('guard-verify-name');
    const verifyCollege = document.getElementById('guard-verify-college');
    const verifyRoll = document.getElementById('guard-verify-roll');
    const permissionDiv = document.getElementById('guard-verify-permission');
    const permissionText = permissionDiv.querySelector('p');
    const confirmBtn = document.getElementById('guard-confirm-btn');
    const cancelBtn = document.getElementById('guard-cancel-btn');

    // Get the guard's current location
    const guardLocation = document.getElementById('guard-location').value;

    try {
        // 2. Fetch the participant's data from Firestore
        const doc = await participantsCollection.doc(participantId).get();
        if (!doc.exists) {
            // Handle case where QR code is invalid
            permissionText.textContent = "INVALID QR CODE";
            permissionDiv.className = "p-4 rounded-lg text-center bg-red-100 text-red-800";
            verifyName.textContent = "Unknown Participant";
            verifyCollege.textContent = "N/A";
            verifyRoll.textContent = "N/A";
            verifyPhoto.src = "httpsimg";
            confirmBtn.classList.add('hidden');
            guardCard.classList.remove('hidden');
            return;
        }

        const data = doc.data();

        // 3. Fill in the verification card
        verifyName.textContent = data.name;
        verifyCollege.textContent = data.college;
        verifyRoll.textContent = data.eventRollNumber;

        // Set photo from Base64 string
        if (data.photoBase64) {
            verifyPhoto.src = data.photoBase64;
        } else {
            verifyPhoto.src = "httpsimg"; // A fallback
        }

        // 4. Check their permission for THIS location
        if (data.allowedLocations && data.allowedLocations.includes(guardLocation)) {
            // ALLOWED
            permissionText.textContent = `ALLOWED for ${guardLocation}`;
            permissionDiv.className = "p-4 rounded-lg text-center bg-green-100 text-green-800";
            confirmBtn.classList.remove('hidden'); // Show the confirm button

            // Set up the confirm button's logic
            confirmBtn.onclick = async () => {
                adminMessage.innerHTML = "Updating status..."; // Use admin message for temp status
                adminMessage.className = "mt-4 text-center text-gray-500";

                await participantsCollection.doc(participantId).update({
                    currentLocation: guardLocation
                });

                // Hide card and restart scanner
                guardCard.classList.add('hidden');
                // Try to resume the scanner
                try {
                    html5QrcodeScanner.resume();
                } catch (error) {
                    console.warn("Scanner resume failed (this is often OK):", error);
                    // If resume fails, it's likely already scanning. We'll restart it
                    // by clicking the "Start Scan" button code's logic.
                    if (startScanBtn) startScanBtn.classList.remove('hidden');
                }
                adminMessage.innerHTML = `Success: ${data.name} updated to ${guardLocation}`;
                adminMessage.className = "mt-4 text-center text-green-600";
                setTimeout(() => { adminMessage.innerHTML = ""; }, 3000);
            };

        } else {
            // DENIED
            permissionText.textContent = `DENIED for ${guardLocation}`;
            permissionDiv.className = "p-4 rounded-lg text-center bg-red-100 text-red-800";
            confirmBtn.classList.add('hidden'); // Hide confirm button
        }

        // 5. Show the card and set up the cancel button
        guardCard.classList.remove('hidden');
        cancelBtn.onclick = () => {
            guardCard.classList.add('hidden');
            // Try to resume the scanner
            try {
                html5QrcodeScanner.resume(); // Restart the scanner
            } catch (error) {
                console.warn("Scanner resume failed (this is often OK):", error);
                // If resume fails, it's likely already scanning. We'll restart it
                // by clicking the "Start Scan" button code's logic.
                if (startScanBtn) startScanBtn.classList.remove('hidden');
            }
        };

    } catch (error) {
        console.error("Error verifying participant:", error);
        // Handle other errors (e.g., no internet)
        guardCard.classList.add('hidden');
        html5QrcodeScanner.resume();
        adminMessage.innerHTML = "Error: Could not verify. Check console.";
        adminMessage.className = "mt-4 text-center text-red-600";
        setTimeout(() => { adminMessage.innerHTML = ""; }, 3000);
    }
}

// --- On Scan Failure ---
function onScanFailure(error) {
    // This is called every frame, keep it quiet
}

// --- Helper to show scan result ---
function showScannerMessage(title, name, details, type) {
    scanResultTitle.textContent = title;
    scanResultName.textContent = name;
    scanResultDetails.textContent = details;
    
    scannerMessage.className = (type === 'success') ? 'p-6 rounded-lg text-center message-success' : 'p-6 rounded-lg text-center message-error';
    scannerMessageContainer.classList.remove('hidden');

    // Hide the message after 5 seconds
    setTimeout(() => {
        if (scannerMessageContainer) {
            scannerMessageContainer.classList.add('hidden');
        }
    }, 5000);
}

// --- Start/Stop Scanner ---
// Make stopScanner global for showView to access
window.stopScanner = () => {
    if (window.html5QrcodeScanner) {
        try {
            // This is the safest way. Try to stop, log if it fails.
            window.html5QrcodeScanner.stop();
            console.log("Scanner stopped.");
        } catch (err) {
            // This will error if it's already stopped. That's fine.
            console.warn("Scanner stop() failed (this is often OK):", err);
        } finally {
            // Always clear the UI and reset the button
            if(window.html5QrcodeScanner && typeof window.html5QrcodeScanner.clear === 'function') {
                window.html5QrcodeScanner.clear();
            }
            window.html5QrcodeScanner = null;
            if (startScanBtn) {
                startScanBtn.classList.remove('hidden');
            }
        }
    }
}

if (startScanBtn) {
    startScanBtn.addEventListener('click', () => {
        // Html5QrcodeScanner is available globally from the script in index.html
        if (!window.html5QrcodeScanner) {
            window.html5QrcodeScanner = new Html5QrcodeScanner(
                "qr-reader", 
                { fps: 10, qrbox: { width: 250, height: 250 } },
                /* verbose= */ false);
        }
        window.html5QrcodeScanner.render(onScanSuccess, onScanFailure);
        startScanBtn.classList.add('hidden');
        console.log("Scanner started.");
    });
}

// --- BASE64 WORKAROUND ---
// Helper function to resize an image and convert it to a Base64 string
function resizeAndEncodeImage(file, maxWidth = 300, maxHeight = 300) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Get the data URL (Base64 string)
                resolve(canvas.toDataURL('image/jpeg', 0.8)); // 80% quality
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
// --- END OF BASE64 WORKAROUND ---
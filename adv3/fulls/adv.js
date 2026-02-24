
    // Firebase configuration
    const firebaseConfig = {
  apiKey: "AIzaSyAH-6VEsx8Jp2KVeltSlvBFU1nn6M-2r1w",
  authDomain: "adbot-s4.firebaseapp.com",
  projectId: "adbot-s4",
  storageBucket: "adbot-s4.firebasestorage.app",
  messagingSenderId: "422990164333",
  appId: "1:422990164333:web:34c170382c4a87915f2a64"
};


    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    
    // Collection names
    const USERS_COLLECTION = "adv2_users";
    const WITHDRAWALS_COLLECTION = "adv2_withdrawals";
    const ADMIN_SETTINGS_DOC_ID = "_admin_settings_";
    
    // User data
    let userData = {
        id: "",
        name: "",
        username: "",
        balance: 0.00,
        spinKeys: 0,
        totalEarnings: 0.00,
        adsWatched: 0,
        completedTasks: 0,
        totalTasks: 1000,
        paypal: "",
        payoneer: "",
        bkash: "",
        lastResetDate: new Date().toISOString().slice(0, 10),
        telegramDetected: false,
        source: "web",
        country: "",
        profilePhoto: null,
        totalWithdrawn: 0.00,
        withdrawalCount: 0,
        referrals: 0,
        joinDate: new Date().toISOString(),
        lastNotificationCheck: new Date(0).toISOString(),
        paymentInfo: {} // For dynamic payment methods
    };

    // Admin settings with extended features
    let adminSettings = {
        // Original settings
        maintenanceMode: false,
        autoApprove: false,
        enablePenalty: true,
        minWithdrawal: 100,
        earningsPerAd: 0.05,
        dailyTasks: 1000,
        adDuration: 15,
        penaltyDuration: 2,
        lastUpdated: new Date().toISOString(),
        
        // Added features
        paymentMethods: [], // [{id, name, type}]
        marqueeSettings: { default: "Welcome to AdVault!" },
        adServices: [],
        popunder: { code: '', active: false },
        socialBar: { code: '', active: false } // [{id, type, name, code, active, reward}]
    };

    // App state
    let userCountry = "BD";
    let penaltyActive = false;
    let penaltyEndTime = 0;
    let penaltyInterval = null;
    let adStartTime = 0;
    let adTimerInterval = null;
    let maintenanceMode = false;
    let maintenanceStartTime = null;
    let adInterval = null; // For extra ad popup
    
    // New Withdraw State
    let currentWithdrawMethod = null;

    // ===================== FIREBASE FUNCTIONS =====================
    
    async function saveUserData() {
        // --- GUARD: BLOCK SAVING IF NOT TELEGRAM ---
        if (!userData.telegramDetected) {
            console.log("Guest/Web Mode: Firestore saving disabled.");
            return false;
        }

        try {
            userData.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
            const userId = userData.id || userData.username;
            await db.collection(USERS_COLLECTION).doc(userId).set(userData, { merge: true });
            console.log("User data saved to Firestore");
            return true;
        } catch (error) {
            console.error("Error saving user data:", error);
            // Only show notification if it was a real attempt (Telegram user)
            if (userData.telegramDetected) {
                showTopNotification("Failed to save data. Please try again.");
            }
            return false;
        }
    }
    
    async function loadUserData(userId) {
        try {
            const doc = await db.collection(USERS_COLLECTION).doc(userId).get();
            
            if (doc.exists) {
                // 1. Load existing data
                const data = doc.data();
                userData = { ...userData, ...data };

                // Apply Admin Limits
                userData.totalTasks = adminSettings.dailyTasks || 1000;
                
                // Ensure objects exist
                if (!userData.paymentInfo) userData.paymentInfo = {};
                if (!userData.referrals) userData.referrals = 0;
                if (!userData.totalWithdrawn) userData.totalWithdrawn = 0;
                
                // --- FIX START: COLLECT MISSING DATES ---
                
                let updates = {};
                
                updates.lastUpdated = new Date().toISOString(); 
    
    // Backfill join date if missing
    if (!userData.joinDate) {
        userData.joinDate = new Date().toISOString();
        updates.joinDate = userData.joinDate;
    }

    db.collection(USERS_COLLECTION).doc(userId).set(updates, { merge: true });
                
                // --- FIX END ---

                console.log("User data loaded and status updated");
                return true;
            } else {
                // 2. New User Setup
                userData.id = userId;
                userData.totalTasks = adminSettings.dailyTasks || 1000;
                userData.paymentInfo = {};
                
                // Set Creation Date for new user
                userData.joinDate = new Date().toISOString();
                
                console.log("Creating new user in Firestore");
                await saveUserData(); // This function already saves serverTimestamp
                return false;
            }
        } catch (error) {
            console.error("Error loading user data:", error);
            showTopNotification("Failed to load data. Please try again.");
            return false;
        } finally {
            document.getElementById("firebaseLoading").style.display = "none";
        }
    }
    
    async function loadAdminSettings() {
        try {
            const doc = await db.collection(USERS_COLLECTION).doc(ADMIN_SETTINGS_DOC_ID).get();
            if (doc.exists) {
                const data = doc.data();
                adminSettings = { ...adminSettings, ...data };
                
                // Update maintenance mode
                maintenanceMode = adminSettings.maintenanceMode || false;
                if (maintenanceMode) {
                    maintenanceStartTime = adminSettings.lastUpdated || new Date().toISOString();
                    showMaintenancePopup();
                }
                
                console.log("Admin settings loaded:", adminSettings);
                
                // Apply admin settings to UI
                applyAdminSettings();
                
                return true;
            } else {
                console.log("No admin settings found, using defaults.");
                return false;
            }
        } catch (error) {
            console.error("Error loading admin settings:", error);
            return false;
        }
    }
    
    function setupAdminSettingsListener() {
        db.collection(USERS_COLLECTION).doc(ADMIN_SETTINGS_DOC_ID)
            .onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    adminSettings = { ...adminSettings, ...data };
                    
                    console.log("Admin settings updated in real-time:", adminSettings);
                    
                    // Update maintenance mode
                    const wasInMaintenance = maintenanceMode;
                    maintenanceMode = adminSettings.maintenanceMode || false;
                    
                    if (maintenanceMode && !wasInMaintenance) {
                        maintenanceStartTime = adminSettings.lastUpdated || new Date().toISOString();
                        showMaintenancePopup();
                    } else if (!maintenanceMode && wasInMaintenance) {
                        hideMaintenancePopup();
                    }
                    
                    // Apply updated settings
                    applyAdminSettings();
                    
                    if (userData.telegramDetected) {
                        showTopNotification("App settings have been updated", 3000);
                    }
                }
            }, (error) => {
                console.error("Error listening to admin settings:", error);
            });
    }

    // Function to inject Popunder & Social Bar scripts safely
    function injectPassiveAds() {
        // 1. Handle Popunder
        if (adminSettings.popunder && adminSettings.popunder.active && adminSettings.popunder.code) {
            if (!document.getElementById('ad-script-popunder')) {
                console.log("Injecting Popunder...");
                const div = document.createElement('div');
                div.id = 'ad-script-popunder';
                div.style.display = 'none';
                document.body.appendChild(div);

                const range = document.createRange();
                range.selectNode(document.body);
                const fragment = range.createContextualFragment(adminSettings.popunder.code);
                div.appendChild(fragment);
            }
        }

        // 2. Handle Social Bar
        if (adminSettings.socialBar && adminSettings.socialBar.active && adminSettings.socialBar.code) {
            if (!document.getElementById('ad-script-socialbar')) {
                console.log("Injecting Social Bar...");
                const div = document.createElement('div');
                div.id = 'ad-script-socialbar';
                div.style.display = 'none';
                document.body.appendChild(div);

                const range = document.createRange();
                range.selectNode(document.body);
                const fragment = range.createContextualFragment(adminSettings.socialBar.code);
                div.appendChild(fragment);
            }
        }
    }
    
    function applyAdminSettings() {
        userData.totalTasks = adminSettings.dailyTasks || 1000;
        
        if (document.getElementById('earn-total')) {
            document.getElementById('earn-total').textContent = adminSettings.dailyTasks || 1000;
        }
        
        if (document.getElementById('earningsPerAdDisplay')) {
            document.getElementById('earningsPerAdDisplay').textContent = (adminSettings.earningsPerAd || 0.05).toFixed(2);
        }
        if (document.getElementById('libtlRewardDisplay')) {
            document.getElementById('libtlRewardDisplay').textContent = (adminSettings.earningsPerAd || 0.05).toFixed(2);
        }
        if (document.getElementById('adDurationDisplay')) {
            document.getElementById('adDurationDisplay').textContent = adminSettings.adDuration || 15;
        }
        
        if (document.getElementById('penaltyAdDuration')) {
            document.getElementById('penaltyAdDuration').textContent = adminSettings.adDuration || 15;
        }
        
        if (document.getElementById('penaltyDurationDisplay')) {
            document.getElementById('penaltyDurationDisplay').textContent = adminSettings.penaltyDuration || 2;
        }
        
        if (document.getElementById('new-amountInput')) {
            document.getElementById('new-amountInput').min = adminSettings.minWithdrawal || 100;
            document.getElementById('new-amountInput').placeholder = `Min ${adminSettings.minWithdrawal || 100} BDT`;
        }
        
        // Update instructions popup
        if (document.getElementById('instructionAdDuration')) {
            document.getElementById('instructionAdDuration').textContent = adminSettings.adDuration || 15;
        }
        
        if (document.getElementById('instructionEarningsPerAd')) {
            document.getElementById('instructionEarningsPerAd').textContent = (adminSettings.earningsPerAd || 0.05).toFixed(2);
        }
        
        if (document.getElementById('instructionPenaltyDuration')) {
            document.getElementById('instructionPenaltyDuration').textContent = adminSettings.penaltyDuration || 2;
        }
        
        if (document.getElementById('instructionMinWithdrawal')) {
            document.getElementById('instructionMinWithdrawal').textContent = adminSettings.minWithdrawal || 100;
        }

        // System Info Updates
        if (document.getElementById('appLastUpdated')) {
            if (adminSettings.lastUpdated) {
                const dateObj = new Date(adminSettings.lastUpdated);
                const formattedDate = dateObj.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                });
                document.getElementById('appLastUpdated').textContent = formattedDate;
            } else {
                document.getElementById('appLastUpdated').textContent = "Not Available";
            }
        }
        if (document.getElementById('displayVersion')) {
            document.getElementById('displayVersion').textContent = adminSettings.appVersion || '2.1.1';
        }
        
        if (document.getElementById('displayBuildNumber')) {
            document.getElementById('displayBuildNumber').textContent = adminSettings.buildNumber || 'AV20250902';
        }
   
        // Render dynamic features
        renderMarquee();
        renderDynamicPaymentUI();
        renderProfilePaymentMethods();
        renderNewPaymentGrid();
        
        // Inject Passive Ads (Popunder/Social Bar)
        injectPassiveAds();
        
        renderExtraAds();
        // Determine which section is currently active on load
        const activeSectionEl = document.querySelector('.section.active, .section-fullscreen.active');
        const currentSectionId = activeSectionEl ? activeSectionEl.id : 'home-section';
        renderBannerAds(currentSectionId);
        updateUI();
    }
    
    function showMaintenancePopup() {
        const popup = document.getElementById('maintenancePopup');
        if (popup) {
            // Updated to remove dependency on maintenanceTime element
            popup.style.display = 'flex';
            
            // Disable interactions
            document.querySelectorAll('button, input, select').forEach(el => {
                // Allow the new refresh button to work (it has class 'refresh-btn')
                if (!el.classList.contains('refresh-btn')) {
                    el.disabled = true;
                }
            });
        }
    }
    
    function hideMaintenancePopup() {
        const popup = document.getElementById('maintenancePopup');
        if (popup) {
            popup.style.display = 'none';
            
            document.querySelectorAll('button, input, select').forEach(el => {
                el.disabled = false;
            });
            
            showTopNotification("App is back online!", 3000);
        }
    }
    
    async function saveWithdrawalRequest(amount, method, address) {
        // --- GUARD: BLOCK WITHDRAWAL IF NOT TELEGRAM ---
        if (!userData.telegramDetected) {
            showTopNotification("Withdrawals are only available in Telegram.");
            return false;
        }

        try {
            const withdrawalData = {
                userId: userData.id || userData.username,
                username: userData.username,
                amount: amount,
                method: method,
                address: address,
                timestamp: new Date().toISOString(),
                status: "pending"
            };

            await db.collection(WITHDRAWALS_COLLECTION).add(withdrawalData);
            console.log("Withdrawal request saved successfully");
            return true;
        } catch (error) {
            console.error("Error saving withdrawal request:", error);
            return false;
        }
    }

 

    // Global history array (used for mini-lists elsewhere)
    let globalWithdrawalHistory = [];

    async function fetchWithdrawalHistory() {
        const userId = userData.id || userData.username;
        const container = document.getElementById("withdrawalHistoryList");
        
        if (!container) return;

        try {
            // Loading State
            container.innerHTML = `
                <div class="text-center py-20 opacity-50">
                    <div class="spinner border-gray-400 mx-auto mb-4"></div>
                    <p class="text-sm text-gray-500">Loading history...</p>
                </div>`;

            const querySnapshot = await db.collection(WITHDRAWALS_COLLECTION)
                .where("userId", "==", userId)
                .orderBy("timestamp", "desc")
                .get();

            globalWithdrawalHistory = []; // Reset global data
            container.innerHTML = "";     // Clear loading

            if (querySnapshot.empty) {
                container.innerHTML = `
                    <div class="text-center py-20 opacity-50">
                        <i class="fas fa-receipt text-4xl mb-4 text-gray-300"></i>
                        <p class="text-gray-500">No transactions found</p>
                    </div>`;
                
                // Update mini-list on Withdraw page if needed
                if(typeof renderMiniHistory === 'function') renderMiniHistory();
                return;
            }

            let currentDateLabel = "";

            querySnapshot.forEach((doc) => {
                const data = doc.data();
                
                // 1. Save to Global (for mini lists)
                globalWithdrawalHistory.push({
                    amount: data.amount,
                    method: data.method,
                    status: data.status,
                    date: data.timestamp
                });

                // 2. Date Grouping Logic
                const dateObj = new Date(data.timestamp);
                const today = new Date();
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);

                let dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                
                if (dateObj.toDateString() === today.toDateString()) {
                    dateStr = "Today";
                } else if (dateObj.toDateString() === yesterday.toDateString()) {
                    dateStr = "Yesterday";
                }

                // Insert Date Header if it changes
                if (dateStr !== currentDateLabel) {
                    currentDateLabel = dateStr;
                    container.innerHTML += `<div class="date-label">${dateStr}</div>`;
                }

                // 3. Determine Styles
                let iconClass = "icon-default";
                let iconName = "fa-university";
                const method = (data.method || "").toLowerCase();

                if (method.includes("bkash")) { iconClass = "icon-bkash"; iconName = "fa-mobile-alt"; }
                else if (method.includes("nagad")) { iconClass = "icon-nagad"; iconName = "fa-wallet"; }
                else if (method.includes("rocket")) { iconClass = "icon-rocket"; iconName = "fa-rocket"; }
                else if (method.includes("paypal")) { iconClass = "icon-paypal"; iconName = "fa-paypal"; }

                let statusClass = "status-pending";
                let statusText = "Pending";
                if (data.status === "approved" || data.status === "completed") {
                    statusClass = "status-success";
                    statusText = "Sent";
                } else if (data.status === "rejected") {
                    statusClass = "status-failed";
                    statusText = "Failed";
                }

                const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

                // 4. Create Card HTML
                container.innerHTML += `
                    <div class="txn-card">
                      <div class="txn-left">
                        <div class="txn-icon ${iconClass}">
                          <i class="${method.includes('paypal') ? 'fab' : 'fas'} ${iconName}"></i>
                        </div>
                        <div class="txn-details">
                          <span class="txn-title capitalize">${data.method}</span>
                          <span class="txn-meta">${timeStr}</span>
                        </div>
                      </div>
                      <div class="txn-right">
                        <div class="txn-amount amount-neg">-${data.amount.toFixed(2)}</div>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                      </div>
                    </div>`;
            });

            // Update mini-list on Withdraw page
            if(typeof renderMiniHistory === 'function') renderMiniHistory();

        } catch (error) {
            console.error("Error fetching history:", error);
            container.innerHTML = `<p class="text-center text-red-500 py-10">Error loading data.</p>`;
        }
    }
    // ===================== ADDED FEATURES =====================
    
    function renderMarquee() {
    // 1. Get the text
    const text = adminSettings.marqueeSettings?.[userCountry] || 
                 adminSettings.marqueeSettings?.['default'] || 
                 "Welcome to AdVault! Start earning today.";

    // 2. Target the Home Ticker
    const homeTicker = document.getElementById('marqueeTextHome');
    if (homeTicker) {
        homeTicker.textContent = text;

        // --- DYNAMIC SPEED CALCULATION ---
        // Formula: Base time (10s) + 0.3 seconds per character
        // Short text (20 chars): 10 + 6 = 16s
        // Long text (100 chars): 10 + 30 = 40s
        const charCount = text.length;
        const dynamicDuration = 10 + (charCount * 0.3);
        
        homeTicker.style.animationDuration = `${dynamicDuration}s`;
    }

    // 3. Target the Old Marquee (if exists)
    const oldMarquee = document.getElementById('marqueeText');
    if (oldMarquee) {
        oldMarquee.textContent = text;
        const dynamicDuration = 10 + (text.length * 0.3);
        oldMarquee.style.animationDuration = `${dynamicDuration}s`;
    }
}
    function renderDynamicPaymentUI() {
        // 1. Profile Display
        const displayContainer = document.getElementById('dynamicPaymentDetailsDisplay');
        if (displayContainer) {
            displayContainer.innerHTML = '';
            
            if (adminSettings.paymentMethods && adminSettings.paymentMethods.length > 0) {
                adminSettings.paymentMethods.forEach(method => {
                    const val = userData.paymentInfo[method.id] || 'Not Set';
                    const div = document.createElement('p');
                    div.innerHTML = `<span class="font-bold">${method.name}:</span> <span class="${val === 'Not Set' ? 'text-red-500' : 'text-gray-900'}">${val}</span>`;
                    displayContainer.appendChild(div);
                });
            } else {
                displayContainer.innerHTML = `
                    <p><span class="font-bold">PayPal:</span> <span class="${!userData.paypal ? 'text-red-500' : 'text-gray-900'}">${userData.paypal || 'Not set'}</span></p>
                    <p><span class="font-bold">Payoneer:</span> <span class="${!userData.payoneer ? 'text-red-500' : 'text-gray-900'}">${userData.payoneer || 'Not set'}</span></p>
                    <p><span class="font-bold">bKash:</span> <span class="${!userData.bkash ? 'text-red-500' : 'text-gray-900'}">${userData.bkash || 'Not set'}</span></p>
                `;
            }
        }

        // 2. Dynamic Edit Modal Form
        const formContainer = document.getElementById('dynamicPaymentForm');
        if (formContainer) {
            formContainer.innerHTML = '';
            
            if (adminSettings.paymentMethods && adminSettings.paymentMethods.length > 0) {
                adminSettings.paymentMethods.forEach(method => {
                    const wrapper = document.createElement('div');
                    const type = method.type === 'number' ? 'number' : (method.type === 'email' ? 'email' : 'text');
                    wrapper.innerHTML = `
                        <label class="payment-label">${method.name}</label>
                        <input type="${type}" data-id="${method.id}" value="${userData.paymentInfo[method.id] || ''}" class="payment-input" placeholder="Enter ${method.name}">
                    `;
                    formContainer.appendChild(wrapper);
                });
            } else {
                formContainer.innerHTML = `
                    <div>
                        <label class="payment-label">PayPal Email</label>
                        <input type="email" data-id="paypal" value="${userData.paypal || ''}" class="payment-input" placeholder="Enter PayPal email">
                    </div>
                    <div>
                        <label class="payment-label">Payoneer Email</label>
                        <input type="email" data-id="payoneer" value="${userData.payoneer || ''}" class="payment-input" placeholder="Enter Payoneer email">
                    </div>
                    <div>
                        <label class="payment-label">bKash Number</label>
                        <input type="text" data-id="bkash" value="${userData.bkash || ''}" class="payment-input" placeholder="Enter bKash number">
                    </div>
                `;
            }
        }

        // 3. Update profile payment methods
        renderProfilePaymentMethods();
        // 4. Update withdrawal payment methods
        renderNewPaymentGrid();
    }
    
    // Render profile payment methods
   // Render profile payment methods (Updated for New Profile Menu)
    function renderProfilePaymentMethods() {
        // Target the status text in the new menu item
        const statusText = document.getElementById('paymentMethodStatus');
        if (!statusText) return;

        // Count linked methods
        let linkedCount = 0;
        if (userData.paymentInfo) {
            linkedCount = Object.keys(userData.paymentInfo).length;
            
            // Fallback: check for old data fields if paymentInfo is empty
            if (linkedCount === 0) {
                if (userData.bkash) linkedCount++;
                if (userData.paypal) linkedCount++;
                if (userData.payoneer) linkedCount++;
            }
        }

        // Update the text in the menu button
        if (linkedCount > 0) {
            statusText.textContent = `${linkedCount} Account${linkedCount > 1 ? 's' : ''} Connected`;
            statusText.classList.add('text-green-500');
            statusText.classList.remove('text-slate-400');
        } else {
            statusText.textContent = "No accounts linked";
            statusText.classList.remove('text-green-500');
            statusText.classList.add('text-slate-400');
        }
    }
    
    // Render NEW withdrawal payment methods grid
    function renderNewPaymentGrid() {
        const container = document.getElementById('new-paymentGrid');
        if (!container) return;
        
        container.innerHTML = '';
        
        let methods = [];
        
        if (adminSettings.paymentMethods && adminSettings.paymentMethods.length > 0) {
            methods = adminSettings.paymentMethods;
        } else {
            methods = [
                { id: 'bkash', name: 'bKash', icon: 'fas fa-mobile-alt', color: '#E2136E' },
                { id: 'nagad', name: 'Nagad', icon: 'fas fa-wallet', color: '#F8A01C' },
                { id: 'rocket', name: 'Rocket', icon: 'fas fa-rocket', color: '#8C34FF' },
                { id: 'paypal', name: 'PayPal', icon: 'fab fa-paypal', color: '#003087' }
            ];
        }
        
        methods.forEach(method => {
            const card = document.createElement('div');
            card.className = 'new-payment-method-card';
            card.dataset.id = method.id;
            
            const isSet = userData.paymentInfo[method.id] ? true : false;
            
            card.innerHTML = `
                <div class="new-payment-icon" style="color: ${method.color || '#2563eb'}">
                    <i class="${method.icon || 'fas fa-credit-card'}"></i>
                </div>
                <div class="font-semibold text-sm text-gray-800">${method.name}</div>
                <div class="text-xs ${isSet ? 'text-green-600' : 'text-red-400'} mt-1">
                    ${isSet ? '<i class="fas fa-check-circle"></i> Linked' : 'Not Linked'}
                </div>
            `;

            card.onclick = () => selectNewPaymentMethod(method, card);
            container.appendChild(card);
        });
    }
    
    function selectNewPaymentMethod(method, cardElement) {
        // UI Selection
        document.querySelectorAll('.new-payment-method-card').forEach(c => c.classList.remove('selected'));
        cardElement.classList.add('selected');
        
        currentWithdrawMethod = method.id;
        document.getElementById('new-methodError').classList.add('hidden');

        // Check details
        const detailsDiv = document.getElementById('new-selectedMethodDetails');
        const previewSpan = document.getElementById('new-sendToPreview');
        const savedInfo = userData.paymentInfo[method.id];

        if (savedInfo) {
            detailsDiv.classList.remove('hidden');
            previewSpan.innerText = savedInfo;
        } else {
            detailsDiv.classList.add('hidden');
            showTopNotification(`Please link your ${method.name} account first.`);
            openNewPaymentEditModal();
        }
        
        updateNewFeeCalculation();
    }
    
    function updateNewFeeCalculation() {
        const amount = parseFloat(document.getElementById('new-amountInput').value) || 0;
        const fee = amount * 0.02; // 2% fee
        const net = amount - fee;

        document.getElementById('new-feeDisplay').innerText = `BDT ${fee.toFixed(2)}`;
        document.getElementById('new-netAmountDisplay').innerText = `BDT ${Math.max(0, net).toFixed(2)}`;
    }
    
    function openNewPaymentEditModal() {
        const formContainer = document.getElementById('new-dynamicPaymentForm');
        formContainer.innerHTML = '';
        
        const methods = adminSettings.paymentMethods.length > 0 
            ? adminSettings.paymentMethods 
            : [
                { id: 'bkash', name: 'bKash', type: 'number' },
                { id: 'nagad', name: 'Nagad', type: 'number' },
                { id: 'rocket', name: 'Rocket', type: 'number' },
                { id: 'paypal', name: 'PayPal', type: 'email' }
              ];

        methods.forEach(method => {
            const div = document.createElement('div');
            div.innerHTML = `
                <label class="block text-sm font-medium text-gray-700 mb-1">${method.name} ${method.type === 'email' ? 'Email' : 'Number'}</label>
                <input type="${method.type || 'text'}" 
                       class="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 focus:bg-white transition-colors"
                       placeholder="Enter ${method.name} details"
                       data-id="${method.id}"
                       value="${userData.paymentInfo[method.id] || ''}">
            `;
            formContainer.appendChild(div);
        });

        document.getElementById('new-dynamicPaymentEditModal').classList.add('active');
    }
    
    async function fetchNewHistory() {
        const tbody = document.getElementById('new-historyTableBody');
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500">Loading...</td></tr>';
        
        try {
            const snapshot = await db.collection(WITHDRAWALS_COLLECTION)
                .where('userId', '==', userData.id || userData.username)
                .orderBy('timestamp', 'desc')
                .limit(10)
                .get();
                
            tbody.innerHTML = '';
            
            if(snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-400">No transactions yet</td></tr>';
                return;
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                const date = new Date(data.timestamp).toLocaleDateString();
                // Check for both 'approved' AND 'completed'
let statusColor = (data.status === 'approved' || data.status === 'completed') ? 'text-green-600' : (data.status === 'rejected' ? 'text-red-500' : 'text-yellow-600');
                
                const row = `
                    <tr class="border-b border-gray-100">
                        <td class="py-3 text-gray-600">${date}</td>
                        <td class="py-3 capitalize">${data.method}</td>
                        <td class="py-3 font-medium">BDT ${data.amount}</td>
                        <td class="py-3 ${statusColor} text-xs font-bold uppercase">${data.status}</td>
                    </tr>
                `;
                tbody.innerHTML += row;
            });
        } catch(e) { console.error(e); tbody.innerHTML = '<tr><td colspan="4" class="text-center">Error loading history</td></tr>'; }
    }
    
    // --- Dynamic Extra Ads Rendering ---
    // --- Dynamic Extra Ads Rendering (Updated Style) ---
    
    function renderBannerAds(activeSection) {
    // 1. Grab the exact object names your Admin Panel uses
    const bannerAds = adminSettings.bannerAds || {};
    const nativeAd = adminSettings.nativeAd || {};

    // 2. Map the containers
    const homeCont = document.getElementById('homeBannerContainer');
    const earnCont = document.getElementById('earnBannerContainer');
    const gameCont = document.getElementById('gameBannerContainer');
    const profileCont = document.getElementById('profileBannerContainer');
    const nativeCont = document.getElementById('profileNativeBannerContainer');

    // 3. Helper for the 4 main banners (Home, Earn, Game, Profile)
    const handleMainBanner = (container, codeString, isSectionActive) => {
        if (!container) return;
        
        // If the Master Banner toggle is OFF in the admin panel, or the box was empty, clear it
        if (!bannerAds.active || !codeString || codeString.trim() === "") {
            container.innerHTML = "";
            return;
        }

        // SAFE LOAD: Inject the script if they are on the tab and it hasn't loaded yet
        if (isSectionActive && container.innerHTML.trim() === "") {
            insertAdHTML(container, codeString);
        }
    };

    // 4. Helper specifically for the Native Banner (which has a slightly different format)
    const handleNativeBanner = (container, nativeObj, isSectionActive) => {
        if (!container) return;
        
        if (!nativeObj || !nativeObj.active || !nativeObj.code || nativeObj.code.trim() === "") {
            container.innerHTML = "";
            return;
        }

        if (isSectionActive && container.innerHTML.trim() === "") {
            insertAdHTML(container, nativeObj.code);
        }
    };

    // 5. Fire the injections based on the exact keys from your Admin Panel!
    handleMainBanner(homeCont, bannerAds.home, activeSection === 'home-section');
    handleMainBanner(earnCont, bannerAds.earn, activeSection === 'earn-section');
    handleMainBanner(gameCont, bannerAds.game, activeSection === 'games-section');
    handleMainBanner(profileCont, bannerAds.profile, activeSection === 'profile-section');
    
    // Native ad processes separately
    handleNativeBanner(nativeCont, nativeAd, activeSection === 'profile-section');
}
    // --- Dynamic Extra Ads Rendering (Updated) ---
    function renderExtraAds() {
        const container = document.getElementById('extraTasksContainer');
        const noAdsMsg = document.getElementById('noAdsMsg');
        
        if (!container) return;
        
        container.innerHTML = '';
        
        // FIX: Filter out items that are 'banner' type
        // We only want 'smartlink', 'iframe', or undefined types to show as Gift Boxes
        const validTasks = adminSettings.adServices?.filter(s => s.active && s.type !== 'banner') || [];
        
        if (validTasks.length === 0) {
            if (noAdsMsg) noAdsMsg.classList.remove('hidden');
            return;
        } else {
            if (noAdsMsg) noAdsMsg.classList.add('hidden');
        }

        validTasks.forEach(service => {
            const card = document.createElement('div');
            card.className = "extra-earn-card";
            card.innerHTML = `
                <i class="fas fa-gift extra-gift-icon"></i>
                <div class="relative z-10">
                    <h2 class="text-xl font-bold mb-0.5">${service.name || 'Bonus Task'}</h2>
                    <p class="text-xs opacity-90 mb-2">Reward: +${service.reward || 0.10} BDT</p>
                    <button class="extra-btn" onclick="startSpecificAd('${service.id}')">
                        <i class="fas fa-box-open mr-1"></i> Open & Earn
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    }
   // --- Dynamic Ad Popup with Timer & Smartlink Verification ---
    // --- Dynamic Ad Popup with New UI ---
    window.startSpecificAd = function(serviceId) {
        const service = adminSettings.adServices?.find(s => s.id === serviceId);
        if(!service) {
            showTopNotification("Ad service not available.");
            return;
        }
        
        if (maintenanceMode) {
            showTopNotification('App is under maintenance.');
            return;
        }
        
        if (penaltyActive) {
            showTopNotification('Please wait until penalty expires.');
            return;
        }
        
        // 1. Get Elements
        const overlay = document.getElementById('adOverlay');
        const container = document.getElementById('adContainer');
        const timerText = document.getElementById('adHeaderTimer');
        const spinner = document.getElementById('timerSpinner');
        const btn = document.getElementById('closeAdBtn');
        const bar = document.getElementById('adProgressBar');
        const footerMsg = document.getElementById('adFooterMessage');
        
        // 2. Reset UI State
        container.innerHTML = '';
        btn.className = 'close-btn-modern'; // Reset classes
        btn.innerHTML = '<i class="fas fa-lock text-sm"></i>';
        bar.style.width = '0%';
        bar.style.background = 'linear-gradient(90deg, #3b82f6, #60a5fa)';
        spinner.style.display = 'block';
        timerText.classList.remove('complete');
        timerText.textContent = 'Wait...';
        overlay.style.display = 'flex'; // Show overlay
        
        let lockTime = service.duration || 15;
        
        // 3. Setup Content based on Type
        if (service.type === 'smartlink') {
            // --- SMARTLINK LOGIC ---
            window.open(service.code, '_blank');
            
            // Inject the Radar Animation HTML
            container.innerHTML = `
                <div class="verification-overlay">
                    <div class="radar-pulse">
                        <i class="fas fa-satellite-dish"></i>
                    </div>
                    <h2 class="text-xl font-bold text-slate-800 mb-2">Verifying Task...</h2>
                    <p class="text-slate-500 text-sm max-w-xs mx-auto mb-6 leading-relaxed">
                        Link opened in new tab. Keep browsing for <strong class="text-blue-600">${lockTime}s</strong> to confirm reward.
                    </p>
                    <div class="flex flex-col gap-3 w-full max-w-xs">
                        <div class="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-lg shadow-sm">
                            <div class="w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xs"><i class="fas fa-check"></i></div>
                            <span class="text-xs font-medium text-slate-600">Link Opened</span>
                        </div>
                        <div class="flex items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg shadow-sm">
                            <div class="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"></div>
                            <span class="text-xs font-bold text-blue-700">Checking Activity...</span>
                        </div>
                    </div>
                </div>
            `;
            footerMsg.innerHTML = '<i class="fas fa-sync fa-spin text-blue-400"></i> <span>Verifying external activity...</span>';
            
        } else {
            // --- IFRAME/BANNER LOGIC ---
            footerMsg.innerHTML = '<i class="fas fa-eye text-blue-400"></i> <span>Stay on this screen</span>';
            const iframe = document.createElement('iframe');
            iframe.className = 'ad-iframe';
            container.appendChild(iframe);
            const doc = iframe.contentWindow.document;
            doc.open();
            doc.write(`
                <style>body{margin:0;display:flex;justify-content:center;align-items:center;height:100vh;overflow:hidden;background:#fff;}</style>
                ${service.code || '<h2 style="font-family:sans-serif;">Ad Content Loaded</h2>'}
            `);
            doc.close();
        }

        // 4. Timer Logic
        let elapsed = 0;
        let totalTime = lockTime + 5; 

        if (adInterval) clearInterval(adInterval); 

        adInterval = setInterval(() => {
            elapsed++;
            
            // Update Bar
            const pct = Math.min((elapsed / lockTime) * 100, 100);
            bar.style.width = `${pct}%`;

            if (lockTime - elapsed > 0) {
                // Counting down
                timerText.textContent = `Wait 00:${String(lockTime - elapsed).padStart(2, '0')}`;
            } else {
                // Success State
                timerText.textContent = 'Reward Ready';
                timerText.classList.add('complete');
                spinner.style.display = 'none';
                
                bar.style.background = '#10b981'; // Green bar
                footerMsg.innerHTML = '<i class="fas fa-gift text-green-400"></i> <span class="text-green-400">Task Verified! Tap lock to claim.</span>';
                
                if(!btn.classList.contains('active')) {
                    btn.classList.add('active'); // Unlock button
                    btn.innerHTML = '<i class="fas fa-check text-lg"></i>'; // Change icon
                }
            }

            if (elapsed >= totalTime + 60) clearInterval(adInterval);
        }, 1000);

        // 5. Close Handler
        btn.onclick = async () => {
            if(!btn.classList.contains('active')) return;
            
            clearInterval(adInterval);
            overlay.style.display = 'none';
            
            // Reward
            const bonus = service.reward || 0.10;
            userData.balance += bonus;
            
            // New History Logic (ensure this function is available)
            if(typeof HistoryManager !== 'undefined') {
                HistoryManager.addRecord('task', bonus, service.name || 'Bonus Task');
            }
            
            await saveUserData();
            updateUI();
            showSuccessPopup(`🎉 +${bonus.toFixed(2)} BDT Earned!`);
        };
    }; 
    
    async function saveDynamicPaymentInfo() {
        const inputs = document.querySelectorAll('#dynamicPaymentForm input');
        const newInfo = {};
        
        inputs.forEach(input => {
            const id = input.getAttribute('data-id');
            if (input.value.trim()) newInfo[id] = input.value.trim();
        });

        userData.paymentInfo = newInfo;
        
        // Update original payment fields for backward compatibility
        if (newInfo.paypal) userData.paypal = newInfo.paypal;
        if (newInfo.payoneer) userData.payoneer = newInfo.payoneer;
        if (newInfo.bkash) userData.bkash = newInfo.bkash;
        
        const btn = document.getElementById('saveDynamicPaymentBtn');
        const originalText = btn.textContent;
        btn.textContent = 'Saving...';
        btn.disabled = true;
        
        try {
            await db.collection(USERS_COLLECTION).doc(userData.id || userData.username).update({ 
                paymentInfo: newInfo,
                paypal: userData.paypal,
                payoneer: userData.payoneer,
                bkash: userData.bkash
            });
            
            renderDynamicPaymentUI();
            updateUI();
            showTopNotification("Payment information updated!");
            
            // Close modal
            document.getElementById('dynamicPaymentEditModal').classList.remove('show');
            setTimeout(() => {
                document.getElementById('dynamicPaymentEditModal').style.display = 'none';
            }, 300);
        } catch (error) {
            console.error("Error saving payment info:", error);
            showTopNotification("Failed to save payment information");
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
    
    async function saveNewDynamicPaymentInfo() {
        const inputs = document.querySelectorAll('#new-dynamicPaymentForm input');
        const newInfo = {};
        
        inputs.forEach(input => {
            const id = input.getAttribute('data-id');
            if (input.value.trim()) newInfo[id] = input.value.trim();
        });

        userData.paymentInfo = { ...userData.paymentInfo, ...newInfo };
        
        const btn = document.getElementById('new-saveDynamicPaymentBtn');
        const originalText = btn.textContent;
        btn.textContent = 'Saving...';
        btn.disabled = true;
        
        try {
            await db.collection(USERS_COLLECTION).doc(userData.id || userData.username).update({ 
                paymentInfo: userData.paymentInfo
            });
            
            renderProfilePaymentMethods();
            renderNewPaymentGrid();
            updateUI();
            showTopNotification("Payment information updated!");
            
            // Close modal
            document.getElementById('new-dynamicPaymentEditModal').classList.remove('active');
        } catch (error) {
            console.error("Error saving payment info:", error);
            showTopNotification("Failed to save payment information");
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }

    // ===================== HELPER FUNCTIONS =====================
    function insertAdHTML(container, htmlCode) {
    if (!container || !htmlCode) return;
    
    // Clear previous ad content
    container.innerHTML = '';
    
    const wrapper = document.createElement('div');
    wrapper.className = 'ad-wrapper';
    container.appendChild(wrapper);

    // Parse the HTML string
    const range = document.createRange();
    range.selectNode(wrapper);
    const fragment = range.createContextualFragment(htmlCode);
    wrapper.appendChild(fragment);

    // CRITICAL FIX: Force the browser to execute injected <script> tags
    // Adsterra/Monetag will not work in an SPA without this step.
    const scripts = wrapper.querySelectorAll('script');
    scripts.forEach(oldScript => {
        const newScript = document.createElement('script');
        // Copy all attributes (src, type, etc.)
        Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
        // Copy inline script content
        if (oldScript.innerHTML) {
            newScript.innerHTML = oldScript.innerHTML;
        }
        // Replace the old dead script with the new live one
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
}



    function toggleAboutModal() {
      const modal = document.getElementById('aboutModal');
      if (modal.classList.contains('show')) {
        modal.classList.remove('show');
        // Optional: wait for transition then hide if you want to save resources, 
        // but pointer-events:none in CSS handles clicks fine.
      } else {
        modal.classList.add('show');
      }
    }
// ================= LEGAL MODAL FUNCTIONS =================

    function openLegal(type) {
      const modal = document.getElementById('legalModal');
      const title = document.getElementById('legalTitle');
      const content = document.getElementById('legalContent');
      
      // Inject correct content based on type
      if (type === 'terms') {
        title.innerHTML = '<i class="fas fa-file-contract text-blue-500"></i> Terms of Service';
        content.innerHTML = document.getElementById('termsText').innerHTML;
      } else {
        title.innerHTML = '<i class="fas fa-user-shield text-green-500"></i> Privacy Policy';
        content.innerHTML = document.getElementById('privacyText').innerHTML;
      }

      // Show modal
      modal.style.display = 'flex';
      // Small timeout for CSS transition to work
      setTimeout(() => {
          modal.classList.add('show');
      }, 10);
    }

    function closeLegal() {
      const modal = document.getElementById('legalModal');
      modal.classList.remove('show');
      
      // Wait for animation to finish before hiding
      setTimeout(() => {
          modal.style.display = 'none';
      }, 300);
    }
    
    // Close modal if clicking outside card
    document.addEventListener('DOMContentLoaded', () => {
        const legalModal = document.getElementById('legalModal');
        if(legalModal) {
            legalModal.addEventListener('click', (e) => {
                if (e.target === legalModal) {
                    closeLegal();
                }
            });
        }
    });
    function initTelegram() {
        return new Promise((resolve) => {
            if (window.Telegram?.WebApp) {
                Telegram.WebApp.ready();
                Telegram.WebApp.expand();
                resolve(true);
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://telegram.org/js/telegram-web-app.js';
            
            script.onload = () => {
                if (window.Telegram?.WebApp) {
                    Telegram.WebApp.ready();
                    Telegram.WebApp.expand();
                    resolve(true);
                } else {
                    resolve(false);
                }
            };
            
            script.onerror = () => {
                resolve(false);
            };
            
            document.head.appendChild(script);
        });
    }

    function getTelegramUserData() {
        try {
            if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
                const user = Telegram.WebApp.initDataUnsafe.user;
                return {
                    id: user.id ? user.id.toString() : "",
                    name: [user.first_name, user.last_name].filter(Boolean).join(" "),
                    username: user.username ? `@${user.username}` : user.first_name,
                    photoUrl: user.photo_url || null
                };
            }
            
            if (window.Telegram?.WebApp?.initData) {
                const params = new URLSearchParams(Telegram.WebApp.initData);
                const userJson = params.get('user');
                if (userJson) {
                    const user = JSON.parse(userJson);
                    return {
                        id: user.id ? user.id.toString() : "",
                        name: [user.first_name, user.last_name].filter(Boolean).join(" "),
                        username: user.username ? `@${user.username}` : user.first_name,
                        photoUrl: user.photo_url || null
                    };
                }
            }
        } catch (e) {
            console.error("Error getting Telegram user data:", e);
        }
        return null;
    }

    function generateUsername() {
        return `User${Math.floor(1000 + Math.random() * 9000)}`;
    }

    function showEditNotification() {
        const banner = document.getElementById("androidTopNotification");
        if (!banner) return;
        
        banner.textContent = "To edit payment information, please go to the Profile section and use the Edit button";
        banner.classList.add("show");
        setTimeout(() => banner.classList.remove("show"), 3000);
    }

    function isValidEmail(email) {
        if (!email) return false;
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }

    function isValidBkash(number) {
        if (!number) return false;
        return /^(?:\+?88)?01[3-9]\d{8}$/.test(number);
    }

    /**
 * AdVault Android-Style Notification Engine
 * @param {string} title - The Bold Title
 * @param {string} message - The Body text
 * @param {string} type - 'earn', 'error', or 'info'
 */
/**
 * AdVault Intelligent Notification Engine
 * Automatically maps security, earnings, and system alerts.
 */
/**
 * AdVault Intelligent Notification Engine with Local History
 */
/**
 * AdVault IOS-Style Stacking Notification Engine
 * Automatically maps security, earnings, and system alerts with swipe physics.
 */

const activeNotifications = []; 
const GAP_BETWEEN_NOTIFS = 10; 
const TOP_MARGIN = 16;         

function showTopNotification(message, duration = 4000) {
    let config = {
        title: "System Update",
        icon: '<i class="fas fa-bell text-blue-500" style="margin-right: 6px;"></i>',
        type: "info",
        msg: message
    };

    const lowerMsg = message.toLowerCase();

    // Intelligent Text Mapping
    if (lowerMsg.includes('invalid') || lowerMsg.includes('fail') || lowerMsg.includes('error') || lowerMsg.includes('penalty') || lowerMsg.includes('link your')) {
        config.title = "Security Alert";
        config.icon = '<i class="fas fa-exclamation-circle text-red-500" style="margin-right: 6px;"></i>';
        config.type = "security";
    } else if (lowerMsg.includes('earn') || lowerMsg.includes('+') || lowerMsg.includes('success') || lowerMsg.includes('submitted')) {
        config.title = "Payment Received";
        config.icon = '<i class="fas fa-check-circle text-green-500" style="margin-right: 6px;"></i>';
        config.type = "earning";
        config.msg = message.replace(/(\+?\d+\.\d+\s?BDT)/g, '<span class="money-green">$1</span>');
    }

    // Save to local history
    if(typeof saveNotificationToHistory === 'function') {
        saveNotificationToHistory(config.title, message, config.type);
    }

    // 1. Create Element
    const notifEl = document.createElement('div');
    notifEl.classList.add('notification');
    notifEl.innerHTML = `
        <img src="https://worldnews24x7.infy.uk/image/advault3.png" alt="AdVault" class="notif-avatar">
        <div class="notif-text-wrapper">
            <div class="notif-header">
                <span class="notif-app-name">AdVault Alert</span>
                <span class="notif-time">now</span>
            </div>
            <div class="notif-title">${config.icon} ${config.title}</div>
            <div class="notif-desc">${config.msg}</div>
        </div>
    `;
    
    // Inject directly to body
    document.body.appendChild(notifEl);

    // 2. Create Tracker
    const notifObj = {
        el: notifEl,
        isExpanded: false,
        isDismissing: false,
        timer: null
    };

    activeNotifications.unshift(notifObj);

    // 3. Drop in
    requestAnimationFrame(() => layoutNotifications());

    // 4. Expand
    setTimeout(() => {
        notifObj.isExpanded = true;
        notifEl.classList.add('expanded');
        layoutNotifications(); 
    }, 300);

    // 5. Setup Auto-remove & Gestures
    notifObj.timer = setTimeout(() => dismissNotification(notifObj, 'auto'), duration);
    setupGestures(notifObj);
}

function layoutNotifications() {
    let currentTopPosition = TOP_MARGIN;

    activeNotifications.forEach((notifObj) => {
        if (notifObj.isDismissing) return; 

        notifObj.el.style.top = `${currentTopPosition}px`;
        const currentHeight = notifObj.isExpanded ? 76 : 56;
        currentTopPosition += currentHeight + GAP_BETWEEN_NOTIFS;
    });
}

function dismissNotification(notifObj, method, dragX = 0, dragY = 0) {
    if (notifObj.isDismissing) return;
    notifObj.isDismissing = true;
    clearTimeout(notifObj.timer); 

    const index = activeNotifications.indexOf(notifObj);
    if (index > -1) activeNotifications.splice(index, 1);

    layoutNotifications();

    if (method === 'auto' || method === 'up') {
        notifObj.el.classList.remove('expanded');
        setTimeout(() => {
            notifObj.el.style.top = '-100px'; 
            setTimeout(() => notifObj.el.remove(), 500);
        }, 400);
    } 
    else if (method === 'left') {
        notifObj.el.style.transform = `translateX(calc(-50% - 150vw)) translateY(${dragY}px)`;
        notifObj.el.style.opacity = '0';
        setTimeout(() => notifObj.el.remove(), 400);
    } 
    else if (method === 'right') {
        notifObj.el.style.transform = `translateX(calc(-50% + 150vw)) translateY(${dragY}px)`;
        notifObj.el.style.opacity = '0';
        setTimeout(() => notifObj.el.remove(), 400);
    }
}

function setupGestures(notifObj) {
    const el = notifObj.el;
    let startX = 0, startY = 0, currentX = 0, currentY = 0, isDragging = false;

    const onStart = (e) => {
        isDragging = true;
        startX = (e.type === 'touchstart') ? e.touches[0].clientX : e.clientX;
        startY = (e.type === 'touchstart') ? e.touches[0].clientY : e.clientY;
        el.classList.add('dragging');
        clearTimeout(notifObj.timer); 
    };

    const onMove = (e) => {
        if (!isDragging) return;
        currentX = ((e.type === 'touchmove') ? e.touches[0].clientX : e.clientX) - startX;
        currentY = ((e.type === 'touchmove') ? e.touches[0].clientY : e.clientY) - startY;

        let dragY = currentY > 0 ? currentY * 0.2 : currentY; 
        el.style.transform = `translateX(calc(-50% + ${currentX}px)) translateY(${dragY}px)`;
        el.style.opacity = 1 - (Math.max(Math.abs(currentX), Math.abs(dragY)) / 300);
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        el.classList.remove('dragging');

        const swipeThreshold = 50;

        if (currentX < -swipeThreshold) dismissNotification(notifObj, 'left', currentX, currentY); 
        else if (currentX > swipeThreshold) dismissNotification(notifObj, 'right', currentX, currentY);  
        else if (currentY < -swipeThreshold) dismissNotification(notifObj, 'up', currentX, currentY); 
        else {
            el.style.transform = 'translateX(-50%) translateY(0)';
            el.style.opacity = '1';
            notifObj.timer = setTimeout(() => dismissNotification(notifObj, 'auto'), 3000);
        }
    };

    el.addEventListener('touchstart', onStart, {passive: true});
    el.addEventListener('touchmove', onMove, {passive: true});
    el.addEventListener('touchend', onEnd);
    
    // Desktop fallback just in case testing on PC
    el.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', (e) => isDragging && onMove(e));
    window.addEventListener('mouseup', () => isDragging && onEnd());
}

    /* ================= SUCCESS POPUP LOGIC ================= */

    function showSuccessPopup(message = "Success!", title = "Awesome!") {
        const popup = document.getElementById('successPopup');
        const titleEl = document.getElementById('popupTitle');
        const msgEl = document.getElementById('popupMessage');
        
        if (!popup) return;

        // Update Text
        if(titleEl) titleEl.textContent = title;
        if(msgEl) msgEl.textContent = message;
        
        // --- Animation Reset Trick ---
        // We clone and replace the icon wrapper to force CSS animations to replay
        const wrapper = popup.querySelector('.icon-wrapper');
        if (wrapper) {
            const newWrapper = wrapper.cloneNode(true);
            wrapper.parentNode.replaceChild(newWrapper, wrapper);
        }

        // Show Popup
        popup.classList.add('show');
        
        // Auto-close after 3 seconds (optional, removing it makes user click 'Continue')
        // setTimeout(() => closeSuccessPopup(), 3000); 
    }

    function closeSuccessPopup() {
        const popup = document.getElementById('successPopup');
        if (popup) {
            popup.classList.remove('show');
        }
    }
        
        
    
    function updateUI() {
    const greetingEl = document.getElementById('greeting-text');
        if (greetingEl) {
            const hour = new Date().getHours();
            let greeting = 'Good Morning';
            
            if (hour >= 12 && hour < 17) {
                greeting = 'Good Afternoon';
            } else if (hour >= 17) {
                greeting = 'Good Evening';
            }
            // Optional: Handle late night (12 AM to 4 AM) if you want
            if (hour >= 0 && hour < 5) {
                greeting = 'Good Evening'; // Or 'Late Night' if you prefer
            }
            
            greetingEl.textContent = greeting;
        }
        // 1. Update Header (Safely)
        const headerUsername = document.getElementById('header-username');
        const headerBalance = document.getElementById('header-balance');
        
        if (headerUsername) headerUsername.textContent = userData.username;
        if (headerBalance) headerBalance.textContent = `BDT ${userData.balance.toFixed(2)}`;

        // 2. Update Home Section
        if (document.getElementById('home-earnings-val')) {
            document.getElementById('home-earnings-val').textContent = `BDT ${userData.totalEarnings.toFixed(2)}`;
            document.getElementById('home-ads-val').textContent = userData.adsWatched;
            
            // Update Home Ticker if it exists
            const homeTicker = document.getElementById('marqueeTextHome');
            if (homeTicker) {
                 const text = adminSettings.marqueeSettings?.[userCountry] || 
                              adminSettings.marqueeSettings?.['default'] || 
                              "Welcome to AdVault!";
                 homeTicker.textContent = text;
            }
        }

        // 3. Update Earn Section
        if (document.getElementById('earn-completed')) {
            const remaining = userData.totalTasks - userData.completedTasks;
            document.getElementById('earn-completed').textContent = userData.completedTasks;
            document.getElementById('earn-remaining').textContent = remaining;
            const progressPercent = (userData.completedTasks / userData.totalTasks) * 100;
            
            const progressBar = document.getElementById('earn-progress-bar');
            if(progressBar) progressBar.style.width = `${progressPercent}%`;
        }

        // 4. Update Withdraw Section
        if (document.getElementById('new-withdraw-balance-display')) {
            document.getElementById('new-withdraw-balance-display').textContent = `BDT ${userData.balance.toFixed(2)}`;
            document.getElementById('new-withdraw-total-earn').textContent = `BDT ${userData.totalEarnings.toFixed(2)}`;
            document.getElementById('new-withdraw-total-out').textContent = `BDT ${userData.totalWithdrawn.toFixed(2)}`;
        }
// Update mini-avatar in the new bottom navigation
    if (userData.profilePhoto) {
        const navProfileImg = document.getElementById('nav-profile-img');
        if (navProfileImg) navProfileImg.src = userData.profilePhoto;
    }
        // 5. Update Profile Section (CRASH FIX IS HERE)
        // We now check if each element exists before setting textContent
        if (document.getElementById('profileName')) {
            document.getElementById('profileName').textContent = userData.name || "Not available";
            document.getElementById('profileUsername').textContent = userData.username;
            
            if (document.getElementById('profileId')) {
                document.getElementById('profileId').textContent = `ID: ${userData.id || "---"}`;
            }
            
            if (document.getElementById('profileBalance')) {
                document.getElementById('profileBalance').textContent = `BDT ${userData.balance.toFixed(2)}`;
            }
            if (document.getElementById('profileEarnings')) {
                document.getElementById('profileEarnings').textContent = `BDT ${userData.totalEarnings.toFixed(2)}`;
            }
            if (document.getElementById('profileAds')) {
                document.getElementById('profileAds').textContent = userData.adsWatched;
            }
            if (document.getElementById('profileReferrals')) {
                document.getElementById('profileReferrals').textContent = userData.referrals || 0;
            }
            if (document.getElementById('profileWithdrawn')) {
                document.getElementById('profileWithdrawn').textContent = `BDT ${userData.totalWithdrawn.toFixed(2)}`;
            }
            
            // Safe Update for Version display in Profile
            if (document.getElementById('displayVersionProfile')) {
                 document.getElementById('displayVersionProfile').textContent = `Version ${adminSettings.appVersion || '2.1.0'}`;
            }
        }
        
        // 6. Update Telegram Indicator
        const telegramIndicator = document.getElementById('telegramIndicator');
        if (telegramIndicator) {
            telegramIndicator.style.display = userData.telegramDetected ? 'flex' : 'none';
        }

        // 7. Update Flag
        if (typeof setCountryFlag === 'function' && userCountry) {
            setCountryFlag(userCountry); 
        }
        
        // 8. Call sub-functions
        if (typeof updateProfileImages === 'function') updateProfileImages();
        if (typeof renderProfilePaymentMethods === 'function') renderProfilePaymentMethods();
    
    
        // Update build number
        if (document.getElementById('buildNumber')) {
            document.getElementById('buildNumber').textContent = "AV20250902";
        }
    }
    
    function updateProfileImages() {
        const profileContainer = document.getElementById('profileImageContainer'); 
        const headerContainer = document.getElementById('headerProfileImage'); 
        
        if (!profileContainer || !headerContainer) return;
        
        // 1. Clear current content
        profileContainer.innerHTML = '';
        headerContainer.innerHTML = '';
        
        // 2. CRITICAL FIX: Reset to base class to ensure circle shape is restored
        headerContainer.className = "avatar-img-wrapper"; 
        
        // 3. Logic: Check if user has a photo
        if (userData.profilePhoto) {
            // --- USER HAS PHOTO ---
            
            // A. Main Profile Page Image
            const profileImg = document.createElement('img');
            profileImg.src = userData.profilePhoto;
            profileImg.alt = "Profile photo";
            profileImg.className = "w-full h-full rounded-full object-cover";
            profileContainer.appendChild(profileImg);
            
            // B. Header Image
            const headerImg = document.createElement('img');
            headerImg.src = userData.profilePhoto;
            headerImg.alt = "Profile";
            // Added rounded-full to image as a backup
            headerImg.className = "w-full h-full object-cover rounded-full"; 
            headerContainer.appendChild(headerImg);

        } else {
            // --- USER HAS NO PHOTO (SHOW PLACEHOLDERS) ---
            
            // A. Main Profile Page Placeholder
            const profilePlaceholder = document.createElement('div');
            profilePlaceholder.className = "w-full h-full rounded-full flex items-center justify-center";
            profilePlaceholder.innerHTML = '<i class="fas fa-user text-gray-300 text-3xl"></i>';
            profileContainer.appendChild(profilePlaceholder);
            
            // B. Header Placeholder (Astronaut)
            // FIX: We append flex classes WITHOUT removing avatar-img-wrapper
            headerContainer.className = "avatar-img-wrapper flex items-center justify-center";
            headerContainer.innerHTML = '<i class="fas fa-user-astronaut text-xl text-blue-500"></i>';
        }
    }

    function checkDailyReset() {
        const today = new Date().toLocaleDateString('en-CA'); // Fixes timezone bug
        if (userData.lastResetDate !== today) {
            userData.completedTasks = 0;
            userData.spinKeys = (userData.spinKeys || 0) + 2; // Give 2 daily keys
            userData.lastResetDate = today;
            saveUserData();
        }
    }
    /* ================= SPIN & WIN LOGIC ================= */
let isSpinning = false;
let currentRotation = 0;
let pendingSpinReward = null;

const spinSegments = [
    { label: "0.5 BDT", type: "bdt", value: 0.5, start: 0, end: 45 },
    { label: "0.2 BDT", type: "bdt", value: 0.2, start: 45, end: 90 },
    { label: "0.8 BDT", type: "bdt", value: 0.8, start: 90, end: 135 },
    { label: "0.1 BDT", type: "bdt", value: 0.1, start: 135, end: 180 },
    { label: "0.9 BDT", type: "bdt", value: 0.9, start: 180, end: 225 },
    { label: "Try Again", type: "empty", value: 0, start: 225, end: 270 },
    { label: "+1 Key", type: "key", value: 1, start: 270, end: 315 },
    { label: "0.4 BDT", type: "bdt", value: 0.4, start: 315, end: 360 }
];

function updateSpinUI() {
    const keyDisplay = document.getElementById('spin-key-count');
    const spinBtn = document.getElementById('main-spin-btn');
    
    if(keyDisplay) keyDisplay.textContent = userData.spinKeys || 0;
    
    if(spinBtn) {
        if((userData.spinKeys || 0) > 0) {
            spinBtn.textContent = "SPIN NOW";
            spinBtn.className = "w-full py-4 rounded-2xl font-extrabold text-lg transition-all shadow-lg text-slate-900 bg-gradient-to-r from-yellow-300 to-yellow-500 hover:scale-[0.98]";
        } else {
            spinBtn.textContent = "NEED KEYS TO SPIN";
            spinBtn.className = "w-full py-4 rounded-2xl font-extrabold text-lg transition-all shadow-inner text-slate-400 bg-slate-800 cursor-not-allowed";
        }
    }
}

async function watchAdForKey() {
    if (maintenanceMode) return showTopNotification('App under maintenance.');
    if (isSpinning) return;

    const btn = document.getElementById('get-key-ad-btn');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';
    btn.style.pointerEvents = 'none';

    try {
        // Randomly choose between Adsgram (50%) and LibTL (50%)
        const useAdsgram = Math.random() > 0.5;

        if (useAdsgram && window.AdsgramController) {
            await window.AdsgramController.show();
            grantKeySuccess();
        } else {
            // Fallback to LibTL
            await loadAdSDK();
            startAdTimer();
            await show_9683040();
            if (checkAdCompletion()) {
                grantKeySuccess();
            }
        }
    } catch (e) {
        console.error("Ad failed:", e);
        showTopNotification("Ad unavailable right now. Try again.");
    } finally {
        btn.innerHTML = oldHtml;
        btn.style.pointerEvents = 'auto';
    }
}

function grantKeySuccess() {
    userData.spinKeys = (userData.spinKeys || 0) + 1;
    saveUserData();
    updateSpinUI();
    showTopNotification("🎉 +1 Key Earned!");
}

function startSpin() {
    if ((userData.spinKeys || 0) <= 0 || isSpinning) return;

    // Deduct Key
    userData.spinKeys--;
    updateSpinUI();
    
    isSpinning = true;
    const btn = document.getElementById('main-spin-btn');
    btn.textContent = "SPINNING...";
    btn.className = "w-full py-4 rounded-2xl font-extrabold text-lg text-slate-400 bg-slate-800 cursor-not-allowed";

    const wheel = document.getElementById('spinWheelElement');
    
    // Calculate random spin
    const randomDeg = Math.floor(2500 + Math.random() * 360);
    currentRotation += randomDeg; 
    
    wheel.style.transform = `rotate(-${currentRotation}deg)`;

    // Wait for CSS transition to finish
    setTimeout(() => {
        isSpinning = false;
        calculateSpinResult(currentRotation);
    }, 4000);
}

function calculateSpinResult(rotation) {
    const normalized = rotation % 360;
    const winner = spinSegments.find(seg => normalized >= seg.start && normalized < seg.end);
    
    if (winner) {
        pendingSpinReward = winner;
        const modal = document.getElementById('spinResultModal');
        const title = document.getElementById('spinResultTitle');
        const msg = document.getElementById('spinResultMsg');
        const icon = document.getElementById('spinResultIcon');

        if (winner.type === "empty") {
            title.textContent = "OH NO!";
            title.className = "text-2xl font-extrabold text-slate-400 mb-2";
            msg.textContent = "Better luck next time!";
            icon.className = "fas fa-frown text-4xl text-slate-400";
            document.getElementById('claimSpinRewardBtn').textContent = "CLOSE";
        } else if (winner.type === "key") {
            title.textContent = "LUCKY!";
            title.className = "text-2xl font-extrabold text-yellow-400 mb-2";
            msg.textContent = "You found an extra Key!";
            icon.className = "fas fa-key text-4xl text-yellow-400";
            document.getElementById('claimSpinRewardBtn').textContent = "AWESOME";
        } else {
            title.textContent = "HUGE WIN!";
            title.className = "text-2xl font-extrabold text-yellow-400 mb-2";
            msg.textContent = `You won ${winner.value} BDT!`;
            icon.className = "fas fa-coins text-4xl text-yellow-400";
            document.getElementById('claimSpinRewardBtn').textContent = "AWESOME";
        }

        modal.classList.add('show');
    }
}

async function claimSpinReward() {
    const modal = document.getElementById('spinResultModal');
    const btn = document.getElementById('claimSpinRewardBtn');

    // If it was a loss, just close it
    if (pendingSpinReward.type === "empty") {
        modal.classList.remove('show');
        updateSpinUI();
        return;
    }

    // Prepare to show post-spin ad
    const originalText = btn.textContent;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Claiming...';
    btn.style.pointerEvents = 'none';

    try {
        // Require Adsgram ad to claim the reward
        if (window.AdsgramController) {
            await window.AdsgramController.show();
        } else {
            // Fallback ad if Adsgram fails
             await loadAdSDK();
             await show_9683040();
        }

        // AD FINISHED -> GIVE REWARD
        if (pendingSpinReward.type === "key") {
            userData.spinKeys = (userData.spinKeys || 0) + 1;
        } else if (pendingSpinReward.type === "bdt") {
            userData.balance += pendingSpinReward.value;
            userData.totalEarnings += pendingSpinReward.value;
            
            if(typeof HistoryManager !== 'undefined') {
                HistoryManager.addRecord('task', pendingSpinReward.value, 'Lucky Wheel Win');
            }
        }

        await saveUserData();
        updateUI(); // Updates main header balance
        showTopNotification(`Successfully claimed ${pendingSpinReward.label}!`);

    } catch (e) {
        console.error("Post-spin ad failed", e);
        showTopNotification("Failed to verify reward. Please try again.");
    } finally {
        modal.classList.remove('show');
        btn.textContent = originalText;
        btn.style.pointerEvents = 'auto';
        pendingSpinReward = null;
        updateSpinUI();
    }
}

    function showSection(targetId) {
    console.log("Navigating to:", targetId);

    // 1. Reset ALL sections
    document.querySelectorAll('.section, .section-fullscreen').forEach(s => {
        s.classList.remove('active');
        s.style.display = ''; 
    });

    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    
    // 2. Activate the Target Section
    const targetSection = document.getElementById(targetId);
    if (targetSection) {
        targetSection.classList.add('active');
    }

    // 3. Update Bottom Nav
    const targetNavItem = document.querySelector(`.nav-item[data-target="${targetId}"]`);
    if (targetNavItem) targetNavItem.classList.add('active');
    
 // ... (keep the top part of showSection the same) ...

    // 4. Handle Top Header Visibility
    const hideHeaderSections = [
        'profile-section', 
        'withdraw-section', 
        'withdrawal-history-section', 
        'earning-history-section', 
        'payment-methods-section',
        'notif-history-section',
        'spin-game-section',    // <--- ADD THIS
        'games-section'         // <--- ADD THIS TOO (Looks better without header)
    ];
    
    if (hideHeaderSections.includes(targetId)) {
        document.body.classList.add('header-hidden');
    } else {
        document.body.classList.remove('header-hidden');
    }

    // ==========================================
    // 5. TRIGGER AD LOADING (THE FIX)
    // ==========================================
    
  


    // Existing triggers...
    if (targetId === 'notif-history-section') {
        if(typeof renderNotifHistory === 'function') renderNotifHistory();
    }
    if (targetId === 'withdraw-section') {
        if(typeof renderWithdrawPage === 'function') renderWithdrawPage();
        if(typeof fetchWithdrawalHistory === 'function') fetchWithdrawalHistory();
    }
    if (targetId === 'withdrawal-history-section') {
        if(typeof fetchWithdrawalHistory === 'function') fetchWithdrawalHistory();
    }
    if (targetId === 'payment-methods-section') {
        if(typeof renderPaymentMethodsPage === 'function') renderPaymentMethodsPage();
    }
    if (targetId === 'earning-history-section') {
        if(typeof renderEarningHistory === 'function') renderEarningHistory();
    }
    if (targetId === 'profile-section') {
        if(typeof updateUI === 'function') updateUI();
    }
    if (targetId === 'earn-section' || targetId === 'profile-section' || targetId === 'home-section' || targetId === 'games-section') {
        // Small delay ensures the tab is fully visible before asking Adsterra to load
        setTimeout(() => {
            if(typeof renderBannerAds === 'function') {
                renderBannerAds(targetId); 
            }
        }, 50);
    }
}

    async function loadAdSDK() {
        return new Promise((resolve, reject) => {
            if (typeof show_9683040 === 'function') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://libtl.com/sdk.js';
            
            const timeout = setTimeout(() => {
                reject(new Error('Ad SDK loading timed out'));
                script.remove();
            }, 15000);

            script.onload = () => {
                clearTimeout(timeout);
                if (typeof show_9683040 === 'function') {
                    resolve();
                } else {
                    reject(new Error('Ad SDK function not found'));
                }
            };

            script.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('Failed to load ad SDK'));
            };

            document.head.appendChild(script);
        });
    }
    
    async function detectCountry() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        // 1. Fetch from api.country.is (Fast & Free)
        const response = await fetch('https://api.country.is/', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error("Geo-IP API unavailable");

        const data = await response.json();

        // 2. Update UI with IMAGE FLAG
        if (data.country) {
            const countryCode = data.country; // e.g., "US", "BD"
            
            // Get Elements
            const flagImg = document.getElementById('country-flag');
            const codeText = document.getElementById('country-code-text');

            // Set Text Code
            if (codeText) codeText.textContent = countryCode;

            // Set Flag Image (Lower case code required for URL)
            if (flagImg) {
                flagImg.src = `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`;
            }

            // Save to User Data
            if (typeof userData !== 'undefined') {
                userData.country = countryCode;
                userData.countryCode = countryCode;
            }
        }

    } catch (error) {
        console.warn("Country detection failed. Using default.");
        
        // Fallback to "World" Flag
        const flagImg = document.getElementById('country-flag');
        const codeText = document.getElementById('country-code-text');

        if (codeText) codeText.textContent = "INT";
        if (flagImg) flagImg.src = "https://flagcdn.com/w40/un.png"; // UN Flag

        if (typeof userData !== 'undefined') {
            userData.country = "International";
            userData.countryCode = "INT";
        }
    }
}
    
    function setCountryFlag(country) {
        const flagElement = document.getElementById('country-flag');
        if (!flagElement) return;
        
        const flagMap = {
    // --- South Asia ---
    'BD': '🇧🇩', 'IN': '🇮🇳', 'PK': '🇵🇰', 'LK': '🇱🇰', 'NP': '🇳🇵', 'MV': '🇲🇻',
    
    // --- North America ---
    'US': '🇺🇸', 'CA': '🇨🇦', 'MX': '🇲🇽',
    
    // --- Europe ---
    'GB': '🇬🇧', 'DE': '🇩🇪', 'FR': '🇫🇷', 'IT': '🇮🇹', 'ES': '🇪🇸', 
    'NL': '🇳🇱', 'BE': '🇧🇪', 'CH': '🇨🇭', 'SE': '🇸🇪', 'NO': '🇳🇴', 
    'DK': '🇩🇰', 'FI': '🇫🇮', 'PT': '🇵🇹', 'PL': '🇵🇱', 'UA': '🇺🇦', 
    'RU': '🇷🇺', 'TR': '🇹🇷', 'RO': '🇷🇴', 'GR': '🇬🇷', 'AT': '🇦🇹', 
    'IE': '🇮🇪', 'CZ': '🇨🇿', 'HU': '🇭🇺',
    
    // --- Middle East ---
    'SA': '🇸🇦', 'AE': '🇦🇪', 'QA': '🇶🇦', 'KW': '🇰🇼', 'OM': '🇴🇲', 
    'BH': '🇧🇭', 'IL': '🇮🇱', 'JO': '🇯🇴', 'LB': '🇱🇧', 'EG': '🇪🇬',

    // --- Southeast & East Asia ---
    'CN': '🇨🇳', 'JP': '🇯🇵', 'KR': '🇰🇷', 'TW': '🇹🇼', 'HK': '🇭🇰',
    'SG': '🇸🇬', 'MY': '🇲🇾', 'ID': '🇮🇩', 'TH': '🇹🇭', 'VN': '🇻🇳', 
    'PH': '🇵🇭', 'KH': '🇰🇭', 'MM': '🇲🇲',
    
    // --- Oceania ---
    'AU': '🇦🇺', 'NZ': '🇳🇿', 'FJ': '🇫🇯',
    
    // --- South America ---
    'BR': '🇧🇷', 'AR': '🇦🇷', 'CO': '🇨🇴', 'CL': '🇨🇱', 'PE': '🇵🇪', 
    'VE': '🇻🇪', 'UY': '🇺🇾',
    
    // --- Africa ---
    'ZA': '🇿🇦', 'NG': '🇳🇬', 'KE': '🇰🇪', 'GH': '🇬🇭', 'MA': '🇲🇦', 
    'DZ': '🇩🇿', 'TN': '🇹🇳', 'UG': '🇺🇬', 'TZ': '🇹🇿'
};
        
        flagElement.textContent = flagMap[country] || '';
    }
// ================= MULTI-STATE DYNAMIC ALERTS (ERRORS & WARNINGS) =================

const toastIconMap = {
    'success': 'check_circle',
    'error': 'error',
    'warning': 'warning',
    'info': 'info'
};

function triggerToast(type, title, message) {
    const container = document.getElementById('toast-container');
    if (!container) return; // Failsafe

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const iconName = toastIconMap[type] || 'notifications';

    toast.innerHTML = `
        <div class="toast-icon-wrapper">
            <span class="material-symbols-outlined">${iconName}</span>
        </div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-desc">${message}</div>
        </div>
    `;

    container.prepend(toast);

    // Play entry animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Auto-Remove Timer (4 seconds)
    const removeTimer = setTimeout(() => dismissToast(toast), 4000);

    // Dismiss on click
    toast.addEventListener('click', () => {
        clearTimeout(removeTimer);
        dismissToast(toast);
    });
}

function dismissToast(toast) {
    toast.classList.remove('show');
    toast.style.transform = 'translateY(-20px) scale(0.9)';
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 400);
}
    function applyPenalty() {
        const penaltyEnabled = adminSettings.enablePenalty !== false;
        if (!penaltyEnabled) return;
        
        penaltyActive = true;
        penaltyEndTime = Date.now() + (adminSettings.penaltyDuration || 2) * 60000;
        
        localStorage.setItem('penaltyEndTime', penaltyEndTime.toString());
        
        const startEarningAd = document.getElementById('startEarningAd');
        if (startEarningAd) {
            startEarningAd.disabled = true;
            startEarningAd.classList.add('btn-penalty');
        }
        
        const penaltyWarningCard = document.getElementById('penaltyWarningCard');
        if (penaltyWarningCard) {
            penaltyWarningCard.style.display = 'block';
        }
        
        penaltyInterval = setInterval(updatePenaltyTimer, 1000);
        updatePenaltyTimer();
    }
    
    function updatePenaltyTimer() {
        const now = Date.now();
        const remaining = Math.max(0, penaltyEndTime - now);
        
        if (remaining <= 0) {
            clearPenalty();
            return;
        }
        
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        
        const adButtonText = document.getElementById('adButtonText');
        if (adButtonText) {
            adButtonText.innerHTML = `Wait ${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }
    
    function clearPenalty() {
        penaltyActive = false;
        clearInterval(penaltyInterval);
        
        localStorage.removeItem('penaltyEndTime');
        
        const startEarningAd = document.getElementById('startEarningAd');
        const adButtonText = document.getElementById('adButtonText');
        if (startEarningAd && adButtonText) {
            startEarningAd.disabled = false;
            startEarningAd.classList.remove('btn-penalty');
            adButtonText.textContent = 'Start Ad Task';
        }
        
        const penaltyWarningCard = document.getElementById('penaltyWarningCard');
        if (penaltyWarningCard) {
            penaltyWarningCard.style.display = 'none';
        }
    }
    
    function checkExistingPenalty() {
        const savedPenaltyEndTime = localStorage.getItem('penaltyEndTime');
        if (savedPenaltyEndTime) {
            const remaining = parseInt(savedPenaltyEndTime) - Date.now();
            if (remaining > 0) {
                penaltyEndTime = parseInt(savedPenaltyEndTime);
                applyPenalty();
            } else {
                localStorage.removeItem('penaltyEndTime');
            }
        }
    }
    
    function startAdTimer() {
        adStartTime = Date.now();
        clearInterval(adTimerInterval);
        
        adTimerInterval = setInterval(() => {
            const elapsed = Date.now() - adStartTime;
            if (elapsed >= (adminSettings.adDuration || 15) * 1000) {
                clearInterval(adTimerInterval);
            }
        }, 1000);
    }
    
    function checkAdCompletion() {
        const elapsed = Date.now() - adStartTime;
        clearInterval(adTimerInterval);
        
        const requiredDuration = (adminSettings.adDuration || 15) * 1000;
        if (elapsed < requiredDuration) {
            applyPenalty();
            triggerToast('error', 'Task Cancelled', `Please watch ads for full ${adminSettings.adDuration || 15} seconds.`);
            return false;
        }
        return true;
    }

    function showInstructionsPopup() {
    const popup = document.getElementById('instructionsPopup');
    if (popup) {
        // 1. Force display to FLEX to override existing CSS ID rules
        popup.style.display = 'flex';
        
        // 2. Small delay to allow browser to render 'flex' before adding 'active' for animation
        requestAnimationFrame(() => {
            popup.classList.add('active');
        });
        
        document.body.style.overflow = 'hidden'; // Lock scrolling

        // 3. Animate items sequentially
        const items = popup.querySelectorAll('.guide-item');
        items.forEach((item, index) => {
            item.classList.remove('animate-in');
            item.style.opacity = '0'; // Ensure hidden start
            
            // Stagger animations
            setTimeout(() => {
                item.classList.add('animate-in');
            }, 100 + (index * 60)); 
        });
    }
}

function hideInstructionsPopup() {
    const popup = document.getElementById('instructionsPopup');
    if (popup) {
        // 1. Start fade out animation
        popup.classList.remove('active');
        document.body.style.overflow = '';

        // 2. Wait for animation (300ms) then hide completely
        setTimeout(() => {
            popup.style.display = 'none';
            
            // Reset items for next time
            const items = popup.querySelectorAll('.guide-item');
            items.forEach(item => {
                item.classList.remove('animate-in');
                item.style.opacity = '0';
            });
        }, 300);
    }
}
    // ===================== EVENT LISTENERS =====================
    function setupEventListeners() {
        // 1. Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => showSection(item.dataset.target));
        });

        // 2. Earn Now button (Safety Check)
        const earnNowBtn = document.getElementById('earnNowBtn');
        if (earnNowBtn) {
            earnNowBtn.addEventListener('click', () => showSection('earn-section'));
        }

        // 3. Start Ad Task button
        // ========================================================
        // 3A. MAIN START AD TASK BUTTON (NOW USES ADSGRAM)
        // ========================================================
        const startEarningAd = document.getElementById('startEarningAd');
        const adButtonText = document.getElementById('adButtonText');
        
      if (startEarningAd) {
            startEarningAd.addEventListener('click', async () => {
                if (maintenanceMode) return triggerToast('warning', 'Maintenance', 'App is under maintenance. Please try again later.');
                if (penaltyActive) return triggerToast('warning', 'Penalty Active', 'Please wait until the penalty timer expires to continue');
                if (userData.completedTasks >= userData.totalTasks) return triggerToast('info', 'Daily Limit', 'All tasks completed for today!');

                startEarningAd.disabled = true;
                adButtonText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading ad...';
                
                // Initialize Adsgram (Replace "your-block-id" later)
                if (!window.AdsgramController) {
                    window.AdsgramController = window.Adsgram ? window.Adsgram.init({ blockId: "int-23202" }) : null;
                }

                if (window.AdsgramController) {
                    window.AdsgramController.show().then(async () => {
                        // AD WATCHED SUCCESSFULLY - REWARD USER
                        const earnings = adminSettings.earningsPerAd || 0.05;
                        userData.balance += earnings;
                        userData.totalEarnings += earnings;
                        userData.adsWatched++;
                        userData.completedTasks++;
                        
                        if(typeof HistoryManager !== 'undefined') {
                            HistoryManager.addRecord('ad', earnings, 'Main Video Ad');
                        }
                        
                        await saveUserData();
                        updateUI();
                        showTopNotification(`Earned ${earnings.toFixed(2)} BDT!`);
                        
                        startEarningAd.disabled = false;
                        adButtonText.textContent = 'Start Ad Task';
                        
                  }).catch((error) => {
                        // AD FAILED OR CLOSED EARLY
                        console.error("Adsgram error:", error);
                        triggerToast('error', 'Ad Failed', 'Ad closed early or unavailable.');
                        
                        if (!penaltyActive) {
                            startEarningAd.disabled = false;
                            adButtonText.textContent = 'Start Ad Task';
                        }
                    });
                } else {
                    showTopNotification('Ad system not ready. Please wait.');
                    startEarningAd.disabled = false;
                    adButtonText.textContent = 'Start Ad Task';
                }
            });
        }

        // ========================================================
        // 3B. PREMIUM LIST "WATCH VIDEO" BUTTON (USES OLD LIBTL)
        // ========================================================
        const watchVideoLibtlBtn = document.getElementById('watchVideoLibtlBtn');
        if (watchVideoLibtlBtn) {
            watchVideoLibtlBtn.addEventListener('click', async () => {
                if (maintenanceMode) return triggerToast('warning', 'Maintenance', 'App is under maintenance.');
                if (penaltyActive) return triggerToast('warning', 'Penalty', 'Please wait for penalty to end.');
                
                // UI Loading State (Fades the button out slightly so user knows it clicked)
                watchVideoLibtlBtn.style.opacity = '0.5';
                watchVideoLibtlBtn.style.pointerEvents = 'none';
                
                try {
                    // Execute original LibTL Logic
                    await loadAdSDK(); 
                    startAdTimer();
                    await show_9683040(); 
                    
                    // Check if they closed it early (Triggers penalty if true)
                    if (!checkAdCompletion()) {
                        return; 
                    }
                    
                    // Give Reward
                    const earnings = adminSettings.earningsPerAd || 0.05;
                    userData.balance += earnings;
                    userData.totalEarnings += earnings;
                    userData.adsWatched++; // Counts toward lifetime ads
                    
                    if(typeof HistoryManager !== 'undefined') {
                        HistoryManager.addRecord('ad', earnings, 'Premium Video Ad');
                    }
                    
                    await saveUserData();
                    updateUI();
                    showTopNotification(`Bonus Earned: ${earnings.toFixed(2)} BDT!`);
                    
              } catch (error) {
                    console.error("Libtl error:", error);
                    triggerToast('error', 'Ad Failed', 'Ad failed to load: ' + error.message);
                } finally {
                    // Restore Button UI State
                    watchVideoLibtlBtn.style.opacity = '1';
                    watchVideoLibtlBtn.style.pointerEvents = 'auto';
                }
            });
        }
        
        // 4. NEW Payment Modals (Safe Checks Added)
        const newClosePayment = document.getElementById('new-closeDynamicPaymentModal');
        if (newClosePayment) {
             newClosePayment.addEventListener('click', () => {
                 const modal = document.getElementById('new-dynamicPaymentEditModal');
                 if(modal) modal.classList.remove('active');
             });
        }

        const newSavePayment = document.getElementById('new-saveDynamicPaymentBtn');
        if (newSavePayment) {
            newSavePayment.addEventListener('click', async () => {
                await saveNewDynamicPaymentInfo();
            });
        }

        // 5. Invite friends
        const inviteFriendsBtn = document.getElementById('inviteFriendsBtn');
        if (inviteFriendsBtn) {
            inviteFriendsBtn.addEventListener('click', () => {
                if (maintenanceMode) {
                    showTopNotification('App is under maintenance. Please try again later.');
                    return;
                }
                showTopNotification('Invite feature coming soon!');
            });
        }
        
        // 6. Close dynamic payment modal (Old Logic Safe Check)
        const closeDynamicPaymentModal = document.getElementById('closeDynamicPaymentModal');
        if (closeDynamicPaymentModal) {
            closeDynamicPaymentModal.addEventListener('click', function() {
                const modal = document.getElementById('dynamicPaymentEditModal');
                if (modal) {
                    modal.classList.remove('show');
                    setTimeout(() => {
                        modal.style.display = 'none';
                    }, 300);
                }
            });
        }
        
        // 7. Telegram warning popup buttons
        const telegramWarningOk = document.getElementById('telegramWarningOk');
        if (telegramWarningOk) {
            telegramWarningOk.addEventListener('click', () => {
                document.getElementById('telegramWarningPopup').style.display = 'none';
            });
        }
        
        const telegramWarningGo = document.getElementById('telegramWarningGo');
        if (telegramWarningGo) {
            telegramWarningGo.addEventListener('click', () => {
                window.open('https://t.me/AdVault_3bot', '_blank');
                document.getElementById('telegramWarningPopup').style.display = 'none';
            });
        }
        
        // 8. Instructions popup buttons
        const showInstructions = document.getElementById('showInstructions');
        if (showInstructions) showInstructions.addEventListener('click', showInstructionsPopup);
        
        const closeInstructions = document.getElementById('closeInstructions');
        if (closeInstructions) closeInstructions.addEventListener('click', hideInstructionsPopup);
        
        const instructionsCloseBtn = document.getElementById('instructionsCloseBtn');
        if (instructionsCloseBtn) instructionsCloseBtn.addEventListener('click', hideInstructionsPopup);
        
        // 9. Maintenance popup refresh button
        const refreshMaintenanceBtn = document.getElementById('refreshMaintenanceBtn');
        if (refreshMaintenanceBtn) {
            refreshMaintenanceBtn.addEventListener('click', () => {
                location.reload();
            });
        }
        
        // 10. Refresh balance button
        const refreshBalance = document.getElementById('refreshBalance');
        if (refreshBalance) {
            refreshBalance.addEventListener('click', () => {
                updateUI();
                showTopNotification('Balance refreshed!');
            });
        }
        
        // 11. Notification Close Button (Safe Check)
        const closeNotifBtn = document.getElementById("closeNotificationBtn");
        if (closeNotifBtn) {
            closeNotifBtn.addEventListener("click", window.closeNotificationsModal);
        }
    }

/* ================= Notification System Logic ================= */

let unsubscribeNotifications = null;

// 1. Real-time Listener (Efficient: Only downloads 1 doc to check status)
// 1. Real-time Listener (Efficient: Only downloads 1 doc to check status)
function setupNotificationListener() {
    // If we have a listener already, don't create another
    if (unsubscribeNotifications) return;

    const lastCheck = userData.lastNotificationCheck || new Date(0).toISOString();
    
    // Query: Get notifications newer than the user's last check
    const q = db.collection("adv2_notifications") 
        .where("createdAt", ">", lastCheck)
        .orderBy("createdAt", "desc")
        .limit(1);

    // CRITICAL: We use a flag so we don't spam the user with a popup 
    // for old unread messages the second they open the app.
    let isFirstLoad = true; 

    unsubscribeNotifications = q.onSnapshot((snapshot) => {
        const dot = document.getElementById("notificationDot");
        
        if (!snapshot.empty) {
            // 1. Show the red dot on the bell icon
            if (dot) dot.classList.remove("hidden");
            
            // 2. If the app is already open and a BRAND NEW notification arrives, trigger the popup!
            if (!isFirstLoad) {
                const data = snapshot.docs[0].data();
                const title = data.title || "New Notification";
                
                // Use the premium iOS-style notification engine we built earlier
                showTopNotification(`🔔 New Alert: ${title}`, 5000);
            }
        } else {
            // Hide the red dot if there are no new notifications
            if (dot) dot.classList.add("hidden");
        }
        
        isFirstLoad = false; // Mark initial load as complete
    });
}

// 2. Open Modal & Load Full List
/* ================= NOTIFICATION SYSTEM LOGIC (COMPLETE) ================= */

    // 1. Open Modal & Fetch Data
    /* ================= UPDATED NOTIFICATION LOGIC ================= */

// 1. Open Panel & Fetch Data
async function openNotificationsModal() {
    const overlay = document.getElementById("notifOverlay");
    const listEl = document.getElementById("notificationList");
    const badgeEl = document.getElementById("notifBadgeCount");
    
    // Show overlay
    overlay.classList.add("active");
    
    // Loading State
    listEl.innerHTML = '<div class="flex justify-center py-10"><div class="spinner border-gray-400"></div></div>';

    try {
        // Fetch last 20 notifications from Firebase
        const snapshot = await db.collection("adv2_notifications")
            .orderBy("createdAt", "desc")
            .limit(20)
            .get();

        listEl.innerHTML = ""; // Clear loading

        if (snapshot.empty) {
            listEl.innerHTML = `
                <div class="text-center py-10 text-gray-400">
                    <i class="far fa-bell-slash text-4xl mb-3"></i>
                    <p>No notifications yet</p>
                </div>`;
            if(badgeEl) badgeEl.classList.add('hidden');
        } else {
            if(badgeEl) badgeEl.classList.remove('hidden');
            
            // Render Loop
            let delay = 0;
            snapshot.forEach(doc => {
                const data = doc.data();
                
                // Date Formatting
                let dateStr = "Recent";
                if (data.createdAt) {
                    const dateObj = new Date(data.createdAt);
                    const diffMs = new Date() - dateObj;
                    const diffMins = Math.floor(diffMs / 60000);
                    
                    if(diffMins < 60) dateStr = `${diffMins} mins ago`;
                    else if(diffMins < 1440) dateStr = `${Math.floor(diffMins/60)} hours ago`;
                    else dateStr = dateObj.toLocaleDateString();
                }
                
                // Style Logic
                let typeClass = "icon-info";
                let iconClass = "fa-info-circle";
                const title = (data.title || "").toLowerCase();
                
                if(title.includes("bonus") || title.includes("earned")) { typeClass = "icon-success"; iconClass = "fa-check-circle"; }
                else if(title.includes("alert") || title.includes("failed")) { typeClass = "icon-warn"; iconClass = "fa-exclamation-triangle"; }
                else if(title.includes("promo")) { typeClass = "icon-promo"; iconClass = "fa-gift"; }

                // Create Item
                const item = document.createElement("div");
                item.className = "n-item unread"; // Add 'unread' class for blue strip
                item.style.animationDelay = `${delay}s`; // Stagger animation
                
                item.innerHTML = `
                    <div class="icon-box ${typeClass}">
                        <i class="fas ${iconClass}"></i>
                    </div>
                    <div class="flex-1">
                        <div class="flex justify-between items-start">
                            <h4 class="text-sm font-bold text-slate-800">${data.title || 'Notification'}</h4>
                            <span class="text-[10px] text-slate-400 font-medium">${dateStr}</span>
                        </div>
                        <p class="text-xs text-slate-500 mt-1 leading-relaxed">${data.message || ''}</p>
                    </div>
                `;
                listEl.appendChild(item);
                
                // Trigger Animation
                requestAnimationFrame(() => item.classList.add('animate-in'));
                delay += 0.05;
            });
        }

        // Update "Last Checked" time in database to clear red dot on header
        const nowISO = new Date().toISOString();
        if (userData.id || userData.username) {
            db.collection(USERS_COLLECTION).doc(userData.id || userData.username).update({
                lastNotificationCheck: nowISO
            });
            userData.lastNotificationCheck = nowISO;
        }
        
        // Hide Header Red Dot immediately
        const dot = document.getElementById("notificationDot");
        if(dot) dot.classList.add("hidden");

    } catch (error) {
        console.error("Error loading notifications:", error);
        listEl.innerHTML = '<p class="text-center text-red-500 py-4">Failed to load notifications.</p>';
    }
}

// 2. Close Panel
window.closeNotificationsModal = function() {
    document.getElementById("notifOverlay").classList.remove("active");
};

// 3. Mark All Read (Visual Only)
window.markAllNotificationsRead = function() {
    const items = document.querySelectorAll('.n-item.unread');
    const badge = document.getElementById('notifBadgeCount');
    
    // Remove blue strip styling
    items.forEach(item => {
        item.classList.remove('unread');
        item.style.backgroundColor = '#ffffff'; // Visual feedback
    });

    if(badge) badge.style.display = 'none';
    
    // Feedback
    const btn = document.querySelector('button[onclick="markAllNotificationsRead()"]');
    if(btn) {
        const originalText = btn.innerText;
        btn.innerText = "All read ✓";
        setTimeout(() => btn.innerText = originalText, 2000);
    }
};

// OPTIONAL: Add this to close the modal when clicking the dark background
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById("notificationModal");
    if (modal) {
        modal.addEventListener('click', (e) => {
            // Close if clicking the dark overlay (not the white box)
            if (e.target === modal) {
                window.closeNotificationsModal();
            }
        });
    }
});

// ================= PAYMENT METHODS SECTION LOGIC =================

    let selectedMethodId = null;

    // ================= DYNAMIC MY WALLETS RENDERER =================
    function renderPaymentMethodsPage() {
        const grid = document.getElementById('paymentMethodsGrid');
        const editor = document.getElementById('paymentMethodEditor');
        
        // Hide editor initially
        if (editor) editor.classList.remove('active');
        selectedMethodId = null;
        
        // 1. Get Methods from Admin (or use defaults)
        let methods = adminSettings.paymentMethods || [];
        if (methods.length === 0) {
            methods = [
                { id: 'bkash', name: 'bKash', icon: 'fas fa-mobile-alt', color: '#E2136E', type: 'number' },
                { id: 'nagad', name: 'Nagad', icon: 'fas fa-wallet', color: '#F8A01C', type: 'number' },
                { id: 'rocket', name: 'Rocket', icon: 'fas fa-rocket', color: '#8C34FF', type: 'number' },
                { id: 'paypal', name: 'PayPal', icon: 'fab fa-paypal', color: '#003087', type: 'email' }
            ];
        }

        if (!grid) return;
        grid.innerHTML = '';

        methods.forEach(method => {
            const currentVal = userData.paymentInfo[method.id] || '';
            const isLinked = currentVal.length > 0;
            
            // 2. GET DYNAMIC COLORS & ICONS
            const brandColor = method.color || '#64748b'; // Default to Slate if missing
            const iconClass = method.icon || 'fas fa-credit-card';
            
            // 3. Mask the Account Number (Privacy)
            let displayVal = 'Not Linked';
            if(isLinked) {
                if(currentVal.includes('@')) {
                    const parts = currentVal.split('@');
                    displayVal = parts[0].slice(0,3) + '***@' + parts[1];
                } else {
                    displayVal = currentVal.slice(0,3) + ' •••• ' + currentVal.slice(-3);
                }
            }

            const card = document.createElement('div');
            card.className = 'wallet-card'; // Keeps base shape/padding
            
            // 4. APPLY DYNAMIC STYLING (The Fix)
            // Use the brand color with a subtle gradient overlay for depth
            card.style.backgroundColor = brandColor;
            card.style.backgroundImage = `linear-gradient(135deg, transparent 0%, rgba(0,0,0,0.2) 100%)`;
            card.style.boxShadow = `0 10px 20px -5px ${brandColor}66`; // Colored Shadow with transparency
            card.style.borderColor = 'transparent'; // Reset border
            
            card.onclick = () => {
                selectPaymentCard(method, currentVal, card);
                // Add white border on selection to stand out against color
                card.style.borderColor = 'rgba(255,255,255,0.8)';
            };
            
            card.innerHTML = `
                <div class="card-logo-area">
                    <div class="card-icon" style="background: rgba(255,255,255,0.2); color: white;">
                        <i class="${iconClass}"></i>
                    </div>
                    <div class="card-badge" style="background: rgba(0,0,0,0.2); color: white; backdrop-filter: blur(4px);">
                        ${isLinked ? '<i class="fas fa-check-circle"></i> Linked' : '<i class="fas fa-plus"></i> Add'}
                    </div>
                </div>
                <div class="card-details">
                    <div class="card-label" style="color: rgba(255,255,255,0.9);">${method.name} ${method.type === 'email' ? 'Email' : 'Number'}</div>
                    <div class="card-number" style="color: white; letter-spacing: 1px;">${displayVal}</div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    function selectPaymentCard(method, currentVal, cardElement) {
        // 1. Visual Selection
        document.querySelectorAll('.wallet-card').forEach(c => c.classList.remove('selected'));
        cardElement.classList.add('selected');
        
        // 2. Setup Editor
        selectedMethodId = method.id;
        const editor = document.getElementById('paymentMethodEditor');
        const label = document.getElementById('editMethodLabel');
        const input = document.getElementById('editMethodValue');
        const hiddenId = document.getElementById('editMethodId');

        label.textContent = `${method.name} ${method.type === 'email' ? 'Email Address' : 'Wallet Number'}`;
        input.value = currentVal;
        input.placeholder = method.type === 'email' ? 'example@mail.com' : '01XXXXXXXXX';
        hiddenId.value = method.id;

        // 3. Show Editor (Slide Up)
        editor.classList.add('active');
        
        // Scroll to bottom to ensure editor is visible
        const section = document.getElementById('payment-methods-section');
        section.scrollTo({ top: section.scrollHeight, behavior: 'smooth' });
    }

    async function saveCurrentPaymentMethod() {
        if (!selectedMethodId) return;

        const val = document.getElementById('editMethodValue').value.trim();
        const btn = document.querySelector('#paymentEditForm button');
        
        // Simple Validation
        if (val.length < 5) {
            showTopNotification("Please enter a valid detail");
            return;
        }

        // UI Loading State
        const oldHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        btn.disabled = true;

        // Update Data
        userData.paymentInfo[selectedMethodId] = val;
        
        // Backward compatibility
        if(selectedMethodId === 'bkash') userData.bkash = val;
        if(selectedMethodId === 'paypal') userData.paypal = val;

        try {
            await saveUserData();
            showSuccessPopup("Wallet Updated!");
            
            // Refresh Grid to show new masked value
            renderPaymentMethodsPage();
            
            // Also update main profile text
            renderProfilePaymentMethods();
            
        } catch (e) {
            showTopNotification("Failed to save. Try again.");
        } finally {
            btn.innerHTML = oldHtml;
            btn.disabled = false;
        }
    }

    async function clearCurrentPaymentMethod() {
        if (!selectedMethodId) return;
        
        if(!confirm("Are you sure you want to unlink this account?")) return;

        delete userData.paymentInfo[selectedMethodId];
        // Backward compatibility
        if(selectedMethodId === 'bkash') userData.bkash = "";
        if(selectedMethodId === 'paypal') userData.paypal = "";

        await saveUserData();
        showTopNotification("Account unlinked.");
        
        // Reset UI
        document.getElementById('editMethodValue').value = "";
        renderPaymentMethodsPage();
        renderProfilePaymentMethods();
    }
    // ===================== INITIALIZE APP =====================
    async function initApp() {
    /* ================= LOADING SCREEN LOGIC ================= */

    /* ================= LOADING SCREEN LOGIC (OPTIMIZED) ================= */

    window.addEventListener('load', () => {
        const bar = document.getElementById('loadingBar');
        const text = document.getElementById('loadingStatus');
        const screen = document.getElementById('splashScreen');
        
        // Lock scroll
        document.body.style.overflow = 'hidden';

        let progress = 0;
        
        // Use requestAnimationFrame for buttery smooth 60fps animation
        function animateLoad() {
            // Increment speed (randomized for realism)
            progress += Math.random() * 2.5; 
            
            if (progress > 100) progress = 100;
            
            // Update DOM
            if(bar) bar.style.width = progress + '%';

            // Update Text (Reduced layout thrashing)
            if(text) {
                if (progress < 30) {
                    if(text.innerText !== "Connecting...") text.innerText = "Connecting...";
                } else if (progress < 60) {
                    if(text.innerText !== "Verifying User...") text.innerText = "Verifying User...";
                } else if (progress < 90) {
                    if(text.innerText !== "Syncing Data...") text.innerText = "Syncing Data...";
                } else {
                    if(text.innerText !== "Finalizing...") text.innerText = "Finalizing...";
                }
            }

            if (progress < 100) {
                requestAnimationFrame(animateLoad);
            } else {
                // Done
                setTimeout(() => {
                    if(screen) {
                        screen.classList.add('fade-out-up');
                        // Force GPU layer removal after animation
                        screen.style.willChange = 'auto'; 
                    }
                    document.body.style.overflow = 'auto';
                    setTimeout(() => { 
                        if(screen) screen.style.display = 'none'; 
                    }, 600);
                }, 200);
            }
        }
        
        // Start the engine
        requestAnimationFrame(animateLoad);
    });
        document.getElementById('header-username').textContent = "Loading...";
        
        checkExistingPenalty();
        await loadAdminSettings();
        setupAdminSettingsListener();
        
        const isTelegram = await initTelegram();
        let telegramUserData = null;
        let telegramDetected = false;
        
        if (isTelegram) {
            telegramUserData = getTelegramUserData();
            telegramDetected = !!telegramUserData;
        }
        
        if (!telegramDetected) {
            document.getElementById('telegramWarningPopup').style.display = 'flex';
        }
        
        if (telegramUserData) {
            document.getElementById('telegramConnected').style.display = 'block';
            setTimeout(() => {
                document.getElementById('telegramConnected').style.display = 'none';
            }, 3000);
            
            userData.id = telegramUserData.id;
            userData.name = telegramUserData.name;
            userData.username = telegramUserData.username;
            userData.telegramDetected = true;
            userData.source = "telegram";
            
            if (telegramUserData.photoUrl) {
                userData.profilePhoto = telegramUserData.photoUrl;
            }
            
            showTopNotification(`Welcome ${telegramUserData.username}!`);
            await loadUserData(userData.id);
        }
        
       // ... (telegram logic above remains same) ...
        
        // --- UPDATED FALLBACK LOGIC ---
        if (!userData.username) {
            // Setup Guest User (In-Memory Only)
            userData.username = "Guest";
            userData.source = "web";
            userData.telegramDetected = false; // Enforce false
            
            console.log("Guest Mode Initialized: No Firestore connection.");
            
            // HIDE LOADER MANUALLY (Since we are skipping loadUserData)
            document.getElementById("firebaseLoading").style.display = "none";
            
            // Optional: Show a subtle notification
            // showTopNotification("Guest Mode: Progress will not be saved.");
        }
        
        updateUI();
        userCountry = await detectCountry();
        setCountryFlag(userCountry);
        
        // Save country ONLY if Telegram detected (Re-using our safe save function)
        if (userCountry && userData.country !== userCountry) {
            userData.country = userCountry;
            saveUserData(); 
        }
        
        checkDailyReset();
        setupEventListeners();
        
        const closeBtn = document.getElementById("closeNotificationBtn");
        if (closeBtn) {
            closeBtn.addEventListener("click", window.closeNotificationsModal);
        }
        
        // Only setup listeners for real users
        if (userData.telegramDetected) {
            setupNotificationListener();
        }
        
        showSection('home-section');
    }

    // Start the app
    document.addEventListener('DOMContentLoaded', initApp);
    /* ================= HISTORY MANAGER (LOCAL STORAGE) ================= */
    const HistoryManager = {
        KEY: 'adv_earning_history_v1',
        RETENTION_HOURS: 72,

        // Save a new record
        addRecord: function(type, amount, title) {
            try {
                const now = new Date();
                const record = {
                    id: Date.now() + Math.random().toString(36).substr(2, 5),
                    type: type, // 'ad' or 'task'
                    amount: parseFloat(amount),
                    title: title,
                    timestamp: now.toISOString()
                };

                // Get existing
                let history = this.getHistory();
                
                // Add new to top
                history.unshift(record);
                
                // Prune old data
                history = this.pruneHistory(history);
                
                // Save back
                localStorage.setItem(this.KEY, JSON.stringify(history));
                return true;
            } catch (e) {
                console.error("Save history failed", e);
                return false;
            }
        },

        // Get all history
        getHistory: function() {
            try {
                const raw = localStorage.getItem(this.KEY);
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        },

        // Remove items older than 72 hours
        pruneHistory: function(list) {
            const cutoff = new Date();
            cutoff.setHours(cutoff.getHours() - this.RETENTION_HOURS);
            return list.filter(item => new Date(item.timestamp) > cutoff);
        },
        
        // Calculate total for display
        getRecentTotal: function() {
            const list = this.getHistory();
            return list.reduce((sum, item) => sum + (item.amount || 0), 0);
        }
    };

    // Render Function for UI
    function renderEarningHistory(filterType = 'all') {
        const container = document.getElementById('earningHistoryContainer');
        const totalDisplay = document.getElementById('history-total-72h');
        
        // 1. Get Data
        let data = HistoryManager.getHistory();
        
        // 2. Update Total
        if(totalDisplay) {
            const total = HistoryManager.getRecentTotal();
            totalDisplay.textContent = `+ BDT ${total.toFixed(2)}`;
        }
        
        // 3. Apply Filter
        if (filterType !== 'all') {
            data = data.filter(item => item.type === filterType);
        }
        
        // 4. Group by Date
        container.innerHTML = '';
        
        if (data.length === 0) {
            container.innerHTML = `
                <div class="text-center py-10 opacity-50">
                    <i class="fas fa-history text-4xl mb-3 text-gray-300"></i>
                    <p class="text-gray-500">No records found</p>
                </div>`;
            return;
        }

        let currentDate = '';
        
        data.forEach(item => {
            const dateObj = new Date(item.timestamp);
            // Check if date header needed
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const isToday = new Date().toDateString() === dateObj.toDateString();
            const displayDate = isToday ? 'Today' : dateStr;
            
            if (displayDate !== currentDate) {
                currentDate = displayDate;
                container.innerHTML += `
                    <div class="date-header">
                        <span>${displayDate}</span>
                        <span class="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-400">${dateStr}</span>
                    </div>`;
            }

            // Render Item
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const iconClass = item.type === 'ad' ? 'icon-ad' : 'icon-task';
            const iconHTML = item.type === 'ad' ? '<i class="fas fa-play"></i>' : '<i class="fas fa-star"></i>';
            
            container.innerHTML += `
                <div class="history-item">
                    <div class="item-icon ${iconClass}">
                        ${iconHTML}
                    </div>
                    <div class="item-meta">
                        <p class="item-title">${item.title}</p>
                        <p class="item-time">${timeStr}</p>
                    </div>
                    <div class="item-amount">
                        <p class="amt-val">+${item.amount.toFixed(2)}</p>
                        <p class="amt-status">Added</p>
                    </div>
                </div>`;
        });
    }
    
    // Tab Switching Logic
    window.filterEarningHistory = function(type, btnElement) {
        // Update UI
        document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
        btnElement.classList.add('active');
        // Render
        renderEarningHistory(type);
    }
    // ================= NEW WITHDRAWAL LOGIC =================

    let selectedWithdrawMethod = null;

    // 1. Initialize the Withdrawal Page
   
    function renderWithdrawPage() {
        const grid = document.getElementById('withdrawMethodGrid');
        const balanceDisplay = document.getElementById('withdraw-balance-display');
        const minDisplay = document.getElementById('minWithdrawDisplay');
        
        // Update Balance
        if(balanceDisplay) balanceDisplay.textContent = `BDT ${userData.balance.toFixed(2)}`;
        
        // 1. READ SETTINGS FROM ADMIN (This connects your Admin Panel to the App)
        let methods = adminSettings.paymentMethods || [];
        
        // Fallback if no methods exist yet
        if (methods.length === 0) {
            methods = [
                { id: 'bkash', name: 'bKash', icon: 'fas fa-mobile-alt', color: '#E2136E', minWithdraw: 100 },
                { id: 'nagad', name: 'Nagad', icon: 'fas fa-wallet', color: '#F8A01C', minWithdraw: 100 }
            ];
        }
        
        // Update Min Withdraw Text
        const defaultMin = methods[0]?.minWithdraw || 100;
        if(minDisplay) minDisplay.textContent = defaultMin.toFixed(2);

        // 2. RENDER GRID
        if(grid) {
            grid.innerHTML = '';
            methods.forEach((method, index) => {
                const card = document.createElement('div');
                
                // Auto-select first method
                if (index === 0) selectedWithdrawMethod = method;
                const isSelected = selectedWithdrawMethod?.id === method.id;
                
                // USE THE SAVED COLOR
                const brandColor = method.color || '#64748b'; 
                const iconClass = method.icon || 'fas fa-wallet';

                // Apply Styles
                card.className = `method-card ${isSelected ? 'selected' : ''}`;
                
                // Apply Color to Border/Shadow if selected
                if(isSelected) {
                    card.style.borderColor = brandColor;
                    card.style.backgroundColor = 'rgba(255,255,255,1)';
                    card.style.boxShadow = `0 4px 12px -2px ${brandColor}40`; 
                }

                card.onclick = () => selectWithdrawMethod(method, card);
                
                card.innerHTML = `
                    <div class="check-badge" style="color: ${brandColor}; display: ${isSelected ? 'block' : 'none'};">
                        <i class="fas fa-check-circle"></i>
                    </div>
                    
                    <div class="method-icon" style="color: ${brandColor}">
                    <i class="${iconClass}"></i>
                    </div>
                    <span class="method-name">${method.name}</span>
                `;
                grid.appendChild(card);
            });
        }
        
        updateSendingToBox();
        renderMiniHistory();
    }
    // 2. Select Method Logic
    
    function selectWithdrawMethod(method, cardElement) {
        selectedWithdrawMethod = method;
        const brandColor = method.color || '#64748b';
        
        // 1. Reset all cards
        document.querySelectorAll('.method-card').forEach(c => {
            c.classList.remove('selected');
            c.style.borderColor = '#e2e8f0'; // Reset to grey
            c.style.boxShadow = 'none';
            c.style.backgroundColor = 'white';
            
            // Hide checks
            const badge = c.querySelector('.check-badge');
            if(badge) badge.style.display = 'none';
        });
        
        // 2. Highlight clicked card with ITS COLOR
        cardElement.classList.add('selected');
        cardElement.style.borderColor = brandColor;
        cardElement.style.boxShadow = `0 4px 12px -2px ${brandColor}40`;
        
        // Show check badge
        const badge = cardElement.querySelector('.check-badge');
        if(badge) {
            badge.style.display = 'block';
            badge.style.color = brandColor;
        }
        
        // 3. Update Info Box
        updateSendingToBox();
    }
    // 3. Update "Sending To" Info
    function updateSendingToBox() {
        if(!selectedWithdrawMethod) return;
        
        const box = document.getElementById('sendingToBox');
        const msg = document.getElementById('linkAccountMsg');
        const numDisplay = document.getElementById('sendingToNumber');
        
        const linkedNum = userData.paymentInfo[selectedWithdrawMethod.id] || 
                          (selectedWithdrawMethod.id === 'bkash' ? userData.bkash : '') ||
                          (selectedWithdrawMethod.id === 'paypal' ? userData.paypal : '');

        if (linkedNum && linkedNum.length > 2) {
            box.classList.remove('hidden');
            msg.classList.add('hidden');
            numDisplay.textContent = linkedNum;
        } else {
            box.classList.add('hidden');
            msg.classList.remove('hidden');
        }
    }

    // 4. Quick Amount Logic
    function setWithdrawAmount(amt) {
        const input = document.getElementById('withdrawAmountInput');
        
        // Reset pills
        document.querySelectorAll('.pill-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');

        if (amt === 'max') {
            input.value = Math.floor(userData.balance);
        } else {
            input.value = amt;
        }
        updateWithdrawSummary();
    }

    // 5. Update Summary Logic
    function updateWithdrawSummary() {
        const input = document.getElementById('withdrawAmountInput');
        const amount = parseFloat(input.value) || 0;
        
        document.getElementById('summaryAmount').textContent = `BDT ${amount.toFixed(2)}`;
        document.getElementById('summaryTotal').textContent = `BDT ${amount.toFixed(2)}`;
        // If you implement fees later, update logic here
    }
    // ================= WITHDRAWAL SUBMISSION LOGIC =================

async function submitWithdrawal() {
    // 1. Validation Checks
    if (!selectedWithdrawMethod) {
        triggerToast('warning', 'Method Required', 'Please select a payment method');
        return;
    }

    const input = document.getElementById('withdrawAmountInput');
    const amount = parseFloat(input.value);
    const minWithdraw = selectedWithdrawMethod.minWithdraw || 100;

    // Check Amount
    if (isNaN(amount) || amount <= 0) {
        triggerToast('error', 'Invalid Amount', 'Please enter a valid amount');
        return;
    }

    if (amount < minWithdraw) {
        triggerToast('warning', 'Amount Too Low', `Minimum withdrawal is BDT ${minWithdraw}`);
        return;
    }

    // Check Balance
    if (amount > userData.balance) {
        triggerToast('error', 'Insufficient Funds', 'Insufficient balance for this withdrawal');
        return;
    }

    // 2. Check if Account is Linked
    const methodId = selectedWithdrawMethod.id;
    // Look in paymentInfo object first, then fallback to old fields
    const accountNum = (userData.paymentInfo && userData.paymentInfo[methodId]) 
                       || userData[methodId] 
                       || userData.paymentInfo?.[methodId.toLowerCase()]; 

    if (!accountNum) {
         triggerToast('warning', 'Account Needed', `Please link your ${selectedWithdrawMethod.name} account first`);
         // Redirect to link page
         showSection('payment-methods-section');
         renderPaymentMethodsPage();
         return;
    }

    // 3. UI Loading State

    // 3. UI Loading State
    const btn = document.querySelector('.withdraw-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
        // 4. Firebase Batch Update (Atomic Operation)
        const batch = db.batch();
        
        // A. Update User Balance
        const userRef = db.collection(USERS_COLLECTION).doc(userData.id || userData.username);
        const newBalance = userData.balance - amount;
        const newWithdrawn = (userData.totalWithdrawn || 0) + amount;
        
        batch.update(userRef, {
            balance: newBalance,
            totalWithdrawn: newWithdrawn,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });

        // B. Create Withdrawal Record
        const withdrawRef = db.collection(WITHDRAWALS_COLLECTION).doc();
        batch.set(withdrawRef, {
            userId: userData.id || userData.username,
            username: userData.username,
            amount: amount,
            method: selectedWithdrawMethod.name,
            methodId: methodId,
            accountNumber: accountNum,
            status: 'pending',
            timestamp: new Date().toISOString(),
            fee: 0, // Set fee logic here if needed
            deviceSource: 'web_app_v2'
        });

        // Commit changes
        await batch.commit();

        // 5. Update Local Data & UI
        userData.balance = newBalance;
        userData.totalWithdrawn = newWithdrawn;
        
        updateUI(); // Refresh header/profile balance
        input.value = ''; // Clear input
        document.getElementById('summaryAmount').innerText = 'BDT 0.00';
        document.getElementById('summaryTotal').innerText = 'BDT 0.00';
        
        // 6. Show Success & Refresh History
        if (typeof fetchWithdrawalHistory === 'function') fetchWithdrawalHistory();
        if (typeof renderMiniHistory === 'function') renderMiniHistory();

        // Trigger the new Success Modal
        const successModal = document.getElementById('new-successModal');
        if(successModal) {
            successModal.classList.add('active');
        } else {
            showSuccessPopup(`Withdrawal of BDT ${amount} submitted!`);
        }

    } catch (error) {
        console.error("Withdrawal failed:", error);
        triggerToast('error', 'Network Error', 'Network error. Please try again.');
    } finally {
        // Reset Button
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}
    // 6. Mini History Renderer
    function renderMiniHistory() {
        const container = document.getElementById('miniWithdrawHistory');
        if(!container) return;
        
        // Use the global variable we populated in Fix 2
        // Slice(0, 2) to take only the top 2 items
        const list = (typeof globalWithdrawalHistory !== 'undefined') ? globalWithdrawalHistory.slice(0, 2) : [];
        
        container.innerHTML = '';
        if(list.length === 0) {
            container.innerHTML = '<p class="text-xs text-center text-slate-400 py-4 bg-white rounded-xl border border-gray-100">No recent transactions</p>';
            return;
        }

        list.forEach(item => {
            const isSuccess = item.status === 'approved' || item.status === 'completed';
            const statusColor = isSuccess ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600';
            const icon = isSuccess ? 'fa-check' : 'fa-clock';
            const statusText = item.status || 'Pending';
            
            container.innerHTML += `
              <div class="history-item" style="background: white; padding: 1rem; border-radius: 1rem; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between; border: 1px solid #f1f5f9; box-shadow: 0 2px 4px rgba(0,0,0,0.01);">
                  <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full ${statusColor} flex items-center justify-center">
                          <i class="fas ${icon}"></i>
                      </div>
                      <div>
                          <p class="text-sm font-bold text-slate-800 capitalize">${item.method}</p>
                          <p class="text-xs text-slate-400">${new Date(item.date).toLocaleDateString()}</p>
                      </div>
                  </div>
                  <div class="text-right">
                      <p class="text-sm font-bold text-slate-800">-${item.amount}</p>
                      <p class="text-[10px] font-bold uppercase ${isSuccess ? 'text-green-600' : 'text-yellow-600'}">
                        ${statusText}
                      </p>
                  </div>
              </div>`;
        });
    }

    // Hook this new render function to your showSection logic
    // Add this line inside your showSection function for 'withdraw-section':
    // if (sectionId === 'withdraw-section') renderWithdrawPage();
    
    /* ================= SYSTEM ALERTS LOGIC ================= */

    // 1. Trigger Error Modal
    // 1. Trigger Error Modal
    function triggerError(title, msg) {
        triggerToast('error', title || 'System Error', msg);
    }
    // 2. Trigger Confirmation Modal
    let onConfirmCallback = null; // Store the function to run

    function triggerConfirm(title, msg, callback) {
        const modal = document.getElementById('confirmModal');
        
        // Update Text
        if(title) document.getElementById('confirmTitle').textContent = title;
        if(msg) document.getElementById('confirmMsg').textContent = msg;
        
        // Show Modal
        modal.classList.add('show');
        
        // Store callback
        if (callback) {
            onConfirmCallback = callback;
        } else {
            onConfirmCallback = () => { console.log("Confirmed!"); };
        }
    }

    // Executed when user clicks "Yes"
    function confirmAction() {
        if (onConfirmCallback) onConfirmCallback();
        closeModal('confirmModal');
    }

    // 3. Generic Close Function
    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
        }
    }
    
    // Example Usage:
    // triggerConfirm("Log Out?", "Are you sure you want to exit?", () => { performLogout(); });

// ================= WITHDRAWAL SECTION LOGIC =================

    // 1. Render the Payment Grid with Admin Colors
    function renderWithdrawSection() {
        const grid = document.getElementById('paymentMethodsGrid');
        if (!grid) return;

        // Get methods from Admin Settings (or use defaults if loading/empty)
        // We use 'contentSettings' which is loaded from Firestore in your init()
        const methods = (typeof contentSettings !== 'undefined' && contentSettings.paymentMethods && contentSettings.paymentMethods.length > 0) 
            ? contentSettings.paymentMethods 
            : [
                { id: 'bkash', name: 'bKash', icon: 'fas fa-mobile-alt', color: '#E2136E', type: 'number', minWithdraw: 100 },
                { id: 'nagad', name: 'Nagad', icon: 'fas fa-mobile-alt', color: '#F7921E', type: 'number', minWithdraw: 100 },
                { id: 'rocket', name: 'Rocket', icon: 'fas fa-rocket', color: '#8C3494', type: 'number', minWithdraw: 100 },
                { id: 'binance', name: 'Binance', icon: 'fab fa-bitcoin', color: '#F0B90B', type: 'text', minWithdraw: 500 }
              ];

        grid.innerHTML = methods.map(method => {
            // Default color if missing
            const color = method.color || '#64748b'; 
            // Default icon if missing
            const icon = method.icon || 'fas fa-wallet';

            return `
            <div class="method-card" 
                 id="method-${method.id}" 
                 onclick="selectPaymentMethod('${method.id}', '${method.type}', '${method.minWithdraw || 100}', '${color}')"
                 data-color="${color}">
                 
                <div class="check-badge" style="color: ${color}">
                    <i class="fas fa-check-circle"></i>
                </div>
                
                <i class="${icon} method-icon" style="color: ${color}; font-size: 1.75rem; margin-bottom: 0.5rem;"></i>
                
                <span class="method-name" style="font-size: 0.75rem; font-weight: 600; color: #475569;">${method.name}</span>
            </div>
            `;
        }).join('');
    }

    // 2. Handle Card Clicks (Highlighting & Inputs)
    let selectedPaymentMethodId = null;

    function selectPaymentMethod(id, type, min, color) {
        selectedPaymentMethodId = id;
        
        // Reset all cards
        document.querySelectorAll('.method-card').forEach(card => {
            card.classList.remove('selected');
            card.style.borderColor = '#e2e8f0';
            card.style.backgroundColor = 'white';
            card.style.boxShadow = 'none';
        });

        // Highlight active card
        const card = document.getElementById(`method-${id}`);
        if (card) {
            card.classList.add('selected');
            card.style.borderColor = color;
            // Light background tint
            card.style.backgroundColor = hexToRgba(color, 0.05);
            card.style.boxShadow = `0 4px 10px -2px ${hexToRgba(color, 0.2)}`;
        }

        // Show Input Fields
        const inputContainer = document.getElementById('paymentDetailsContainer');
        const label = document.getElementById('paymentInputLabel');
        const input = document.getElementById('paymentDetails');
        const minLabel = document.getElementById('minWithdrawLabel');
        
        if(inputContainer) inputContainer.style.display = 'block';
        if(input) input.value = ''; // Clear old input
        
        // Update Label based on Type
        if (label && input) {
            if (type === 'number') {
                label.innerText = 'Enter Wallet Number';
                input.placeholder = 'e.g. 017xxxxxxxx';
                input.type = 'tel';
            } else if (type === 'email') {
                label.innerText = 'Enter Email Address';
                input.placeholder = 'e.g. user@example.com';
                input.type = 'email';
            } else {
                label.innerText = 'Enter Wallet ID / Address';
                input.placeholder = 'Wallet ID...';
                input.type = 'text';
            }
        }

        // Update Min Withdraw Text
        if(minLabel) minLabel.innerText = `Min: ${min} BDT`;
    }

    // 3. Helper for Colors
    function hexToRgba(hex, alpha) {
        let c;
        if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
            c= hex.substring(1).split('');
            if(c.length== 3){
                c= [c[0], c[0], c[1], c[1], c[2], c[2]];
            }
            c= '0x'+c.join('');
            return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+alpha+')';
        }
        return `rgba(0,0,0,${alpha})`;
    }
    // --- MISSING ALERT HISTORY FUNCTIONS ---

/* REPLACE YOUR renderNotifHistory FUNCTION WITH THIS */
function renderNotifHistory() {
    // 1. Locate the Container
    const list = document.getElementById('notif-history-list');
    if (!list) return;

    // 2. Load Data (Crash Proof)
    let history = [];
    try {
        const raw = localStorage.getItem('advault_notif_history');
        if (raw) history = JSON.parse(raw);
        if (!Array.isArray(history)) history = [];
    } catch (e) {
        history = [];
    }

    // 3. Render HTML
    list.innerHTML = ''; // Clear existing

    if (history.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 opacity-50">
                <div class="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4 text-slate-400">
                    <i class="fas fa-bell-slash text-2xl"></i>
                </div>
                <h3 class="text-slate-600 font-bold text-lg">No Alerts Yet</h3>
            </div>`;
    } else {
        list.innerHTML = history.map((item, index) => {
            let iconClass = "bg-blue-50 text-blue-500";
            let icon = "fa-bell";

            if (item.type === 'security') { 
                iconClass = "bg-red-50 text-red-500"; 
                icon = "fa-exclamation-triangle"; 
            } else if (item.type === 'earning' || item.type === 'success') { 
                iconClass = "bg-green-50 text-green-500"; 
                icon = "fa-check-circle"; 
            }

            let timeStr = "";
            try { 
                timeStr = new Date(item.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}); 
            } catch(e) {}

            return `
                <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex gap-3 mb-3 animate-fade-in">
                    <div class="w-10 h-10 rounded-xl ${iconClass} flex items-center justify-center shrink-0">
                        <i class="fas ${icon} text-sm"></i>
                    </div>
                    <div class="flex-1">
                        <div class="flex justify-between items-start">
                            <h4 class="text-sm font-bold text-slate-800">${item.title || 'Alert'}</h4>
                            <span class="text-[10px] text-slate-400 font-bold uppercase">${timeStr}</span>
                        </div>
                        <p class="text-xs text-slate-500 mt-1">${item.message || ''}</p>
                    </div>
                </div>`;
        }).join('');
    }

    
    console.log("Render Complete. Items count:", history.length);
}
function clearNotifHistory() {
    if(confirm("Are you sure you want to delete all history?")) {
        localStorage.removeItem('advault_notif_history');
        renderNotifHistory(); // Re-render to show empty state
    }
}
// --- ABOUT MODAL LOGIC ---

/* ================= ABOUT MODAL LOGIC ================= */

function openAboutModal() {
    const modal = document.getElementById('aboutModal');
    const card = document.getElementById('aboutModalCard');
    
    if (!modal) {
        console.error("About Modal not found!");
        return;
    }

    // 1. Get Data
    const info = adminSettings.appInfo || {};
    const version = info.version || "2.5.0";
    const date = info.lastUpdate || "Jan 2026";
    const channel = info.channel || "https://t.me/AdVault_Channel";

    // 2. Update Text
    if (document.getElementById('about-version')) document.getElementById('about-version').textContent = version;
    if (document.getElementById('about-date')) document.getElementById('about-date').textContent = date;
    if (document.getElementById('about-channel-btn')) document.getElementById('about-channel-btn').href = channel;

    // 3. FORCE DISPLAY (Overrides any conflicting CSS)
    modal.classList.remove('hidden');
    modal.style.display = 'flex'; 
    modal.style.opacity = '1'; 
    modal.style.pointerEvents = 'auto';
    
    // Animate Card
    if (card) {
        card.style.transform = 'scale(1)';
        card.style.opacity = '1';
    }
}

function closeAboutModal() {
    const modal = document.getElementById('aboutModal');
    const card = document.getElementById('aboutModalCard');
    
    if (modal) {
        modal.style.opacity = '0';
        modal.style.pointerEvents = 'none';
        
        if (card) card.style.transform = 'scale(0.9)';
        
        setTimeout(() => {
            modal.style.display = 'none';
            modal.classList.add('hidden');
        }, 300);
    }
}
function openCommunityGroup() {
    // 1. Get Link from Admin Panel Settings
    // If Admin hasn't set one, it falls back to your default
    const groupLink = adminSettings.appInfo?.group || "https://t.me/AdVault_Group";
    
    // 2. Open it
    window.open(groupLink, '_blank');
}

// Add this to the very bottom of adv.js
window.addEventListener('DOMContentLoaded', () => {
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.expand();
        tg.setHeaderColor('#ffffff'); // Use '#0f172a' for dark mode
        tg.ready();
    }
});
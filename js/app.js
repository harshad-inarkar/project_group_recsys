import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, arrayUnion, arrayRemove, collection, query, where, documentId } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCmrY4OLmNdTFS_jBQdzAKMMtARAegB5kw",
    authDomain: "project-group-4ab7c.firebaseapp.com",
    projectId: "project-group-4ab7c",
    storageBucket: "project-group-4ab7c.firebasestorage.app",
    messagingSenderId: "714689701833",
    appId: "1:714689701833:web:dc3ee180c4f83e515f6a18"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
window.auth = auth;

const WEBHOOK_EMBED_PROFILE = "https://harshad-agentic-demo.app.n8n.cloud/webhook/embed-profile";
const WEBHOOK_GET_RECO = "https://harshad-agentic-demo.app.n8n.cloud/webhook/get-recommendations";

let currentUserProfile = null;

// Utility: Professional Toast Notifications
function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type} show`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 3000);
}

// Handle UI State based on login
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            document.getElementById("auth-section").classList.add("hidden");
            document.getElementById("app-section").classList.remove("hidden");
            document.getElementById("welcome-msg").innerText = "Loading profile data...";

            await loadUserProfile(user.uid);
        } catch (error) {
            console.error("Critical Auth Error:", error);
            showToast("Error loading dashboard: " + error.message, "error");
        }
    } else {
        document.getElementById("auth-section").classList.remove("hidden");
        document.getElementById("app-section").classList.add("hidden");
        currentUserProfile = null;
    }
});

// Registration
document.getElementById("btn-register").addEventListener("click", async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const name = document.getElementById("name").value.trim();

    if (!email || !password || !name) {
        return showToast("Email, Password, and Full Name are required.", "error");
    }

    const userData = {
        name: name,
        exp: document.getElementById("exp").value,
        city: document.getElementById("city").value,
        background: document.getElementById("background").value,
        current_domain: document.getElementById("domain").value,
        project_domain: document.getElementById("proj_domain").value,
        project_desc: document.getElementById("proj_desc").value,
        status: "open",
        partner_uid: null,
        interests_received: [],
        interests_sent: []
    };

    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        userData.uid = userCred.user.uid;

        await setDoc(doc(db, "users", userCred.user.uid), userData);

        const combinedText = `Experience: ${userData.exp}, City: ${userData.city}, Domain: ${userData.current_domain}, Project: ${userData.project_desc}`;
        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: userData.uid, combinedText: combinedText, status: userData.status })
        });

        showToast("Profile created successfully!");
    } catch (error) {
        showToast(error.message, "error");
    }
});

// Login
document.getElementById("btn-login").addEventListener("click", async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    if (!email || !password) return showToast("Enter email and password", "error");

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        showToast("Login failed: " + error.message, "error");
    }
});

// Load Profile Data
async function loadUserProfile(uid) {
    try {
        const docSnap = await getDoc(doc(db, "users", uid));

        if (!docSnap.exists()) {
            showToast("User profile not found in database. Please register again.", "error");
            await auth.signOut();
            return;
        }

        currentUserProfile = docSnap.data();

        // Safety initialization for arrays
        if (!currentUserProfile.interests_sent) currentUserProfile.interests_sent = [];
        if (!currentUserProfile.interests_received) currentUserProfile.interests_received = [];

        document.getElementById("welcome-msg").innerText = `Welcome, ${currentUserProfile.name}`;
        populateProfileForm(currentUserProfile);

        if (currentUserProfile.status === "teamed_up") {
            document.getElementById("partner-alert").classList.remove("hidden");
            document.querySelector(".tab-bar").classList.add("hidden");
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            await fetchAndRenderUsers([currentUserProfile.partner_uid], "partner-details", false);
        } else {
            await loadAllMembers();
            loadInterests();
        }
    } catch (error) {
        console.error("Error fetching profile:", error);

        // Check if it's a permissions error
        if (error.code === 'permission-denied') {
            showToast("Database Access Denied. Check Firebase Rules!", "error");
        } else {
            showToast("Failed to load user data.", "error");
        }
    }
}



// Update the Login Button to show a loading state
document.getElementById("btn-login").addEventListener("click", async (e) => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const btn = e.target;

    if (!email || !password) return showToast("Enter email and password", "error");

    btn.innerText = "Logging in...";
    btn.disabled = true;

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        showToast("Login failed: " + error.message, "error");
    } finally {
        btn.innerText = "Login";
        btn.disabled = false;
    }
});



// Populate the "My Profile" tab form
function populateProfileForm(data) {
    document.getElementById("edit_name").value = data.name || "";
    document.getElementById("edit_exp").value = data.exp || "5+";
    document.getElementById("edit_city").value = data.city || "";
    document.getElementById("edit_background").value = data.background || "Tech";
    document.getElementById("edit_domain").value = data.current_domain || "";
    document.getElementById("edit_proj_domain").value = data.project_domain || "";
    document.getElementById("edit_proj_desc").value = data.project_desc || "";
    document.getElementById("edit_status").value = data.status || "open";
}

// Update Profile
document.getElementById("btn-update-profile").addEventListener("click", async () => {
    const name = document.getElementById("edit_name").value.trim();
    if (!name) return showToast("Name is required", "error");

    const updatedData = {
        name: name,
        exp: document.getElementById("edit_exp").value,
        city: document.getElementById("edit_city").value,
        background: document.getElementById("edit_background").value,
        current_domain: document.getElementById("edit_domain").value,
        project_domain: document.getElementById("edit_proj_domain").value,
        project_desc: document.getElementById("edit_proj_desc").value,
        status: document.getElementById("edit_status").value
    };

    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), updatedData);

        const combinedText = `Experience: ${updatedData.exp}, City: ${updatedData.city}, Domain: ${updatedData.current_domain}, Project: ${updatedData.project_desc}`;
        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: auth.currentUser.uid, combinedText: combinedText, status: updatedData.status })
        });

        showToast("Profile updated successfully!");
        loadUserProfile(auth.currentUser.uid);
    } catch (e) {
        showToast("Failed to update profile", "error");
    }
});

// Central Render Function for DOM manipulation
function renderUserCards(usersDataArray, containerId, allowActions = true) {
    const container = document.getElementById(containerId);
    if (!usersDataArray || usersDataArray.length === 0) {
        container.innerHTML = "<p class='text-muted'>No members found in this category.</p>";
        return;
    }

    let html = "";
    usersDataArray.forEach((u) => {
        let actionButtons = '';

        if (allowActions) {
            const receivedInterests = currentUserProfile.interests_received || [];
            const sentInterests = currentUserProfile.interests_sent || [];

            // Logic: If they sent you an interest, show Accept/Reject globally on any tab
            if (receivedInterests.includes(u.id)) {
                actionButtons = `
                    <button class="btn btn-primary" onclick="acceptInterest('${u.id}')">Accept</button>
                    <button class="btn btn-danger" onclick="rejectInterest('${u.id}')">Reject</button>
                `;
            }
            // Logic: If you sent them an interest, show pending globally
            else if (sentInterests.includes(u.id)) {
                actionButtons = `<button class="btn btn-outline" disabled style="opacity: 0.5; border-color: rgba(255,255,255,0.2); color: #a1a1aa; cursor: not-allowed;">Request Pending</button>`;
            }
            // Default: Send interest
            else {
                actionButtons = `<button class="btn btn-outline" id="btn-send-${u.id}" onclick="sendInterest('${u.id}')">Send Interest</button>`;
            }
        }

        html += `
        <div class="card user-card">
            <h4>${u.name} <span class="badge">${u.city || 'No City'}</span></h4>
            <div class="user-card-meta">
                <div><strong style="color:var(--primary)">Exp:</strong> ${u.exp}</div>
                <div><strong style="color:var(--primary)">Work:</strong> ${u.current_domain}</div>
                <div><strong style="color:var(--primary)">Background:</strong> ${u.background}</div>
                <div><strong style="color:var(--primary)">Target:</strong> ${u.project_domain}</div>
            </div>
            <div style="margin-top:10px; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
                <strong style="color:var(--primary); font-size:0.875rem;">Project Idea:</strong><br/> 
                <span style="font-size:0.95rem;">${u.project_desc || '<span class="text-muted">None provided</span>'}</span>
            </div>
            <div class="user-card-actions">
                ${actionButtons}
            </div>
        </div>`;
    });
    container.innerHTML = html;
}

// Fetch by UIDs (handles Firebase "in" query limits via chunking)
async function fetchAndRenderUsers(uidArray, containerId, allowActions = true) {
    if (!uidArray || uidArray.length === 0) return renderUserCards([], containerId);

    document.getElementById(containerId).innerHTML = "<p class='text-muted'>Loading profiles...</p>";
    let allUsers = [];

    for (let i = 0; i < uidArray.length; i += 10) {
        const chunk = uidArray.slice(i, i + 10);
        const q = query(collection(db, "users"), where(documentId(), "in", chunk));
        const snap = await getDocs(q);
        snap.forEach(docSnap => allUsers.push({ id: docSnap.id, ...docSnap.data() }));
    }

    renderUserCards(allUsers, containerId, allowActions);
}

// Direct Database Fetch for "All Members"
async function loadAllMembers() {
    document.getElementById("all-results").innerHTML = "<p class='text-muted'>Loading open members...</p>";
    const q = query(collection(db, "users"), where("status", "==", "open"));
    const querySnapshot = await getDocs(q);

    let allUsers = [];
    querySnapshot.forEach(d => {
        if (d.id !== auth.currentUser.uid) {
            allUsers.push({ id: d.id, ...d.data() });
        }
    });

    renderUserCards(allUsers, "all-results", true);
}

// Fetch AI Recos 
document.getElementById("btn-get-reco").addEventListener("click", async () => {
    document.getElementById("reco-results").innerHTML = "<p class='text-muted'>Scanning vector database...</p>";
    const combinedText = `Experience: ${currentUserProfile.exp}, City: ${currentUserProfile.city}, Domain: ${currentUserProfile.current_domain}, Project: ${currentUserProfile.project_desc}`;

    try {
        const res = await fetch(WEBHOOK_GET_RECO, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: auth.currentUser.uid, combinedText: combinedText })
        });
        const matches = await res.json();

        let uidsArray = [];
        if (Array.isArray(matches)) {
            uidsArray = matches;
        } else if (matches && Array.isArray(matches.uids)) {
            uidsArray = matches.uids;
        }

        fetchAndRenderUsers(uidsArray, "reco-results", true);
    } catch (e) {
        showToast("Error connecting to AI", "error");
        document.getElementById("reco-results").innerHTML = "<p class='text-muted'>Failed to load matches.</p>";
    }
});

// Load Interests Tab
function loadInterests() {
    const received = currentUserProfile.interests_received || [];
    fetchAndRenderUsers(received, "interests-results", true);
}

// Window actions for inline onclicks
window.sendInterest = async (targetUid) => {
    try {
        await updateDoc(doc(db, "users", targetUid), { interests_received: arrayUnion(auth.currentUser.uid) });
        await updateDoc(doc(db, "users", auth.currentUser.uid), { interests_sent: arrayUnion(targetUid) });

        if (!currentUserProfile.interests_sent) currentUserProfile.interests_sent = [];
        currentUserProfile.interests_sent.push(targetUid);

        const btns = document.querySelectorAll(`#btn-send-${targetUid}`);
        btns.forEach(btn => {
            btn.innerText = "Request Pending";
            btn.style.opacity = "0.5";
            btn.style.color = "#a1a1aa";
            btn.style.borderColor = "rgba(255,255,255,0.2)";
            btn.style.cursor = "not-allowed";
            btn.disabled = true;
        });

        showToast("Interest sent to user!");
    } catch (e) { showToast("Failed to send interest", "error"); }
};

window.acceptInterest = async (requesterUid) => {
    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), { status: "teamed_up", partner_uid: requesterUid });
        await updateDoc(doc(db, "users", requesterUid), { status: "teamed_up", partner_uid: auth.currentUser.uid });

        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: auth.currentUser.uid, combinedText: "", status: "teamed_up" })
        });
        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: requesterUid, combinedText: "", status: "teamed_up" })
        });

        showToast("Team successfully formed! Reloading...");
        setTimeout(() => window.location.reload(), 1500);
    } catch (e) { showToast("Failed to form team", "error"); }
};

window.rejectInterest = async (requesterUid) => {
    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), { interests_received: arrayRemove(requesterUid) });
        await updateDoc(doc(db, "users", requesterUid), { interests_sent: arrayRemove(auth.currentUser.uid) });

        currentUserProfile.interests_received = currentUserProfile.interests_received.filter(id => id !== requesterUid);

        loadInterests();
        loadAllMembers();

        showToast("Interest rejected.");
    } catch (e) { showToast("Failed to reject interest", "error"); }
};
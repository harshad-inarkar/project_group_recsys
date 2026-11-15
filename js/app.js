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

function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type} show`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 3000);
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            document.getElementById("auth-section").classList.add("hidden");
            document.getElementById("app-section").classList.remove("hidden");
            document.getElementById("welcome-msg").innerText = "Loading profile data...";
            await loadUserProfile(user.uid);
        } catch (error) {
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

    if (!email || !password || !name) return showToast("Email, Password, and Full Name are required.", "error");

    const userData = {
        name: name, exp: document.getElementById("exp").value, city: document.getElementById("city").value,
        background: document.getElementById("background").value, current_domain: document.getElementById("domain").value,
        project_domain: document.getElementById("proj_domain").value, project_desc: document.getElementById("proj_desc").value,
        status: "open", partner_uid: null, interests_received: [], interests_sent: [], interests_rejected: [], random_matches: [], isAdmin: false
    };

    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        userData.uid = userCred.user.uid;
        await setDoc(doc(db, "users", userCred.user.uid), userData);

        const combinedText = `Experience: ${userData.exp}, City: ${userData.city}, Domain: ${userData.current_domain}, Project: ${userData.project_desc}`;
        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: userData.uid, combinedText: combinedText, status: userData.status })
        });
        showToast("Profile created successfully!");
    } catch (error) { showToast(error.message, "error"); }
});

// Login
document.getElementById("btn-login").addEventListener("click", async (e) => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const btn = e.target;
    if (!email || !password) return showToast("Enter email and password", "error");

    btn.innerText = "Logging in..."; btn.disabled = true;
    try { await signInWithEmailAndPassword(auth, email, password); }
    catch (error) { showToast("Login failed: " + error.message, "error"); }
    finally { btn.innerText = "Login"; btn.disabled = false; }
});

// Load Profile Data
async function loadUserProfile(uid) {
    try {
        const docSnap = await getDoc(doc(db, "users", uid));
        if (!docSnap.exists()) {
            showToast("User profile not found. Please register again.", "error");
            return await auth.signOut();
        }

        currentUserProfile = docSnap.data();

        // Safety initialization for older arrays
        if (!currentUserProfile.interests_sent) currentUserProfile.interests_sent = [];
        if (!currentUserProfile.interests_received) currentUserProfile.interests_received = [];
        if (!currentUserProfile.interests_rejected) currentUserProfile.interests_rejected = [];
        if (!currentUserProfile.random_matches) currentUserProfile.random_matches = [];

        document.getElementById("welcome-msg").innerText = `Welcome, ${currentUserProfile.name}`;
        populateProfileForm(currentUserProfile);

        if (currentUserProfile.isAdmin) {
            document.getElementById("tab-btn-admin").classList.remove("hidden");
        }

        if (currentUserProfile.interests_received.length > 0) {
            document.getElementById("nav-red-dot").classList.remove("hidden");
        } else {
            document.getElementById("nav-red-dot").classList.add("hidden");
        }

        if (currentUserProfile.status === "teamed_up" || currentUserProfile.status === "solo") {
            document.getElementById("partner-alert").classList.remove("hidden");
            document.querySelectorAll('.tab-btn').forEach(btn => {
                const text = btn.innerText;
                if (text.includes('Recos') || text.includes('Random') || text.includes('All Open') || text.includes('Received') || text.includes('Sent')) {
                    btn.classList.add('hidden');
                }
            });
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));

            if (currentUserProfile.status === "teamed_up" && currentUserProfile.partner_uid) {
                await fetchAndRenderUsers([currentUserProfile.partner_uid], "partner-details", false);
            }
        } else {
            await loadAllMembers();
            loadInterests();
            fetchAndRenderUsers(currentUserProfile.random_matches, "random-results", true);
            fetchAndRenderUsers(currentUserProfile.interests_sent, "sent-results", false, false, true);
        }

        window.loadAllProjects();
    } catch (error) { console.error(error); showToast("Failed to load user data.", "error"); }
}

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

// Update Profile & Handle Solo Status
document.getElementById("btn-update-profile").addEventListener("click", async () => {
    const updatedData = {
        name: document.getElementById("edit_name").value.trim(), exp: document.getElementById("edit_exp").value,
        city: document.getElementById("edit_city").value, background: document.getElementById("edit_background").value,
        current_domain: document.getElementById("edit_domain").value, project_domain: document.getElementById("edit_proj_domain").value,
        project_desc: document.getElementById("edit_proj_desc").value, status: document.getElementById("edit_status").value
    };
    if (!updatedData.name) return showToast("Name is required", "error");

    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), updatedData);

        if (updatedData.status === "solo") {
            await setDoc(doc(db, "projects", auth.currentUser.uid), {
                type: "solo", member1_uid: auth.currentUser.uid, member1_name: updatedData.name,
                project_desc: updatedData.project_desc || "Working Solo"
            });
        }

        const combinedText = `Experience: ${updatedData.exp}, City: ${updatedData.city}, Domain: ${updatedData.current_domain}, Project: ${updatedData.project_desc}`;
        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: auth.currentUser.uid, combinedText: combinedText, status: updatedData.status })
        });

        showToast("Profile updated successfully!");
        setTimeout(() => window.location.reload(), 1000);
    } catch (e) { showToast("Failed to update profile", "error"); }
});

// Master Render function for user cards
function renderUserCards(usersDataArray, containerId, allowActions = true, isSentTab = false) {
    const container = document.getElementById(containerId);
    if (!usersDataArray || usersDataArray.length === 0) {
        container.innerHTML = "<p class='text-muted'>No members found.</p>"; return;
    }

    let html = "";
    usersDataArray.forEach((u) => {
        let actionButtons = '';
        if (allowActions) {
            const receivedInterests = currentUserProfile.interests_received || [];
            const sentInterests = currentUserProfile.interests_sent || [];
            const rejectedInterests = currentUserProfile.interests_rejected || [];

            if (receivedInterests.includes(u.id)) {
                actionButtons = `<button class="btn btn-primary" onclick="acceptInterest('${u.id}')">Accept</button>
                                 <button class="btn btn-danger" style="margin-left: 5px;" onclick="rejectInterest('${u.id}')">Reject</button>`;
            } else if (sentInterests.includes(u.id)) {
                actionButtons = `<button class="btn btn-outline" disabled style="opacity:0.5; border-color:rgba(255,255,255,0.2); color:#a1a1aa; cursor:not-allowed;">Request Pending</button>`;
            } else if (rejectedInterests.includes(u.id)) {
                // REQ 2: Block sending to people who rejected you
                actionButtons = `<button class="btn btn-outline" disabled style="opacity: 0.5; border-color: rgba(244,63,94,0.4); color: var(--danger); cursor: not-allowed;">Rejected</button>`;
            } else {
                actionButtons = `<button class="btn btn-outline" id="btn-send-${u.id}" onclick="sendInterest('${u.id}')">Send Interest</button>`;
            }
        } else if (isSentTab) {
            actionButtons = `<button class="btn btn-outline" disabled style="opacity:0.5; border-color:rgba(255,255,255,0.2); color:#a1a1aa; cursor:not-allowed;">Waiting for reply...</button>`;
        }

        html += `<div class="card user-card">
            <h4>${u.name} <span class="badge">${u.city || 'No City'}</span></h4>
            <div class="user-card-meta">
                <div><strong style="color:var(--primary)">Exp:</strong> ${u.exp}</div>
                <div><strong style="color:var(--primary)">Work Domain:</strong> ${u.current_domain}</div>
                <div><strong style="color:var(--primary)">Background:</strong> ${u.background}</div>
                <div><strong style="color:var(--primary)">Project Domain:</strong> ${u.project_domain}</div>
            </div>
            <div style="margin-top:10px; background:rgba(0,0,0,0.2); padding:12px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                <strong style="color:var(--primary); font-size:0.875rem;">Project Idea:</strong><br/> 
                <span style="font-size:0.95rem;">${u.project_desc || '<span class="text-muted">None provided</span>'}</span>
            </div>
            <div class="user-card-actions">${actionButtons}</div>
        </div>`;
    });
    container.innerHTML = html;
}

async function fetchAndRenderUsers(uidArray, containerId, allowActions = true, isIncoming = false, isSentTab = false) {
    if (!uidArray || uidArray.length === 0) return renderUserCards([], containerId);
    document.getElementById(containerId).innerHTML = "<p class='text-muted'>Loading profiles...</p>";
    let allUsers = [];
    for (let i = 0; i < uidArray.length; i += 10) {
        const chunk = uidArray.slice(i, i + 10);
        const q = query(collection(db, "users"), where(documentId(), "in", chunk));
        const snap = await getDocs(q);
        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.status === "open") allUsers.push({ id: docSnap.id, ...data });
        });
    }
    renderUserCards(allUsers, containerId, allowActions, isSentTab);
}

// Fetch "All Members" ensuring only 'open' users
async function loadAllMembers() {
    document.getElementById("all-results").innerHTML = "<p class='text-muted'>Loading open members...</p>";
    const q = query(collection(db, "users"), where("status", "==", "open"));
    const querySnapshot = await getDocs(q);
    let allUsers = [];
    querySnapshot.forEach(d => { if (d.id !== auth.currentUser.uid) allUsers.push({ id: d.id, ...d.data() }); });
    renderUserCards(allUsers, "all-results", true);
}

// Req 6: Fetch and display Projects & Req 3: Edit Idea Logic
window.loadAllProjects = async () => {
    const container = document.getElementById("projects-results");
    container.innerHTML = "<p class='text-muted'>Loading projects...</p>";
    const snap = await getDocs(collection(db, "projects"));
    let html = "";

    snap.forEach(docSnap => {
        const p = docSnap.data();
        const projectId = docSnap.id;

        // REQ 3: Check if logged in user owns this project
        const isMyProject = (auth.currentUser && (auth.currentUser.uid === p.member1_uid || auth.currentUser.uid === p.member2_uid));

        let editHtml = "";
        if (isMyProject) {
            editHtml = `
                <div style="margin-top:12px;">
                    <textarea id="edit-proj-${projectId}" class="hidden" rows="3" style="width:100%; margin-bottom:10px;">${p.project_desc}</textarea>
                    <button id="btn-edit-${projectId}" class="btn btn-outline" style="padding: 4px 10px; font-size: 0.8rem; width: auto;" onclick="toggleEditProject('${projectId}')">Edit Idea</button>
                    <button id="btn-save-${projectId}" class="btn btn-primary hidden" style="padding: 4px 10px; font-size: 0.8rem; width: auto;" onclick="saveProjectIdea('${projectId}')">Save Idea</button>
                </div>
            `;
        }

        html += `<div class="card" style="border-left: 4px solid var(--primary);">
            <h4 style="color:var(--primary);">${p.type === 'team' ? '🤝 Team' : '👤 Solo Project'}</h4>
            <p style="margin: 5px 0 10px;"><strong>Members:</strong> ${p.type === 'team' ? p.member1_name + ' & ' + p.member2_name : p.member1_name}</p>
            <div style="background:rgba(0,0,0,0.2); padding:12px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                <strong style="color:var(--primary); font-size:0.875rem;">Final Project Idea:</strong><br/> 
                <span id="text-proj-${projectId}" style="font-size:0.95rem; display:block; margin-top:5px;">${p.project_desc}</span>
                ${editHtml}
            </div>
        </div>`;
    });

    if (html === "") html = "<p class='text-muted'>No projects finalized yet.</p>";
    container.innerHTML = html;
};

window.toggleEditProject = (projectId) => {
    document.getElementById(`text-proj-${projectId}`).classList.add('hidden');
    document.getElementById(`btn-edit-${projectId}`).classList.add('hidden');
    document.getElementById(`edit-proj-${projectId}`).classList.remove('hidden');
    document.getElementById(`btn-save-${projectId}`).classList.remove('hidden');
};

window.saveProjectIdea = async (projectId) => {
    const newIdea = document.getElementById(`edit-proj-${projectId}`).value.trim();
    if (!newIdea) return showToast("Idea cannot be empty", "error");
    try {
        await updateDoc(doc(db, "projects", projectId), { project_desc: newIdea });
        showToast("Project Idea Updated!");
        window.loadAllProjects(); // Refresh UI instantly
    } catch (e) { showToast("Failed to update idea", "error"); }
};

// AI Recos
document.getElementById("btn-get-reco").addEventListener("click", async () => {
    document.getElementById("reco-results").innerHTML = "<p class='text-muted'>Scanning vector database...</p>";
    try {
        const res = await fetch(WEBHOOK_GET_RECO, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: auth.currentUser.uid, combinedText: `${currentUserProfile.exp} ${currentUserProfile.city} ${currentUserProfile.current_domain} ${currentUserProfile.project_desc}` })
        });
        const matches = await res.json();
        let uidsArray = Array.isArray(matches) ? matches : (matches.uids || []);
        fetchAndRenderUsers(uidsArray, "reco-results", true);
    } catch (e) { showToast("Error connecting to AI", "error"); }
});

function loadInterests() {
    fetchAndRenderUsers(currentUserProfile.interests_received || [], "interests-results", true);
}

// Actions
window.sendInterest = async (targetUid) => {
    try {
        await updateDoc(doc(db, "users", targetUid), { interests_received: arrayUnion(auth.currentUser.uid) });
        await updateDoc(doc(db, "users", auth.currentUser.uid), { interests_sent: arrayUnion(targetUid) });

        currentUserProfile.interests_sent.push(targetUid);
        document.querySelectorAll(`#btn-send-${targetUid}`).forEach(btn => {
            btn.innerText = "Request Pending"; btn.style.opacity = "0.5"; btn.disabled = true;
        });
        showToast("Interest sent!");
        fetchAndRenderUsers(currentUserProfile.interests_sent, "sent-results", false, false, true);
    } catch (e) { showToast("Failed to send interest", "error"); }
};

window.acceptInterest = async (requesterUid) => {
    try {
        const requesterSnap = await getDoc(doc(db, "users", requesterUid));
        const requesterName = requesterSnap.exists() ? requesterSnap.data().name : "Unknown Member";
        const requesterProj = requesterSnap.exists() ? requesterSnap.data().project_desc : "";

        await setDoc(doc(db, "projects", auth.currentUser.uid + "_" + requesterUid), {
            type: "team", member1_uid: auth.currentUser.uid, member1_name: currentUserProfile.name,
            member2_uid: requesterUid, member2_name: requesterName,
            project_desc: currentUserProfile.project_desc || requesterProj || "TBD"
        });

        await updateDoc(doc(db, "users", auth.currentUser.uid), { status: "teamed_up", partner_uid: requesterUid });
        await updateDoc(doc(db, "users", requesterUid), { status: "teamed_up", partner_uid: auth.currentUser.uid });

        fetch(WEBHOOK_EMBED_PROFILE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: auth.currentUser.uid, combinedText: "", status: "teamed_up" }) });
        fetch(WEBHOOK_EMBED_PROFILE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: requesterUid, combinedText: "", status: "teamed_up" }) });

        showToast("Team successfully formed! Reloading...");
        setTimeout(() => window.location.reload(), 1500);
    } catch (e) { showToast("Failed to form team", "error"); }
};

// REQ 2: Permanent Rejection Tracking
window.rejectInterest = async (requesterUid) => {
    try {
        // Remove from receiver (you)
        await updateDoc(doc(db, "users", auth.currentUser.uid), { interests_received: arrayRemove(requesterUid) });
        // Remove from sender and add to their rejected list
        await updateDoc(doc(db, "users", requesterUid), {
            interests_sent: arrayRemove(auth.currentUser.uid),
            interests_rejected: arrayUnion(auth.currentUser.uid)
        });

        currentUserProfile.interests_received = currentUserProfile.interests_received.filter(id => id !== requesterUid);
        loadInterests();

        showToast("Interest rejected.");
    } catch (e) { showToast("Failed to reject", "error"); }
};

// Admin Random Round Logic
document.getElementById("btn-admin-random").addEventListener("click", async (e) => {
    const btn = e.target;
    btn.innerText = "Processing..."; btn.disabled = true;
    try {
        const q = query(collection(db, "users"), where("status", "==", "open"));
        const snapshot = await getDocs(q);
        let openUsers = [];
        snapshot.forEach(doc => openUsers.push(doc.id));

        for (let uid of openUsers) {
            let others = openUsers.filter(id => id !== uid);
            others = others.sort(() => 0.5 - Math.random());
            let random5 = others.slice(0, 5);
            await updateDoc(doc(db, "users", uid), { random_matches: random5 });
        }
        showToast("Random round generated for all open users!");
    } catch (error) {
        showToast("Failed to generate round", "error");
    } finally {
        btn.innerText = "Generate Random Round for All"; btn.disabled = false;
    }
});
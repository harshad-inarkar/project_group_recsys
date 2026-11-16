import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, arrayUnion, arrayRemove, collection, query, where, documentId } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCmrY4OLmNdTFS_jBQdzAKMMtARAegB5kw",
    authDomain: "project-group-4ab7c.firebaseapp.com",
    projectId: "project-group-4ab7c",
    storageBucket: "project-group-4ab7c.firebasestorage.app",
    messagingSenderId: "714689701833",
    appId: "1:714689701833:web:dc3ee180c4f83e515f6a18"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const WEBHOOK_EMBED_PROFILE = "https://harshad-agentic-demo.app.n8n.cloud/webhook/embed-profile";
const WEBHOOK_GET_RECO = "https://harshad-agentic-demo.app.n8n.cloud/webhook/get-recommendations";

let currentUserProfile = null;
let platformSettings = { maxMembers: 2 };
let hasLoadedRecos = false; // Prevents spamming n8n

function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type} show`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 3000);
}

// Custom Hashing
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function cleanName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, '_').replace(/^_|_$/g, '');
}

async function loadAutocomplete() {
    const snap = await getDocs(collection(db, "users"));
    const datalist = document.getElementById("user-list");
    datalist.innerHTML = "";
    snap.forEach(docSnap => {
        const u = docSnap.data();
        datalist.innerHTML += `<option value="${u.username}">${u.name}</option>`;
    });
}

async function loadPlatformSettings() {
    const snap = await getDoc(doc(db, "settings", "config"));
    if (snap.exists()) platformSettings = snap.data();
    const adminInput = document.getElementById("admin-max-members");
    if (adminInput) adminInput.value = platformSettings.maxMembers || 2;
}

document.getElementById("btn-save-settings").addEventListener("click", async () => {
    const max = parseInt(document.getElementById("admin-max-members").value);
    await setDoc(doc(db, "settings", "config"), { maxMembers: max }, { merge: true });
    platformSettings.maxMembers = max;
    showToast("Platform Settings Saved!");
});

// INITIALIZATION
document.addEventListener("DOMContentLoaded", async () => {
    await loadAutocomplete();
    const savedSession = localStorage.getItem("loggedInUser");
    if (savedSession) {
        document.getElementById("auth-section").classList.add("hidden");
        document.getElementById("app-section").classList.remove("hidden");
        document.getElementById("welcome-msg").innerText = "Loading profile data...";
        await loadPlatformSettings();
        await loadUserProfile(savedSession);
    }
});

window.logoutCustom = () => {
    localStorage.removeItem("loggedInUser");
    window.location.reload();
};

document.getElementById("btn-login").addEventListener("click", async (e) => {
    const identifier = document.getElementById("login_identifier").value.trim();
    const password = document.getElementById("password").value;
    const btn = e.target;

    if (!identifier || !password) return showToast("Enter Name/Username and password", "error");
    btn.innerText = "Logging in..."; btn.disabled = true;

    try {
        const hashedPass = await hashPassword(password);
        const qUsername = query(collection(db, "users"), where("username", "==", identifier));
        const qName = query(collection(db, "users"), where("name", "==", identifier));

        let snap = await getDocs(qUsername);
        if (snap.empty) snap = await getDocs(qName);

        if (snap.empty) {
            showToast("User not found. Please click 'New Profile' to register.", "error");
        } else {
            const userDoc = snap.docs[0];
            const userData = userDoc.data();
            if (userData.password === hashedPass) {
                localStorage.setItem("loggedInUser", userDoc.id);
                window.location.reload();
            } else {
                showToast("Incorrect password", "error");
            }
        }
    } catch (error) { showToast("Login failed: " + error.message, "error"); }
    finally { btn.innerText = "Login"; btn.disabled = false; }
});

document.getElementById("btn-register").addEventListener("click", async () => {
    const identifier = document.getElementById("login_identifier").value.trim();
    const password = document.getElementById("password").value;

    if (!identifier || !password) return showToast("Name/Username and Password are required.", "error");

    try {
        const counterRef = doc(db, "metadata", "counter");
        let counterSnap = await getDoc(counterRef);
        if (!counterSnap.exists()) {
            await setDoc(counterRef, { last_uid: 100 });
            counterSnap = await getDoc(counterRef);
        }

        const newUidNum = counterSnap.data().last_uid + 1;
        const uidStr = String(newUidNum);

        let baseUsername = cleanName(identifier);
        let finalUsername = baseUsername;
        const usernameCheck = await getDocs(query(collection(db, "users"), where("username", "==", baseUsername)));
        if (!usernameCheck.empty) finalUsername = `${baseUsername}_${uidStr}`;

        const hashedPass = await hashPassword(password);
        const userData = {
            uid: uidStr, username: finalUsername, name: identifier, password: hashedPass,
            exp: document.getElementById("exp").value, city: document.getElementById("city").value,
            background: document.getElementById("background").value, current_domain: document.getElementById("domain").value,
            linkedin: document.getElementById("linkedin").value.trim(), contact: document.getElementById("contact").value.trim(),
            project_domain: document.getElementById("proj_domain").value, project_desc: document.getElementById("proj_desc").value,
            status: "open", team_id: null, interests_received: [], interests_sent: [], interests_rejected: [], random_matches: [], isAdmin: false
        };

        await setDoc(doc(db, "users", uidStr), userData);
        await updateDoc(counterRef, { last_uid: newUidNum });

        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: uidStr, combinedText: `Experience: ${userData.exp}, City: ${userData.city}, Domain: ${userData.current_domain}, Project: ${userData.project_desc}`, status: userData.status })
        });

        showToast("Profile created! Logging in...");
        localStorage.setItem("loggedInUser", uidStr);
        setTimeout(() => window.location.reload(), 1000);
    } catch (error) { showToast(error.message, "error"); }
});

// SAFE PROFILE LOAD SEQUENCE
async function loadUserProfile(uid) {
    try {
        const docSnap = await getDoc(doc(db, "users", uid));
        if (!docSnap.exists()) {
            showToast("Profile missing.", "error");
            return window.logoutCustom();
        }

        currentUserProfile = docSnap.data();
        if (!currentUserProfile.interests_sent) currentUserProfile.interests_sent = [];
        if (!currentUserProfile.interests_received) currentUserProfile.interests_received = [];
        if (!currentUserProfile.interests_rejected) currentUserProfile.interests_rejected = [];
        if (!currentUserProfile.random_matches) currentUserProfile.random_matches = [];

        document.getElementById("welcome-msg").innerText = `Welcome, ${currentUserProfile.name}`;
        populateProfileForm(currentUserProfile);

        // Force UI to always load Profile tab first to prevent missing container errors
        document.getElementById("nav-profile").click();

        const checkAdmin = currentUserProfile.isAdmin === true || String(currentUserProfile.isAdmin).toLowerCase() === "true";
        if (checkAdmin) document.getElementById("nav-admin").classList.remove("hidden");

        if (currentUserProfile.interests_received.length > 0) {
            document.getElementById("nav-red-dot").classList.remove("hidden");
        }

        // Setup background data loading based on status
        if (currentUserProfile.status === "teamed_up" || currentUserProfile.status === "solo") {
            document.getElementById("nav-search").classList.add("hidden");
        } else {
            document.getElementById("nav-search").classList.remove("hidden");

            // Preload Search Data
            loadAllMembers();
            loadInterests();
            fetchAndRenderUsers(currentUserProfile.interests_sent, "sent-results", false, false, true);

            if (currentUserProfile.random_matches.length === 0) {
                document.getElementById("random-results").innerHTML = "<p class='text-muted'>Wait for admin for random matches.</p>";
            } else {
                fetchAndRenderUsers(currentUserProfile.random_matches, "random-results", true);
            }

            // Pre-load AI Recos silently
            window.fetchAIRecos();
        }

        window.loadAllProjects();
    } catch (error) { console.error(error); showToast("Failed to load user data.", "error"); }
}

function populateProfileForm(data) {
    document.getElementById("edit_username").value = data.username || "";
    document.getElementById("edit_name").value = data.name || "";
    document.getElementById("edit_exp").value = data.exp || "1+";
    document.getElementById("edit_city").value = data.city || "";
    document.getElementById("edit_background").value = data.background || "";
    document.getElementById("edit_domain").value = data.current_domain || "";
    document.getElementById("edit_linkedin").value = data.linkedin || "";
    document.getElementById("edit_contact").value = data.contact || "";
    document.getElementById("edit_proj_domain").value = data.project_domain || "";
    document.getElementById("edit_proj_desc").value = data.project_desc || "";
    document.getElementById("edit_status").value = data.status || "open";
}

// CASCADING LEAVE TEAM 
async function leaveTeam(userId, teamId) {
    try {
        if (!teamId) return;
        const projRef = doc(db, "projects", teamId);
        const projSnap = await getDoc(projRef);

        if (projSnap.exists()) {
            let pData = projSnap.data();
            let members = pData.members || [];
            let remainingMembers = members.filter(m => m.uid !== userId);

            if (remainingMembers.length < 2) {
                await deleteDoc(projRef);
                for (let m of remainingMembers) {
                    await updateDoc(doc(db, "users", m.uid), { status: "open", team_id: null });
                    const otherSnap = await getDoc(doc(db, "users", m.uid));
                    if (otherSnap.exists()) {
                        const od = otherSnap.data();
                        fetch(WEBHOOK_EMBED_PROFILE, {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ uid: m.uid, combinedText: `Experience: ${od.exp}, City: ${od.city}, Domain: ${od.current_domain}, Project: ${od.project_desc}`, status: "open" })
                        });
                    }
                }
            } else {
                await updateDoc(projRef, { members: remainingMembers });
            }
        }
    } catch (e) { console.error("Error in leaveTeam cascade:", e); }
}

document.getElementById("btn-update-profile").addEventListener("click", async () => {
    const updatedData = {
        name: document.getElementById("edit_name").value.trim(), exp: document.getElementById("edit_exp").value,
        city: document.getElementById("edit_city").value, background: document.getElementById("edit_background").value,
        current_domain: document.getElementById("edit_domain").value, project_domain: document.getElementById("edit_proj_domain").value,
        linkedin: document.getElementById("edit_linkedin").value.trim(), contact: document.getElementById("edit_contact").value.trim(),
        project_desc: document.getElementById("edit_proj_desc").value, status: document.getElementById("edit_status").value
    };
    if (!updatedData.name) return showToast("Name is required", "error");

    try {
        if (currentUserProfile.team_id && (updatedData.status === "open" || updatedData.status === "solo")) {
            await leaveTeam(currentUserProfile.uid, currentUserProfile.team_id);
            updatedData.team_id = null;
        }

        if (currentUserProfile.status === "solo" && updatedData.status === "open") {
            await deleteDoc(doc(db, "projects", currentUserProfile.uid));
        }

        await updateDoc(doc(db, "users", currentUserProfile.uid), updatedData);

        if (updatedData.status === "solo") {
            await setDoc(doc(db, "projects", currentUserProfile.uid), {
                type: "solo", members: [{ uid: currentUserProfile.uid, name: updatedData.name }],
                project_desc: updatedData.project_desc || "Working Solo"
            });
        }

        const combinedText = `Experience: ${updatedData.exp}, City: ${updatedData.city}, Domain: ${updatedData.current_domain}, Project: ${updatedData.project_desc}`;
        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: currentUserProfile.uid, combinedText: combinedText, status: updatedData.status })
        });

        showToast("Profile updated successfully!");
        setTimeout(() => window.location.reload(), 1000);
    } catch (e) { showToast("Failed to update profile", "error"); }
});

// PASSWORD LOGIC
document.getElementById("btn-change-password").addEventListener("click", async (e) => {
    const currentPass = document.getElementById("current_password").value;
    const newPass = document.getElementById("new_password").value;
    const confirmPass = document.getElementById("confirm_password").value;
    const btn = e.target;

    if (!currentPass || !newPass || !confirmPass) return showToast("Please fill out all password fields.", "error");
    if (newPass !== confirmPass) return showToast("New passwords do not match.", "error");

    btn.innerText = "Updating..."; btn.disabled = true;

    try {
        const hashedCurrent = await hashPassword(currentPass);
        const userRef = doc(db, "users", currentUserProfile.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists() && userSnap.data().password === hashedCurrent) {
            const hashedNew = await hashPassword(newPass);
            await updateDoc(userRef, { password: hashedNew });
            showToast("Password updated successfully!");
            document.getElementById("current_password").value = "";
            document.getElementById("new_password").value = "";
            document.getElementById("confirm_password").value = "";
            currentUserProfile.password = hashedNew;
        } else {
            showToast("Incorrect current password.", "error");
        }
    } catch (error) { showToast("Failed to update password.", "error"); }
    finally { btn.innerText = "Update Password"; btn.disabled = false; }
});

function renderUserCards(usersDataArray, containerId, allowActions = true, isSentTab = false) {
    const container = document.getElementById(containerId);
    if (!usersDataArray || usersDataArray.length === 0) {
        container.innerHTML = "<p class='text-muted'>No members found.</p>"; return;
    }

    let html = "";
    usersDataArray.forEach((u) => {
        let actionButtons = '';
        if (allowActions && currentUserProfile.status === "open") {
            const receivedInterests = currentUserProfile.interests_received || [];
            const sentInterests = currentUserProfile.interests_sent || [];
            const rejectedInterests = currentUserProfile.interests_rejected || [];

            if (receivedInterests.includes(u.id)) {
                actionButtons = `<button class="btn btn-primary" onclick="acceptInterest('${u.id}')">Accept</button>
                                 <button class="btn btn-danger" style="margin-left: 5px;" onclick="rejectInterest('${u.id}')">Reject</button>`;
            } else if (sentInterests.includes(u.id)) {
                actionButtons = `<button class="btn btn-outline" disabled style="opacity:0.5; border-color:rgba(255,255,255,0.2); color:#a1a1aa; cursor:not-allowed;">Request Pending</button>`;
            } else if (rejectedInterests.includes(u.id)) {
                actionButtons = `<button class="btn btn-outline" disabled style="opacity: 0.5; border-color: rgba(244,63,94,0.4); color: var(--danger); cursor: not-allowed;">Rejected</button>`;
            } else {
                actionButtons = `<button class="btn btn-outline" id="btn-send-${u.id}" onclick="sendInterest('${u.id}')">Send Interest</button>`;
            }
        } else if (isSentTab) {
            actionButtons = `<button class="btn btn-outline" disabled style="opacity:0.5; border-color:rgba(255,255,255,0.2); color:#a1a1aa; cursor:not-allowed;">Waiting for reply...</button>`;
        }

        let socialsHtml = "";
        if (u.linkedin || u.contact) {
            socialsHtml = `<div class="social-links" style="margin-top: 10px; display: flex; gap: 15px;">`;
            if (u.linkedin) socialsHtml += `<a href="${u.linkedin}" target="_blank" style="color: #0ea5e9; text-decoration: none; font-size: 0.9rem; font-weight: 500;">🔗 LinkedIn</a>`;
            if (u.contact) {
                const waNum = u.contact.replace(/\D/g, '');
                socialsHtml += `<a href="https://wa.me/${waNum}" target="_blank" style="color: #22c55e; text-decoration: none; font-size: 0.9rem; font-weight: 500;">💬 WhatsApp</a>`;
            }
            socialsHtml += `</div>`;
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
                ${socialsHtml}
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
        try {
            const q = query(collection(db, "users"), where(documentId(), "in", chunk));
            const snap = await getDocs(q);
            snap.forEach(docSnap => {
                const data = docSnap.data();
                if (data.status === "open") allUsers.push({ id: docSnap.id, ...data });
            });
        } catch (error) { console.warn("Skipping chunk:", chunk); }
    }
    renderUserCards(allUsers, containerId, allowActions, isSentTab);
}

async function loadAllMembers() {
    document.getElementById("all-results").innerHTML = "<p class='text-muted'>Loading open members...</p>";
    const q = query(collection(db, "users"), where("status", "==", "open"));
    const querySnapshot = await getDocs(q);
    let allUsers = [];
    querySnapshot.forEach(d => { if (d.id !== currentUserProfile.uid) allUsers.push({ id: d.id, ...d.data() }); });
    renderUserCards(allUsers, "all-results", true);
}

window.loadAllProjects = async () => {
    const container = document.getElementById("projects-results");
    container.innerHTML = "<p class='text-muted'>Loading projects...</p>";
    const snap = await getDocs(collection(db, "projects"));
    let html = "";

    snap.forEach(docSnap => {
        const p = docSnap.data();
        const projectId = docSnap.id;

        let membersArray = p.members || [];
        const isMyProject = currentUserProfile && membersArray.some(m => m.uid === currentUserProfile.uid);
        const memberNamesStr = membersArray.map(m => m.name).join(' & ');

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
            <p style="margin: 5px 0 10px;"><strong>Members:</strong> ${memberNamesStr}</p>
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
        window.loadAllProjects();
    } catch (e) { showToast("Failed to update idea", "error"); }
};

// AI RECO 
window.fetchAIRecos = async (forceRefresh = false) => {
    if (hasLoadedRecos && !forceRefresh) return;

    // Only attempt fetch if user is open
    if (!currentUserProfile || currentUserProfile.status !== "open") return;

    const recoContainer = document.getElementById("reco-results");
    recoContainer.innerHTML = "<p class='text-muted'>Scanning vector database...</p>";
    const combinedText = `Experience: ${currentUserProfile.exp}, City: ${currentUserProfile.city}, Domain: ${currentUserProfile.current_domain}, Project: ${currentUserProfile.project_desc}`;

    try {
        const res = await fetch(WEBHOOK_GET_RECO, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: currentUserProfile.uid, combinedText: combinedText })
        });
        const rawResponse = await res.json();

        let extractedUids = [];
        function extractUids(obj) {
            if (!obj) return;
            if (typeof obj === 'string' && /^[0-9]+$/.test(obj)) extractedUids.push(obj);
            else if (typeof obj === 'string' && obj.length === 28 && /^[a-zA-Z0-9]+$/.test(obj)) extractedUids.push(obj);
            else if (Array.isArray(obj)) obj.forEach(extractUids);
            else if (typeof obj === 'object') {
                if (obj.uid && typeof obj.uid === 'string') extractedUids.push(obj.uid);
                else if (obj.id && typeof obj.id === 'string') extractedUids.push(obj.id);
                Object.values(obj).forEach(extractUids);
            }
        }
        extractUids(rawResponse);

        let finalUidsArray = [...new Set(extractedUids)].filter(id => id !== currentUserProfile.uid);
        if (finalUidsArray.length === 0) {
            recoContainer.innerHTML = "<p class='text-muted'>No active AI matches found.</p>";
            return;
        }

        fetchAndRenderUsers(finalUidsArray.slice(0, 5), "reco-results", true);
        hasLoadedRecos = true;

    } catch (e) { showToast("Error connecting to AI.", "error"); }
};

document.getElementById("btn-get-reco").addEventListener("click", () => {
    window.fetchAIRecos(true);
});

function loadInterests() {
    fetchAndRenderUsers(currentUserProfile.interests_received || [], "interests-results", true);
}

window.sendInterest = async (targetUid) => {
    try {
        await updateDoc(doc(db, "users", targetUid), { interests_received: arrayUnion(currentUserProfile.uid) });
        await updateDoc(doc(db, "users", currentUserProfile.uid), { interests_sent: arrayUnion(targetUid) });

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

        const teamId = currentUserProfile.uid + "_" + requesterUid;

        await setDoc(doc(db, "projects", teamId), {
            type: "team",
            members: [
                { uid: currentUserProfile.uid, name: currentUserProfile.name },
                { uid: requesterUid, name: requesterName }
            ],
            project_desc: currentUserProfile.project_desc || requesterProj || "TBD"
        });

        await updateDoc(doc(db, "users", currentUserProfile.uid), {
            status: "teamed_up", team_id: teamId, interests_received: [], interests_sent: []
        });
        await updateDoc(doc(db, "users", requesterUid), {
            status: "teamed_up", team_id: teamId, interests_received: [], interests_sent: []
        });

        fetch(WEBHOOK_EMBED_PROFILE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: currentUserProfile.uid, combinedText: "", status: "teamed_up" }) });
        fetch(WEBHOOK_EMBED_PROFILE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: requesterUid, combinedText: "", status: "teamed_up" }) });

        showToast("Team successfully formed! Reloading...");
        setTimeout(() => window.location.reload(), 1500);
    } catch (e) { showToast("Failed to form team", "error"); }
};

window.rejectInterest = async (requesterUid) => {
    try {
        await updateDoc(doc(db, "users", currentUserProfile.uid), { interests_received: arrayRemove(requesterUid) });
        await updateDoc(doc(db, "users", requesterUid), {
            interests_sent: arrayRemove(currentUserProfile.uid),
            interests_rejected: arrayUnion(currentUserProfile.uid)
        });

        currentUserProfile.interests_received = currentUserProfile.interests_received.filter(id => id !== requesterUid);
        loadInterests();
        showToast("Interest rejected.");
    } catch (e) { showToast("Failed to reject", "error"); }
};

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
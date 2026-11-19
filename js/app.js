import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    arrayUnion,
    arrayRemove,
    collection,
    query,
    where,
    documentId
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

const SYNTHETIC_DOMAIN = "recsys.local";
const WEBHOOK_EMBED_PROFILE = "https://harshad-dev-rag.app.n8n.cloud/webhook/embed-profile";
const WEBHOOK_GET_RECO = "https://harshad-dev-rag.app.n8n.cloud/webhook/get-recommendations";

let currentUserProfile = null;
let platformSettings = {
    maxMembers: 2,
    register_allowed: true,
    load_autocomplete_prelogin: true
};
let hasLoadedRecos = false;
let isRegistering = false;

let cachedAllMembers = [];
let manualTeamSelection = [];
let directoryNameToUsername = new Map();

function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type} show`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 3000);
}

function generateEmbeddingText(u) {
    const idea = (u.project_desc && u.project_desc.trim() !== "") ? u.project_desc : 'Open to collaborative ideas';
    const projDomain = (u.project_domain && u.project_domain.trim() !== "") ? u.project_domain : 'General';
    const workDomain = (u.current_domain && u.current_domain.trim() !== "") ? u.current_domain : 'General';
    const bg = (u.background && u.background.trim() !== "") ? u.background : 'General';
    const exp = u.exp || '1+';
    const city = u.city || 'Anywhere';
    return `Primary Project Focus: ${idea}. Target Project Domain: ${projDomain}. Industry Expertise: ${workDomain}. Professional Background: ${bg}. Location: ${city}. Experience Level: ${exp}.`;
}

function cleanName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, '_').replace(/^_|_$/g, '');
}

function toSyntheticEmail(username) {
    return `${username.trim().toLowerCase()}@${SYNTHETIC_DOMAIN}`;
}

async function loadAutocomplete() {
    const datalist = document.getElementById("user-list");
    datalist.innerHTML = "";
    directoryNameToUsername.clear();

    if (!platformSettings.load_autocomplete_prelogin) return;

    try {
        const snap = await getDocs(collection(db, "user_directory"));
        snap.forEach(docSnap => {
            const u = docSnap.data();
            if (u.username) {
                datalist.innerHTML += `<option value="${u.username}">${u.name || u.username}</option>`;
                if (u.name) {
                    directoryNameToUsername.set(u.name.toLowerCase(), u.username.toLowerCase());
                }
            }
        });
    } catch (e) {
        console.warn("Could not load pre-login autocomplete:", e);
    }
}

async function resolveUsernameFromIdentifier(identifier) {
    const trimmed = identifier.trim();
    const lower = trimmed.toLowerCase();

    // 1. Check cached autocomplete map (if pre-loaded)
    if (directoryNameToUsername.has(lower)) {
        return directoryNameToUsername.get(lower);
    }

    // 2. If user typed a Full Name (contains space or uppercase), look it up in user_directory
    if (trimmed.includes(" ") || trimmed !== lower) {
        try {
            const qName = query(collection(db, "user_directory"), where("name", "==", trimmed));
            const snap = await getDocs(qName);
            if (!snap.empty) {
                return snap.docs[0].data().username.toLowerCase();
            }
        } catch (e) {
            console.warn("Directory name lookup failed, falling back to cleaned username.");
        }
    }

    // 3. Treat directly as username
    return cleanName(trimmed);
}

async function loadPlatformSettings() {
    try {
        const snap = await getDoc(doc(db, "settings", "config"));
        if (snap.exists()) {
            platformSettings = { ...platformSettings, ...snap.data() };
        }
    } catch (e) {
        console.warn("Failed to load platform settings, using defaults:", e);
    }

    if (platformSettings.register_allowed === undefined) platformSettings.register_allowed = true;
    if (platformSettings.load_autocomplete_prelogin === undefined) platformSettings.load_autocomplete_prelogin = true;

    const regButton = document.getElementById("btn-toggle-register");
    if (platformSettings.register_allowed) {
        regButton.classList.remove("hidden");
    } else {
        regButton.classList.add("hidden");
        document.getElementById('register-fields').classList.add('hidden');
    }

    const adminMax = document.getElementById("admin-max-members");
    const adminReg = document.getElementById("admin-register-allowed");
    const adminAuto = document.getElementById("admin-load-autocomplete");
    if (adminMax) adminMax.value = platformSettings.maxMembers || 2;
    if (adminReg) adminReg.checked = platformSettings.register_allowed;
    if (adminAuto) adminAuto.checked = platformSettings.load_autocomplete_prelogin;
}

document.getElementById("btn-save-settings").addEventListener("click", async () => {
    const max = parseInt(document.getElementById("admin-max-members").value);
    const isAllowed = document.getElementById("admin-register-allowed").checked;
    const loadAuto = document.getElementById("admin-load-autocomplete").checked;

    try {
        await setDoc(
            doc(db, "settings", "config"),
            {
                maxMembers: max,
                register_allowed: isAllowed,
                load_autocomplete_prelogin: loadAuto
            },
            { merge: true }
        );

        platformSettings.maxMembers = max;
        platformSettings.register_allowed = isAllowed;
        platformSettings.load_autocomplete_prelogin = loadAuto;

        showToast("Platform Settings Saved!");
    } catch (e) {
        showToast("Failed to save settings: " + e.message, "error");
    }
});

// Initialize settings + Firebase Auth session listener
document.addEventListener("DOMContentLoaded", async () => {
    await loadPlatformSettings();
    await loadAutocomplete();

    onAuthStateChanged(auth, async (user) => {
        if (isRegistering) return; // Wait until registration finishes writing Firestore profile

        if (user) {
            document.getElementById("auth-section").classList.add("hidden");
            document.getElementById("app-section").classList.remove("hidden");
            document.getElementById("welcome-msg").innerText = "Loading profile data...";
            await loadUserProfile(user.uid);
        } else {
            currentUserProfile = null;
            document.getElementById("app-section").classList.add("hidden");
            document.getElementById("auth-section").classList.remove("hidden");
        }
    });
});

window.logoutCustom = async () => {
    try {
        await signOut(auth);
        window.location.reload();
    } catch (e) {
        showToast("Logout failed: " + e.message, "error");
    }
};

document.getElementById("btn-login").addEventListener("click", async (e) => {
    const identifier = document.getElementById("login_identifier").value.trim();
    const password = document.getElementById("password").value;
    const btn = e.target;

    if (!identifier || !password) return showToast("Enter Name/Username and password", "error");
    btn.innerText = "Logging in..."; btn.disabled = true;

    try {
        const username = await resolveUsernameFromIdentifier(identifier);
        const syntheticEmail = toSyntheticEmail(username);
        await signInWithEmailAndPassword(auth, syntheticEmail, password);
        // onAuthStateChanged handles showing the app and loading profile
    } catch (error) {
        if (
            error.code === "auth/invalid-credential" ||
            error.code === "auth/user-not-found" ||
            error.code === "auth/wrong-password"
        ) {
            showToast("Invalid username or password.", "error");
        } else {
            showToast("Login failed: " + error.message, "error");
        }
    } finally {
        btn.innerText = "Login"; btn.disabled = false;
    }
});

document.getElementById("btn-register").addEventListener("click", async (e) => {
    if (!platformSettings.register_allowed) {
        return showToast("New registrations are currently disabled by the Administrator.", "error");
    }

    const identifier = document.getElementById("login_identifier").value.trim();
    const password = document.getElementById("password").value;
    const btn = e.target;

    if (!identifier || !password) return showToast("Name/Username and Password are required.", "error");
    if (password.length < 6) return showToast("Password must be at least 6 characters.", "error");

    btn.innerText = "Creating Profile..."; btn.disabled = true;
    isRegistering = true;

    try {
        let baseUsername = cleanName(identifier);
        if (!baseUsername) {
            isRegistering = false;
            return showToast("Please enter a valid name or username.", "error");
        }

        let finalUsername = baseUsername;
        const usernameCheck = await getDocs(
            query(collection(db, "user_directory"), where("username", "==", baseUsername))
        );
        if (!usernameCheck.empty) {
            finalUsername = `${baseUsername}_${Date.now().toString().slice(-4)}`;
        }

        const syntheticEmail = toSyntheticEmail(finalUsername);
        const userCredential = await createUserWithEmailAndPassword(auth, syntheticEmail, password);
        const uidStr = userCredential.user.uid;

        const userData = {
            uid: uidStr,
            username: finalUsername,
            name: identifier,
            exp: document.getElementById("exp").value,
            city: document.getElementById("city").value,
            background: document.getElementById("background").value,
            current_domain: document.getElementById("domain").value,
            linkedin: document.getElementById("linkedin").value.trim(),
            contact: document.getElementById("contact").value.trim(),
            project_domain: document.getElementById("proj_domain").value,
            project_desc: document.getElementById("proj_desc").value,
            status: "open",
            team_id: null,
            interests_received: [],
            interests_sent: [],
            interests_rejected: [],
            random_matches: [],
            isAdmin: false
        };

        await setDoc(doc(db, "users", uidStr), userData);
        await setDoc(doc(db, "user_directory", uidStr), {
            username: finalUsername,
            name: identifier
        });

        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: uidStr, combinedText: generateEmbeddingText(userData), status: userData.status })
        });

        showToast(`Profile created! Username: ${finalUsername}`);
        isRegistering = false;
        setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
        isRegistering = false;
        showToast("Registration failed: " + error.message, "error");
    } finally {
        btn.innerText = "Register & Create Profile"; btn.disabled = false;
    }
});

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
        document.getElementById("nav-profile").click();

        const checkAdmin = currentUserProfile.isAdmin === true || String(currentUserProfile.isAdmin).toLowerCase() === "true";
        if (checkAdmin) document.getElementById("nav-admin").classList.remove("hidden");

        if (currentUserProfile.interests_received.length > 0) {
            document.getElementById("nav-red-dot").classList.remove("hidden");
        }

        document.getElementById("nav-search").classList.remove("hidden");

        await loadAllMembers();
        loadInterests();
        fetchAndRenderUsers(currentUserProfile.interests_sent, "sent-results", false, false, true);

        if (currentUserProfile.random_matches.length === 0) {
            document.getElementById("random-results").innerHTML = "<p class='text-muted'>Wait for admin for random matches.</p>";
        } else {
            fetchAndRenderUsers(currentUserProfile.random_matches, "random-results", true);
        }

        if (currentUserProfile.status !== "open") {
            document.getElementById("reco-results").innerHTML = "<p class='text-muted' style='color: var(--danger); font-weight: 500;'>Available only for status Open.</p>";
            const refreshBtn = document.getElementById("btn-get-reco");
            if (refreshBtn) refreshBtn.classList.add("hidden");
        } else {
            document.getElementById("reco-results").innerHTML = "<p class='text-muted'>Click 'Refresh Matches' to query the AI.</p>";
            const refreshBtn = document.getElementById("btn-get-reco");
            if (refreshBtn) refreshBtn.classList.remove("hidden");
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

function populateFilterDropdowns() {
    const exps = new Set(), cities = new Set(), backgrounds = new Set();
    const workDomains = new Set(), projDomains = new Set(), statuses = new Set();

    cachedAllMembers.forEach(u => {
        if (u.exp) exps.add(u.exp);
        if (u.city) cities.add(u.city);
        if (u.background) backgrounds.add(u.background);
        if (u.current_domain) workDomains.add(u.current_domain);
        if (u.project_domain) projDomains.add(u.project_domain);
        if (u.status) statuses.add(u.status);
    });

    const fillSelect = (id, set) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '<option value="Any">Any</option>';
        Array.from(set).filter(Boolean).sort().forEach(val => {
            el.innerHTML += `<option value="${val}">${val}</option>`;
        });
    };

    fillSelect('filter-exp', exps);
    fillSelect('filter-city', cities);
    fillSelect('filter-background', backgrounds);
    fillSelect('filter-work', workDomains);
    fillSelect('filter-project', projDomains);
    fillSelect('filter-status', statuses);
}

function executeMemberSearch() {
    const nameVal = document.getElementById('filter-name').value.toLowerCase().trim();
    const expVal = document.getElementById('filter-exp').value;
    const cityVal = document.getElementById('filter-city').value;
    const bgVal = document.getElementById('filter-background').value;
    const workVal = document.getElementById('filter-work').value;
    const projVal = document.getElementById('filter-project').value;
    const statusVal = document.getElementById('filter-status').value;

    const filtered = cachedAllMembers.filter(u => {
        if (nameVal && !(u.name.toLowerCase().includes(nameVal) || (u.username && u.username.toLowerCase().includes(nameVal)))) return false;
        if (expVal !== "Any" && u.exp !== expVal) return false;
        if (cityVal !== "Any" && u.city !== cityVal) return false;
        if (bgVal !== "Any" && u.background !== bgVal) return false;
        if (workVal !== "Any" && u.current_domain !== workVal) return false;
        if (projVal !== "Any" && u.project_domain !== projVal) return false;
        if (statusVal !== "Any" && u.status !== statusVal) return false;
        return true;
    });

    filtered.sort((a, b) => {
        const aHasProjectInfo = ((a.project_desc && a.project_desc.trim() !== "") || (a.project_domain && a.project_domain.trim() !== "")) ? 1 : 0;
        const bHasProjectInfo = ((b.project_desc && b.project_desc.trim() !== "") || (b.project_domain && b.project_domain.trim() !== "")) ? 1 : 0;
        return bHasProjectInfo - aHasProjectInfo;
    });

    renderUserCards(filtered, "member-search-results", true);
}

['filter-name', 'filter-exp', 'filter-city', 'filter-background', 'filter-work', 'filter-project', 'filter-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(id === 'filter-name' ? 'input' : 'change', executeMemberSearch);
    }
});

document.getElementById("edit_status").addEventListener("change", (e) => {
    const val = e.target.value;
    const container = document.getElementById("manual-team-setup");
    if (val === "teamed_up" && currentUserProfile.status !== "teamed_up") {
        container.classList.remove("hidden");
        document.getElementById("lbl-max-members").innerText = platformSettings.maxMembers;
        manualTeamSelection = [];
        renderManualTeamSelection();
    } else {
        container.classList.add("hidden");
    }
});

document.getElementById("profile-team-search").addEventListener("input", (e) => {
    const val = e.target.value.toLowerCase().trim();
    const dropdown = document.getElementById("profile-team-dropdown");
    if (val.length < 2) {
        dropdown.innerHTML = "";
        return;
    }

    const filtered = cachedAllMembers.filter(u =>
        u.status === "open" &&
        u.name.toLowerCase().includes(val) &&
        !manualTeamSelection.some(m => m.uid === u.uid)
    ).slice(0, 5);

    let html = "";
    filtered.forEach(u => {
        html += `<div style="padding:10px; border-bottom:1px solid rgba(255,255,255,0.05); cursor:pointer;" class="dropdown-item" onclick="addManualTeamMember('${u.uid}')">
            <strong>${u.name}</strong> <span class="text-muted" style="font-size:0.8rem;">(${u.exp}, ${u.city || 'No City'})</span>
        </div>`;
    });
    if (html === "") html = "<div style='padding:10px;' class='text-muted'>No members found.</div>";
    dropdown.innerHTML = html;
});

window.addManualTeamMember = (uid) => {
    if (manualTeamSelection.length >= platformSettings.maxMembers - 1) {
        return showToast(`Max team size is ${platformSettings.maxMembers} (You + ${platformSettings.maxMembers - 1} members).`, "error");
    }
    const user = cachedAllMembers.find(u => u.uid === uid);
    if (user) {
        manualTeamSelection.push(user);
        document.getElementById("profile-team-search").value = "";
        document.getElementById("profile-team-dropdown").innerHTML = "";
        renderManualTeamSelection();
    }
};

window.removeManualTeamMember = (uid) => {
    manualTeamSelection = manualTeamSelection.filter(u => u.uid !== uid);
    renderManualTeamSelection();
};

function renderManualTeamSelection() {
    const container = document.getElementById("profile-selected-members");
    let html = "";
    manualTeamSelection.forEach(u => {
        html += `<div class="flex-between" style="background: rgba(20, 184, 166, 0.1); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(20, 184, 166, 0.3);">
            <span>${u.name}</span>
            <button class="btn btn-danger" style="width:auto; padding:4px 8px; font-size:0.75rem;" onclick="removeManualTeamMember('${u.uid}')">Remove</button>
        </div>`;
    });
    container.innerHTML = html;
}

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
                            body: JSON.stringify({ uid: m.uid, combinedText: generateEmbeddingText(od), status: "open" })
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
        let creatingNewTeamManually = false;
        let newTeamId = null;

        if (updatedData.status === "teamed_up" && currentUserProfile.status !== "teamed_up") {
            if (manualTeamSelection.length < 1) {
                return showToast(`You must select at least 1 team member!`, "error");
            }
            creatingNewTeamManually = true;
            newTeamId = currentUserProfile.uid + "_" + Date.now();
            updatedData.team_id = newTeamId;
            updatedData.interests_received = [];
            updatedData.interests_sent = [];
        }

        if (currentUserProfile.team_id && (updatedData.status === "open" || updatedData.status === "solo")) {
            await leaveTeam(currentUserProfile.uid, currentUserProfile.team_id);
            updatedData.team_id = null;
        }

        if (currentUserProfile.status === "solo" && updatedData.status === "open") {
            await deleteDoc(doc(db, "projects", currentUserProfile.uid));
        }

        await updateDoc(doc(db, "users", currentUserProfile.uid), updatedData);

        // Keep user_directory synced if full name changed
        if (updatedData.name !== currentUserProfile.name) {
            await setDoc(
                doc(db, "user_directory", currentUserProfile.uid),
                { username: currentUserProfile.username, name: updatedData.name },
                { merge: true }
            );
        }

        if (updatedData.status === "solo") {
            await setDoc(doc(db, "projects", currentUserProfile.uid), {
                type: "solo", members: [{ uid: currentUserProfile.uid, name: updatedData.name }],
                project_desc: updatedData.project_desc || "Working Solo"
            });
        }

        if (creatingNewTeamManually) {
            const newMembers = [
                { uid: currentUserProfile.uid, name: updatedData.name },
                ...manualTeamSelection.map(m => ({ uid: m.uid, name: m.name }))
            ];
            await setDoc(doc(db, "projects", newTeamId), {
                type: "team", members: newMembers, project_desc: updatedData.project_desc || "TBD"
            });

            for (let m of manualTeamSelection) {
                await updateDoc(doc(db, "users", m.uid), {
                    status: "teamed_up", team_id: newTeamId, interests_received: [], interests_sent: []
                });

                const odSnap = await getDoc(doc(db, "users", m.uid));
                if (odSnap.exists()) {
                    const od = odSnap.data();
                    fetch(WEBHOOK_EMBED_PROFILE, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ uid: m.uid, combinedText: generateEmbeddingText(od), status: "teamed_up" })
                    });
                }
            }
        }

        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: currentUserProfile.uid, combinedText: generateEmbeddingText(updatedData), status: updatedData.status })
        });

        showToast("Profile updated successfully!");
        setTimeout(() => window.location.reload(), 1000);
    } catch (e) { showToast("Failed to update profile", "error"); }
});

// Firebase Auth Password Update (Reauthenticate + Update)
document.getElementById("btn-change-password").addEventListener("click", async (e) => {
    const currentPass = document.getElementById("current_password").value;
    const newPass = document.getElementById("new_password").value;
    const confirmPass = document.getElementById("confirm_password").value;
    const btn = e.target;

    if (!currentPass || !newPass || !confirmPass) return showToast("Please fill out all password fields.", "error");
    if (newPass.length < 6) return showToast("New password must be at least 6 characters.", "error");
    if (newPass !== confirmPass) return showToast("New passwords do not match.", "error");

    const user = auth.currentUser;
    if (!user) return showToast("Session expired. Please log in again.", "error");

    btn.innerText = "Updating..."; btn.disabled = true;

    try {
        const credential = EmailAuthProvider.credential(user.email, currentPass);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPass);

        showToast("Password updated successfully!");
        document.getElementById("current_password").value = "";
        document.getElementById("new_password").value = "";
        document.getElementById("confirm_password").value = "";
    } catch (error) {
        if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
            showToast("Incorrect current password.", "error");
        } else {
            showToast("Failed to update password: " + error.message, "error");
        }
    } finally {
        btn.innerText = "Update Password"; btn.disabled = false;
    }
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
            } else if (u.status === "open") {
                actionButtons = `<button class="btn btn-outline" id="btn-send-${u.id}" onclick="sendInterest('${u.id}')">Send Interest</button>`;
            } else {
                actionButtons = `<button class="btn btn-outline" disabled style="opacity:0.5; border-color:rgba(255,255,255,0.2); color:#a1a1aa; cursor:not-allowed;">Unavailable</button>`;
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

        let statusBadgeColor = u.status === 'open' ? 'var(--success)' : (u.status === 'solo' ? '#f59e0b' : '#3b82f6');
        let statusBadge = `<span class="badge" style="background-color: ${statusBadgeColor}20; color: ${statusBadgeColor};">${u.status.toUpperCase().replace('_', ' ')}</span>`;

        html += `<div class="card user-card">
            <h4>${u.name} <span class="badge">${u.city || 'No City'}</span> ${statusBadge}</h4>
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

    allUsers.sort((a, b) => uidArray.indexOf(a.id) - uidArray.indexOf(b.id));
    renderUserCards(allUsers, containerId, allowActions, isSentTab);
}

async function loadAllMembers() {
    const q = query(collection(db, "users"));
    const querySnapshot = await getDocs(q);
    let allUsers = [];
    querySnapshot.forEach(d => {
        if (d.id !== currentUserProfile.uid) {
            allUsers.push({ id: d.id, uid: d.id, ...d.data() });
        }
    });
    cachedAllMembers = allUsers;

    populateFilterDropdowns();
    executeMemberSearch();
}

window.loadAllProjects = async () => {
    const container = document.getElementById("projects-results");
    container.innerHTML = "<p class='text-muted'>Loading projects...</p>";
    const snap = await getDocs(collection(db, "projects"));
    let html = "";
    let groupCounter = 1;

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
                    <textarea id="edit-proj-${projectId}" class="hidden" rows="4" style="width:100%; margin-bottom:10px; font-family: inherit; resize: vertical;">${p.project_desc}</textarea>
                    <button id="btn-edit-${projectId}" class="btn btn-outline" style="padding: 4px 10px; font-size: 0.8rem; width: auto;" onclick="toggleEditProject('${projectId}')">Edit Idea</button>
                    <button id="btn-save-${projectId}" class="btn btn-primary hidden" style="padding: 4px 10px; font-size: 0.8rem; width: auto;" onclick="saveProjectIdea('${projectId}')">Save Idea</button>
                </div>
            `;
        }

        html += `<div class="card" style="border-left: 4px solid var(--primary);">
            <h4 style="color:var(--primary); margin-bottom: 5px;">Group ${groupCounter}</h4>
            <p style="margin: 5px 0 15px;"><strong>Members:</strong> ${memberNamesStr}</p>
            <div style="background:rgba(0,0,0,0.2); padding:12px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                <strong style="color:var(--primary); font-size:0.875rem;">Final Project Idea:</strong><br/> 
                <span id="text-proj-${projectId}" style="font-size:0.95rem; display:block; margin-top:5px; white-space: pre-wrap;">${p.project_desc}</span>
                ${editHtml}
            </div>
        </div>`;
        groupCounter++;
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

window.fetchAIRecos = async (forceRefresh = false) => {
    if (hasLoadedRecos && !forceRefresh) return;
    if (!currentUserProfile) return;

    const recoContainer = document.getElementById("reco-results");

    if (currentUserProfile.status !== "open") {
        recoContainer.innerHTML = "<p class='text-muted' style='color: var(--danger); font-weight: 500;'>Available only for status Open.</p>";
        document.getElementById("btn-get-reco").classList.add("hidden");
        return;
    }

    recoContainer.innerHTML = "<p class='text-muted'>Scanning vector database...</p>";

    try {
        const res = await fetch(WEBHOOK_GET_RECO, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: currentUserProfile.uid, combinedText: generateEmbeddingText(currentUserProfile) })
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

        fetch(WEBHOOK_EMBED_PROFILE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: currentUserProfile.uid, combinedText: generateEmbeddingText(currentUserProfile), status: "teamed_up" }) });
        fetch(WEBHOOK_EMBED_PROFILE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: requesterUid, combinedText: generateEmbeddingText(requesterSnap.data()), status: "teamed_up" }) });

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
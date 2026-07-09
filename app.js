import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// ⚠️ Firebase Config (星翔の設定を上書きしてね)
const firebaseConfig = {
  apiKey: "AIzaSyB5UE_wkcBoBsaGo0warU40csxJAWi73-I",
  authDomain: "hybrid-kakeibo.firebaseapp.com",
  projectId: "hybrid-kakeibo",
  storageBucket: "hybrid-kakeibo.firebasestorage.app",
  messagingSenderId: "172145728222",
  appId: "1:172145728222:web:bf5c35f9764b5152b0c04f",
  measurementId: "G-5SV54CHL1W"
};

// 🚀 Google AI Studio で取得した Gemini APIキー
const GEMINI_API_KEY = "AIzaSyAgLIOMAciS228NZyGJxmnbqIIJhdZEEA4";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// アプリの内部ステート管理
let isSignUpMode = false;
let currentDataType = "expense";
let currentMethods = ["現金", "ゆうちょ銀行", "三菱UFJ銀行", "三井住友銀行", "クレジットカード"];
let methodConfigs = { 
  "現金": { type: "asset" }, 
  "ゆうちょ銀行": { type: "asset-debit" }, 
  "三菱UFJ銀行": { type: "asset-debit" },
  "三井住友銀行": { type: "asset-debit" },
  "クレジットカード": { type: "credit", linkedBank: "ゆうちょ銀行" } 
};

let expenseCategories = ["食費", "日用品", "交通費", "娯楽", "その他"];
let incomeCategories = ["給与", "バイト代", "お小遣い", "副収入", "その他"];
let unsubscribeTransactions = null;
let stealthTargets = { methods: [], categories: [] };
let isInputAmountMasked = false;
let isTotalAssetMasked = false;
let maskedBanks = {}; 
let cachedGrandTotal = 0;
let cachedBalances = {};
let modalSelectedType = "asset";

// --------------------------------=========
// 💡 UI・ページ制御ロジック
// --------------------------------=========
function setInitialDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('transactionDate').value = `${year}-${month}-${day}T${hours}:${minutes}`;
}

window.switchPage = function(pageName) {
  document.querySelectorAll('.app-page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  if (pageName === 'input') {
    document.getElementById('page-input').classList.add('active');
    document.getElementById('navTabInput').classList.add('active');
    document.getElementById('mainHeaderTitle').innerText = "💸 支出・収入入力";
  } else {
    document.getElementById('page-balance').classList.add('active');
    document.getElementById('navTabBalance').classList.add('active');
    document.getElementById('mainHeaderTitle').innerText = "🏦 残高・口座一覧";
  }
};

window.switchType = function(type) {
  currentDataType = type;
  const btnExpense = document.getElementById("btnExpense");
  const btnIncome = document.getElementById("btnIncome");
  const catSelect = document.getElementById("category");
  catSelect.innerHTML = "";
  if (type === "expense") {
    btnExpense.classList.add("active");
    btnIncome.classList.remove("active");
    document.getElementById("labelAmount").innerText = "金額";
    document.getElementById("labelMethod").innerText = "支払い方法";
    expenseCategories.forEach(c => catSelect.innerHTML += `<option value="${c}">${c}</option>`);
  } else {
    btnIncome.classList.add("active");
    btnExpense.classList.remove("active");
    document.getElementById("labelAmount").innerText = "収入金額";
    document.getElementById("labelMethod").innerText = "受取先・口座";
    incomeCategories.forEach(c => catSelect.innerHTML += `<option value="${c}">${c}</option>`);
  }
};

// --------------------------------=========
// 🧮 カスタム電卓ロジック
// --------------------------------=========
const amountField = document.getElementById("amount");
const bottomNumpad = document.getElementById("bottomNumpad");
const calcPreview = document.getElementById("calcPreview");
const historyTape = document.getElementById("historyTape");
let currentVal = "";
let previousVal = "";
let operation = null;
let shouldResetScreen = false;
let amountHistory = JSON.parse(localStorage.getItem('kakeibo-history')) || [];

function updateDisplay() {
  if (isInputAmountMasked) {
    amountField.value = "¥ ****";
  } else {
    amountField.value = currentVal === "" ? "¥ 0" : "¥ " + Number(currentVal).toLocaleString();
  }
  calcPreview.innerText = operation ? `${Number(previousVal).toLocaleString()} ${operation} ${currentVal ? Number(currentVal).toLocaleString() : ''}` : "";
}

window.toggleInputMask = function() {
  isInputAmountMasked = !isInputAmountMasked;
  document.getElementById("btnHideAmount").innerText = isInputAmountMasked ? "✖️" : "👁️";
  updateDisplay();
};

window.toggleTotalMask = function() { isTotalAssetMasked = !isTotalAssetMasked; renderBalancesUI(); };
window.toggleBankMask = function(bankName) { maskedBanks[bankName] = !maskedBanks[bankName]; renderBalancesUI(); };

function renderHistory() {
  historyTape.innerHTML = "";
  amountHistory.forEach(val => {
    const chip = document.createElement("div");
    chip.className = "history-chip";
    chip.innerText = "¥ " + Number(val).toLocaleString();
    chip.onclick = () => { currentVal = val.toString(); operation = null; previousVal = ""; updateDisplay(); };
    historyTape.appendChild(chip);
  });
}
renderHistory();

window.inputNum = function(num) { if (shouldResetScreen) { currentVal = ""; shouldResetScreen = false; } if (currentVal === "0" && num !== "0" && num !== "00") currentVal = ""; if (currentVal.length < 9) currentVal += num; updateDisplay(); };
window.chooseOp = function(op) { if (currentVal === "") return; if (previousVal !== "") compute(); operation = op; previousVal = currentVal; currentVal = ""; updateDisplay(); };
window.compute = function() { let computation; const prev = parseFloat(previousVal); const current = parseFloat(currentVal); if (isNaN(prev) || isNaN(current)) return; switch (operation) { case '+': computation = prev + current; break; case '-': computation = prev - current; break; case '×': computation = prev * current; break; case '÷': computation = prev / current; break; default: return; } currentVal = Math.floor(computation).toString(); operation = null; previousVal = ""; shouldResetScreen = true; updateDisplay(); };
window.addTax = function() { if (currentVal === "") return; currentVal = Math.floor(Number(currentVal) * 1.1).toString(); shouldResetScreen = true; updateDisplay(); };
window.clearNum = function() { currentVal = ""; previousVal = ""; operation = null; updateDisplay(); };
window.backspaceNum = function() { currentVal = currentVal.slice(0, -1); updateDisplay(); };

amountField.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); amountField.blur(); bottomNumpad.classList.add("open"); });
window.closeNumpad = function() { bottomNumpad.classList.remove("open"); };
document.addEventListener("click", (e) => { if (!bottomNumpad.contains(e.target) && e.target !== amountField) closeNumpad(); });

// テーマ・メニュー制御
const savedTheme = localStorage.getItem('kakeibo-theme') || 'theme-cyber';
document.body.className = savedTheme;
window.changeTheme = function(themeName) { document.body.className = themeName; localStorage.setItem('kakeibo-theme', themeName); toggleMenu(); };
const menuBtn = document.getElementById('menuBtn');
const fullMenu = document.getElementById('fullMenu');
function toggleMenu() { menuBtn.classList.toggle('open'); fullMenu.classList.toggle('open'); }
menuBtn.addEventListener('click', toggleMenu);

document.getElementById("paymentMethod").addEventListener("change", function() {
  const selected = this.value;
  const config = methodConfigs[selected] || {type:"asset"};
  const hintEl = document.getElementById("methodHintText");
  if(config.type === "asset-debit") { hintEl.innerText = `🔄 [デビット一体型] 残高から即座に引き落とされます`; hintEl.style.color = "#00ff66"; }
  else if(config.type === "credit") { hintEl.innerText = `💳 [クレジット] 未払金(負債)として記録されます`; hintEl.style.color = "#ffaa00"; }
  else { hintEl.innerText = ""; }
});

function renderMethods() {
  const select = document.getElementById("paymentMethod");
  select.innerHTML = "";
  currentMethods.forEach(method => { const opt = document.createElement("option"); opt.value = method; opt.innerText = method; select.appendChild(opt); });
  if(select.options.length > 0) select.dispatchEvent(new Event('change'));
}

// --------------------------------=========
// 🏦 財務集計・リアルタイムレンダリング
// --------------------------------=========
function renderBalancesUI() {
  document.getElementById("allAssetTotal").innerText = isTotalAssetMasked ? "¥ *****" : "¥ " + cachedGrandTotal.toLocaleString();
  const container = document.getElementById("bankListContainer");
  container.innerHTML = "";
  Object.keys(cachedBalances).forEach(name => {
    if ((stealthTargets.methods || []).includes(name)) return;
    const config = methodConfigs[name] || {type:"asset"};
    const bal = cachedBalances[name];
    const signClass = bal >= 0 ? "plus" : "minus";
    
    let badge = ""; 
    if (config.type === "credit") badge = `<span class="badge-credit" style="color:#ffaa00; border:1px solid #ffaa00;">未払金</span>`; 
    if (config.type === "asset") badge = `<span class="badge-debit" style="color:#00bfff; border:1px solid #00bfff;">資産</span>`; 
    if (config.type === "asset-debit") badge = `<span class="badge-debit" style="color:#00bfff; border:1px solid #00bfff;">資産</span><span class="badge-debit" style="color:#ccff00; border:1px solid #ccff00; margin-left:4px;">デビット</span>`;

    const isBankHidden = maskedBanks[name] || false;
    const displayBalance = isBankHidden ? "¥ ****" : "¥ " + bal.toLocaleString();
    const eyeIcon = isBankHidden ? "✖️" : "👁️";
    container.innerHTML += `<div class="bank-item"><span class="bank-name">${name} ${badge}</span><div class="bank-right"><span class="bank-balance ${signClass}">${displayBalance}</span><button type="button" class="btn-stealth-eye" onclick="toggleBankMask('${name}')">${eyeIcon}</button><button type="button" class="btn-delete-method" onclick="deleteMethod('${name}')">🗑️</button></div></div>`;
  });
}

function startRealtimeBalanceSync(uid) {
  const q = query(collection(db, "transactions"), where("userId", "==", uid));
  unsubscribeTransactions = onSnapshot(q, (snapshot) => {
    cachedBalances = {};
    cachedGrandTotal = 0;
    currentMethods.forEach(m => cachedBalances[m] = 0);
    snapshot.forEach(doc => {
      const data = doc.data();
      const amount = data.amount || 0;
      const type = data.type || "expense";
      const method = data.paymentMethod;
      const category = data.category;
      if ((stealthTargets.methods || []).includes(method) || (stealthTargets.categories || []).includes(category)) return;
      
      const config = methodConfigs[method] || { type: "asset" };
      let targetMethod = method;
      if (!cachedBalances[targetMethod]) cachedBalances[targetMethod] = 0;
      
      if (type === "income") {
        cachedBalances[targetMethod] += amount;
        if(config.type !== "credit") cachedGrandTotal += amount;
      } else {
        cachedBalances[targetMethod] -= amount;
        if(config.type !== "credit") cachedGrandTotal -= amount;
      }
    });
    renderBalancesUI();
  });
}

// --------------------------------=========
// 💡 自作カスタムダイアログエンジン (Promise)
// --------------------------------=========
window.showCustomAlert = function(msg) {
  return new Promise((resolve) => {
    document.getElementById('alertMessage').innerText = msg;
    const modal = document.getElementById('customAlertModal');
    modal.style.display = 'flex'; setTimeout(() => modal.classList.add('open'), 10);
    window.closeCustomAlert = function() { modal.classList.remove('open'); setTimeout(() => { modal.style.display = 'none'; resolve(); }, 300); };
  });
};

window.showCustomConfirm = function(msg) {
  return new Promise((resolve) => {
    document.getElementById('confirmMessage').innerText = msg;
    const modal = document.getElementById('customConfirmModal');
    modal.style.display = 'flex'; setTimeout(() => modal.classList.add('open'), 10);
    window.confirmAction = function(result) { modal.classList.remove('open'); setTimeout(() => { modal.style.display = 'none'; resolve(result); }, 300); };
  });
};

// 口座の削除
window.deleteMethod = async function(name) {
  const isConfirmed = await showCustomConfirm(`「${name}」をシステムから抹消しますか？\n\n※過去の明細データは消えませんが、一覧には表示されなくなります。`);
  if(isConfirmed) {
    currentMethods = currentMethods.filter(m => m !== name);
    delete methodConfigs[name];
    if (auth.currentUser) {
      await setDoc(doc(db, "user_settings", auth.currentUser.uid), { paymentMethods: currentMethods, methodConfigs: methodConfigs }, { merge: true });
      renderMethods();
      await showCustomAlert(`「${name}」を抹消しました。`);
    }
  }
};

// --------------------------------=========
// 🏷️ カテゴリ追加・モーダル制御
// --------------------------------=========
window.openAddCategoryModal = function() {
  const modal = document.getElementById("addCategoryModal");
  const title = currentDataType === "expense" ? "⚡ 新しい支出カテゴリ" : "⚡ 新しい収入源";
  document.getElementById("categoryModalTitle").innerText = title;
  document.getElementById("newCategoryName").value = "";
  modal.style.display = "flex"; setTimeout(() => modal.classList.add("open"), 10);
  document.getElementById("newCategoryName").focus();
};

window.closeAddCategoryModal = function(e) { if (e === null || e.target === document.getElementById("addCategoryModal")) { const modal = document.getElementById("addCategoryModal"); modal.classList.remove("open"); setTimeout(() => modal.style.display = "none", 300); } };

window.executeAddCategory = async function() {
  const nameInp = document.getElementById("newCategoryName").value;
  if (!nameInp || nameInp.trim() === "") { await showCustomAlert("名称を入力してね！"); return; }
  const trimmed = nameInp.trim();
  const isExpense = currentDataType === "expense";
  const targetArray = isExpense ? expenseCategories : incomeCategories;
  if (!targetArray.includes(trimmed)) {
    targetArray.push(trimmed); switchType(currentDataType); document.getElementById("category").value = trimmed; 
    if (auth.currentUser) await setDoc(doc(db, "user_settings", auth.currentUser.uid), { expenseCategories: expenseCategories, incomeCategories: incomeCategories }, { merge: true });
    closeAddCategoryModal(null);
  } else {
    await showCustomAlert("そのカテゴリはすでに登録されているよ！");
  }
};

// --------------------------------=========
// 🏦 口座口座追加・モーダル制御
// --------------------------------=========
window.openAddMethodModal = function() {
  const modal = document.getElementById("addMethodModal");
  const linkSelect = document.getElementById("newMethodLink");
  linkSelect.innerHTML = "";
  Object.keys(methodConfigs).forEach(k => { if(methodConfigs[k].type === "asset" || methodConfigs[k].type === "asset-debit") linkSelect.innerHTML += `<option value="${k}">${k}</option>`; });
  modal.style.display = "flex"; setTimeout(() => modal.classList.add("open"), 10);
  selectModalType('asset'); document.getElementById("newMethodName").value = ""; document.getElementById("newMethodBalance").value = "0";
};

window.closeAddMethodModal = function(e) { if (e === null || e.target === document.getElementById("addMethodModal")) { const modal = document.getElementById("addMethodModal"); modal.classList.remove("open"); setTimeout(() => modal.style.display = "none", 300); } };

window.selectModalType = function(type) {
  modalSelectedType = type; document.querySelectorAll(".segment-btn").forEach(btn => btn.classList.remove("active"));
  const linkWrapper = document.getElementById("modalLinkedWrapper"); const balanceWrapper = document.getElementById("modalInitialBalanceWrapper");
  if (type === "asset") { document.getElementById("segAsset").classList.add("active"); linkWrapper.classList.remove("show"); balanceWrapper.style.display = "block"; } 
  else if (type === "asset-debit") { document.getElementById("segAssetDebit").classList.add("active"); linkWrapper.classList.remove("show"); balanceWrapper.style.display = "block"; } 
  else if (type === "credit") { document.getElementById("segCredit").classList.add("active"); linkWrapper.classList.add("show"); balanceWrapper.style.display = "none"; } 
};

window.executeAddMethod = async function() {
  const nameInp = document.getElementById("newMethodName").value;
  if(!nameInp || nameInp.trim() === "") { await showCustomAlert("名称を入力してね！"); return; }
  const trimmedName = nameInp.trim();
  if (currentMethods.includes(trimmedName)) { await showCustomAlert("すでに登録されているよ！"); return; }
  let configObj = { type: modalSelectedType };
  if (modalSelectedType === "credit") {
    const linked = document.getElementById("newMethodLink").value;
    if(!linked) { await showCustomAlert("連動させる口座（銀行）を先に作ってね！"); return; }
    configObj.linkedBank = linked;
  }
  currentMethods.push(trimmedName); methodConfigs[trimmedName] = configObj;
  renderMethods(); document.getElementById("paymentMethod").value = trimmedName; document.getElementById("paymentMethod").dispatchEvent(new Event('change'));
  if (auth.currentUser) {
    await setDoc(doc(db, "user_settings", auth.currentUser.uid), { paymentMethods: currentMethods, methodConfigs: methodConfigs }, { merge: true });
    const initialBal = Number(document.getElementById("newMethodBalance").value);
    if ((modalSelectedType === "asset" || modalSelectedType === "asset-debit") && initialBal > 0) await addDoc(collection(db, "transactions"), { amount: initialBal, category: "初期残高設定", type: "income", paymentMethod: trimmedName, memo: "システム自動初期設定", date: new Date(), userId: auth.currentUser.uid });
    closeAddMethodModal(null); await showCustomAlert(`「${trimmedName}」をシステムに登録したよ！`);
  }
};

// --------------------------------=========
// 🔒 Firebase認証 & データ初期ロード
// --------------------------------=========
onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("authScreen").style.display = "none"; document.getElementById("appHeader").style.display = "flex"; document.getElementById("bottomNav").style.display = "flex";
    const userRef = doc(db, "user_settings", user.uid); const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.paymentMethods) currentMethods = data.paymentMethods;
      if (data.methodConfigs) methodConfigs = data.methodConfigs;
      if (data.expenseCategories) expenseCategories = data.expenseCategories;
      if (data.incomeCategories) incomeCategories = data.incomeCategories;
      if (data.stealthTargets) stealthTargets = data.stealthTargets;
    } else {
      await setDoc(userRef, { paymentMethods: currentMethods, methodConfigs: methodConfigs, expenseCategories: expenseCategories, incomeCategories: incomeCategories }, { merge: true });
    }
    renderMethods(); switchType("expense"); switchPage("input"); clearNum(); setInitialDateTime(); startRealtimeBalanceSync(user.uid);
  } else {
    document.getElementById("authScreen").style.display = "block"; document.getElementById("appHeader").style.display = "none"; document.getElementById("bottomNav").style.display = "none";
    if (unsubscribeTransactions) unsubscribeTransactions();
  }
});

document.getElementById("authForm").addEventListener("submit", async (e) => { e.preventDefault(); const email = document.getElementById("authEmail").value; const password = document.getElementById("authPassword").value; try { if (isSignUpMode) { await createUserWithEmailAndPassword(auth, email, password); } else { await signInWithEmailAndPassword(auth, email, password); } } catch (error) { await showCustomAlert(`エラー: ${error.message}`); } });
document.getElementById("authToggle").addEventListener("click", (e) => { isSignUpMode = !isSignUpMode; e.target.innerText = isSignUpMode ? "ログイン画面へ戻る" : "新規登録モードへ切り替え"; document.querySelector("#authForm button").innerText = isSignUpMode ? "新規登録" : "ログイン"; });
document.getElementById("logoutLink").addEventListener("click", () => { toggleMenu(); signOut(auth); });

// 記録ボタンの押下
document.getElementById("submitBtn").addEventListener("click", async () => {
  if (operation !== null) compute(); const amount = Number(currentVal); const category = document.getElementById("category").value; const paymentMethod = document.getElementById("paymentMethod").value; const memo = document.getElementById("memo").value; const dateString = document.getElementById("transactionDate").value;
  if (!amount || amount === 0) { await showCustomAlert("金額を入力してね！"); return; }
  if (!dateString) { await showCustomAlert("日時がセットされていません。"); return; }
  const selectedDate = new Date(dateString);
  try {
    await addDoc(collection(db, "transactions"), { amount: amount, category: category, type: currentDataType, paymentMethod: paymentMethod, memo: memo, date: selectedDate, userId: auth.currentUser.uid });
    amountHistory.unshift(amount); if (amountHistory.length > 5) amountHistory.pop(); localStorage.setItem('kakeibo-history', JSON.stringify(amountHistory)); renderHistory();
    document.getElementById("message").style.display = "block"; clearNum(); document.getElementById("memo").value = ""; setInitialDateTime(); setTimeout(() => { document.getElementById("message").style.display = "none"; }, 3000);
  } catch (error) { await showCustomAlert("保存に失敗しました。"); }
});

// --------------------------------=========
// 📸 Gemini AI レシート解析カメラ
// --------------------------------=========
document.getElementById('receiptInput').addEventListener('change', async function(e) {
  const file = e.target.files[0]; if (!file) return;
  const overlay = document.getElementById('aiScanOverlay');
  const scannerImage = document.getElementById('scannerImage');
  overlay.style.display = 'flex';
  const reader = new FileReader();
  reader.onload = async function(event) {
    const base64String = event.target.result; scannerImage.style.backgroundImage = `url(${base64String})`;
    try {
      if (GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") throw new Error("APIキーが設定されていません。");
      const pureBase64 = base64String.split(',')[1];
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: pureBase64,
          expenseCategories: expenseCategories
        })
      });

      const parsed = await response.json();
      
      if (parsed.error) {
        throw new Error(parsed.error);
      }

      overlay.style.display = 'none';
      if (parsed.amount) animateAmountHacking(parsed.amount);
      if (parsed.store) document.getElementById("memo").value = parsed.store;
      if (parsed.category && expenseCategories.includes(parsed.category)) document.getElementById("category").value = parsed.category;
      
    } catch (error) {
      overlay.style.display = 'none'; 
      await showCustomAlert("AIスキャンに失敗したよ！\n" + error.message);
    }
  };
  reader.readAsDataURL(file);
});

function animateAmountHacking(targetAmount) {
  let ticks = 0; switchType('expense');
  const interval = setInterval(() => { currentVal = Math.floor(Math.random() * 99999).toString(); updateDisplay(); ticks++; if (ticks > 15) { clearInterval(interval); currentVal = targetAmount.toString(); updateDisplay(); } }, 50);
}
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, where, onSnapshot, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// ⚠️ Firebase Configを入れてね！
    const firebaseConfig = {
  apiKey: "AIzaSyB5UE_wkcBoBsaGo0warU40csxJAWi73-I",
  authDomain: "hybrid-kakeibo.firebaseapp.com",
  projectId: "hybrid-kakeibo",
  storageBucket: "hybrid-kakeibo.firebasestorage.app",
  messagingSenderId: "172145728222",
  appId: "1:172145728222:web:bf5c35f9764b5152b0c04f",
  measurementId: "G-5SV54CHL1W"
};

    // ⚠️② 開発者裏口キー & 💡残高ロック解除キー！
    const DEV_EMAIL = "seisuma2@gmail.com"; 
    const DEV_PASSWORD = "Seisuma2";
    const BALANCE_PASSKEY = "1111"; 
    const STEALTH_PASSKEY = "9999";  

const app = initializeApp(firebaseConfig); 
const db = getFirestore(app); 
const auth = getAuth(app);

// グローバル変数
let eTrendChart = null;
let eCategoryChart = null;
let eHomeTrendChart = null;
let eHomeCategoryChart = null;
let d3Simulation = null;
let isBalanceUnlocked = false;
let pendingTabElement = null;
let isStealthMode = true; 
let globalTransactionData = [];
let allMethodsList = new Set();
let allCategoriesList = new Set();
let stealthTargets = { methods: [], categories: [] };

// 初期設定 (一体型対応)
let methodConfigs = { 
  "現金": { type: "asset" }, 
  "ゆうちょ銀行": { type: "asset-debit" }, 
  "三菱UFJ銀行": { type: "asset-debit" }, 
  "三井住友銀行": { type: "asset-debit" }, 
  "クレジットカード": { type: "credit", linkedBank: "ゆうちょ銀行" } 
};

// ユーティリティ
function toHalfWidth(str) { 
  return str.replace(/[０-９]/g, function(s) { return String.fromCharCode(s.charCodeAt(0) - 0xFEE0); }).trim(); 
}

// --------------------------------=========
// 💡 UI・タブ・モーダル制御
// --------------------------------=========
window.switchTab = function(tabId) {
  // すべてのタブとメニューのハイライトを消す
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  // IDの名前を綺麗にする
  const baseName = tabId.replace('tab-', '').replace('nav-', '');
  
  // 対象の箱を探す
  const targetTab = document.getElementById('tab-' + baseName);
  const targetNav = document.getElementById('nav-' + baseName);

  if (targetTab) {
    targetTab.classList.add('active');
    
    // タブが開いた直後にグラフサイズを再計算
    setTimeout(() => {
      if (typeof eTrendChart !== 'undefined' && eTrendChart) eTrendChart.resize();
      if (typeof eHomeTrendChart !== 'undefined' && eHomeTrendChart) eHomeTrendChart.resize();
      if (typeof eCategoryChart !== 'undefined' && eCategoryChart) eCategoryChart.resize();
      if (typeof eHomeCategoryChart !== 'undefined' && eHomeCategoryChart) eHomeCategoryChart.resize();
      
      // 💡 超重要：もし開いたタブが「残高遊び場(payment)」だったら、バブルを描画する！
      if (baseName === 'payment') {
        if (typeof drawD3Simulation === 'function') {
          drawD3Simulation();
        }
      }
    }, 50);

  } else {
    console.error(`⚠️ エラー: HTML内に id="tab-${baseName}" の箱が見つかりません！`);
  }

  if (targetNav) targetNav.classList.add('active');
};

window.unlockBalance = function() {
  if (toHalfWidth(document.getElementById('balancePass').value) == BALANCE_PASSKEY) {
    isBalanceUnlocked = true;
    document.getElementById('balanceLockOverlay').style.display = 'none';
    document.getElementById('balancePass').value = "";
    window.switchTab('tab-balance', pendingTabElement);
  } else {
    alert("ACCESS DENIED");
    document.getElementById('balancePass').value = "";
  }
};

window.cancelBalanceUnlock = function() {
  document.getElementById('balanceLockOverlay').style.display = 'none';
  document.getElementById('balancePass').value = "";
};

document.getElementById('balancePass').addEventListener('keypress', (e) => { 
  if (e.key === 'Enter') window.unlockBalance(); 
});

// ショートカットキー制御
window.addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
    try {
      await setPersistence(auth, browserSessionPersistence);
      await signInWithEmailAndPassword(auth, DEV_EMAIL, DEV_PASSWORD);
    } catch (error) {
      alert("裏口ログイン失敗");
    }
  }
  if (e.ctrlKey && e.shiftKey && (e.key === 'x' || e.key === 'X')) {
    e.preventDefault();
    if (isStealthMode) {
      document.getElementById('stealthLockOverlay').style.display = 'flex';
      document.getElementById('stealthPass').focus();
    } else {
      isStealthMode = true;
      updateStealthBtnUI();
      renderDashboard();
    }
  }
});

// ステルスモード制御
window.unlockStealth = function() {
  if (toHalfWidth(document.getElementById('stealthPass').value) == STEALTH_PASSKEY) {
    isStealthMode = false;
    document.getElementById('stealthLockOverlay').style.display = 'none';
    document.getElementById('stealthPass').value = "";
    updateStealthBtnUI();
    renderDashboard();
  } else {
    alert("ACCESS DENIED");
    document.getElementById('stealthPass').value = "";
  }
};

window.cancelStealthUnlock = function() {
  document.getElementById('stealthLockOverlay').style.display = 'none';
  document.getElementById('stealthPass').value = "";
};

document.getElementById('stealthPass').addEventListener('keypress', (e) => { 
  if (e.key === 'Enter') window.unlockStealth(); 
});

function updateStealthBtnUI() {
  const configBtn = document.getElementById('stealthConfigBtn');
  if (isStealthMode) configBtn.style.display = 'none';
  else configBtn.style.display = 'block';
}

window.openStealthConfig = function() {
  const methodDiv = document.getElementById('configMethods');
  const catDiv = document.getElementById('configCategories');
  methodDiv.innerHTML = '';
  catDiv.innerHTML = '';
  
  [...allMethodsList].forEach(m => {
    const checked = stealthTargets.methods.includes(m) ? "checked" : "";
    methodDiv.innerHTML += `<label class="checkbox-item"><input type="checkbox" value="${m}" class="stealth-method-chk" ${checked}> ${m}</label>`;
  });
  [...allCategoriesList].forEach(c => {
    const checked = stealthTargets.categories.includes(c) ? "checked" : "";
    catDiv.innerHTML += `<label class="checkbox-item"><input type="checkbox" value="${c}" class="stealth-cat-chk" ${checked}> ${c}</label>`;
  });
  document.getElementById('stealthConfigModal').style.display = 'flex';
};

window.saveStealthConfig = async function() {
  stealthTargets.methods = Array.from(document.querySelectorAll('.stealth-method-chk:checked')).map(el => el.value);
  stealthTargets.categories = Array.from(document.querySelectorAll('.stealth-cat-chk:checked')).map(el => el.value);
  
  if (auth.currentUser) {
    await setDoc(doc(db, "user_settings", auth.currentUser.uid), { stealthTargets: stealthTargets }, { merge: true });
  }
  
  document.getElementById('stealthConfigModal').style.display = 'none';
  renderDashboard();
  await showCustomAlert("設定を保存しました！");
};

window.closeStealthConfig = function() {
  document.getElementById('stealthConfigModal').style.display = 'none';
};

// メソッド詳細モーダル
window.openMethodModal = function(methodName) {
  if(isStealthMode && stealthTargets.methods.includes(methodName)) return; 
  document.getElementById('methodModal').style.display = 'flex';
  document.getElementById('modalMethodTitle').innerText = `■ ${methodName} の詳細分析`;
  
  const filteredData = globalTransactionData.filter(d => (d.paymentMethod || "未設定") === methodName);
  const dailyIncome = {};
  const dailyExpense = {};
  
  filteredData.forEach(d => { 
    const amt = d.amount || 0; 
    const dateObj = d.date ? d.date.toDate() : new Date();
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const dayKey = `${year}/${month}/${day}`; 
    
    if (d.type === "income") { 
      dailyIncome[dayKey] = (dailyIncome[dayKey] || 0) + amt; 
    } else { 
      dailyExpense[dayKey] = (dailyExpense[dayKey] || 0) + amt; 
    } 
  });
  
  const allDays = [...new Set([...Object.keys(dailyIncome), ...Object.keys(dailyExpense)])]; 
  const sortedDays = allDays.sort(); 
  
  const incomeArr = sortedDays.map(d => dailyIncome[d] || 0);
  const expenseArr = sortedDays.map(d => dailyExpense[d] || 0);
  
  const ctx = document.getElementById('modalMethodChart').getContext('2d');
  if (window.modalChartObj) window.modalChartObj.destroy();
  
  window.modalChartObj = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedDays,
      datasets: [
        { label: '収入', data: incomeArr, backgroundColor: '#00ff66', borderRadius: 4 },
        { label: '支出', data: expenseArr, backgroundColor: '#ff3366', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, color: '#ccc',
      scales: {
        x: { grid: { color: '#252838' }, ticks: { color: '#aaa' } },
        y: { grid: { color: '#252838' }, ticks: { color: '#aaa' } }
      }
    }
  });
};

window.closeMethodModal = function() {
  document.getElementById('methodModal').style.display = 'none';
};

// --------------------------------=========
// 🔒 Auth & データ同期
// --------------------------------=========
onAuthStateChanged(auth, async (user) => {
  if (user) { 
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'flex';
    document.getElementById('userNameDisplay').innerText = `ID: ${user.email}`; 
    
    const userRef = doc(db, "user_settings", user.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.stealthTargets) stealthTargets = data.stealthTargets;
      if (data.methodConfigs) methodConfigs = data.methodConfigs;
    }
    
    // ECharts初期化
    eTrendChart = echarts.init(document.getElementById('trendChart'));
    eCategoryChart = echarts.init(document.getElementById('categoryChart'));
    eHomeTrendChart = echarts.init(document.getElementById('homeTrendChart'));
    eHomeCategoryChart = echarts.init(document.getElementById('homeCategoryChart'));
    
    startDataSync(user.uid); 
  } else { 
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('dashboardContent').style.display = 'none';
    isBalanceUnlocked = false;
    isStealthMode = true;
    updateStealthBtnUI();
    if (window.unsubscribe) window.unsubscribe(); 
  }
});

document.getElementById("pcAuthBtn").addEventListener("click", async () => {
  const email = document.getElementById("pcEmail").value;
  const password = document.getElementById("pcPassword").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch(e) {
    alert("ログインエラー: " + e.message);
  }
});

document.getElementById("pcLogout").addEventListener("click", () => signOut(auth));

function startDataSync(uid) {
  const q = query(collection(db, "transactions"), where("userId", "==", uid));
  window.unsubscribe = onSnapshot(q, (snapshot) => {
    globalTransactionData = snapshot.docs.map(doc => doc.data());
    globalTransactionData.sort((a, b) => (b.date ? b.date.toMillis() : 0) - (a.date ? a.date.toMillis() : 0));
    allMethodsList.clear();
    allCategoriesList.clear();
    globalTransactionData.forEach(d => {
      if (d.paymentMethod) allMethodsList.add(d.paymentMethod);
      if (d.category) allCategoriesList.add(d.category);
    });
    renderDashboard(); 
  });
}

// --------------------------------=========
// 📊 レンダリングロジック (BS/PLなど)
// --------------------------------=========
function renderDashboard() {
  let totalIncomeSum = 0; let totalExpenseSum = 0; let totalCapital = 0; let totalPLProfit = 0; 
  const categoriesData = {}; const dailyData = {}; const methodAssets = {}; 
  let tableHtml = "";

  // 1️⃣ BS/PL、テーブル、総資産の計算（新しい順で処理）
  globalTransactionData.forEach((data) => {
    const type = data.type || "expense";
    const amount = data.amount || 0;
    
    const dateObj = data.date ? data.date.toDate() : new Date(); 
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const dayKey = `${year}/${month}/${day}`; 
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    const dateString = `${year}/${month}/${day} ${hours}:${minutes}`;

    if (type === "transfer") {
      // 🔄 【振替処理】
      const fromAcc = data.fromAccount;
      const toAcc = data.toAccount;
      
      if (isStealthMode && stealthTargets.methods && (stealthTargets.methods.includes(fromAcc) || stealthTargets.methods.includes(toAcc))) return;

      if (fromAcc) methodAssets[fromAcc] = (methodAssets[fromAcc] || 0) - amount;
      if (toAcc) methodAssets[toAcc] = (methodAssets[toAcc] || 0) + amount;

      tableHtml += `<tr><td>${dateString}</td><td><span style="color:#ff3366;">[振替 出金]</span></td><td>資金移動</td><td><span style="color:#00bfff;">${fromAcc}</span></td><td>${data.memo || '-'}</td><td style="text-align: right; color:#ff3366; font-weight:bold;">-¥${amount.toLocaleString()}</td></tr>`;
      tableHtml += `<tr><td>${dateString}</td><td><span style="color:#00ff66;">[振替 入金]</span></td><td>資金移動</td><td><span style="color:#00bfff;">${toAcc}</span></td><td>${data.memo || '-'}</td><td style="text-align: right; color:#00ff66; font-weight:bold;">+¥${amount.toLocaleString()}</td></tr>`;

    } else {
      // 💰 【通常処理】
      const method = data.paymentMethod || "未設定";
      const category = data.category || "その他";
      const config = methodConfigs[method] || { type: "asset" };
      let targetAccount = method;
      
      const isTarget = (stealthTargets.methods || []).includes(method) || (stealthTargets.categories || []).includes(category);
      if (isStealthMode && isTarget) return; 

      if (category === "初期残高設定") {
        totalCapital += amount;
        methodAssets[targetAccount] = (methodAssets[targetAccount] || 0) + amount;
      } else {
        if (type === "income") {
          totalIncomeSum += amount;
          if(config.type !== "credit") totalPLProfit += amount;
          methodAssets[targetAccount] = (methodAssets[targetAccount] || 0) + amount;
        } else {
          totalExpenseSum += amount;
          if(config.type !== "credit") totalPLProfit -= amount;
          methodAssets[targetAccount] = (methodAssets[targetAccount] || 0) - amount;
        }
      }
      
      categoriesData[category] = (categoriesData[category] || 0) + amount;
      dailyData[dayKey] = (dailyData[dayKey] || 0) + (type === "income" ? amount : -amount);
      
      const typeBadge = type === "income" ? `<span style="color:#00ff66;">[収入]</span>` : `<span style="color:#ff3366;">[支出]</span>`;
      tableHtml += `<tr><td>${dateString}</td><td>${typeBadge}</td><td>${category}</td><td><span style="color:#00bfff;">${method}</span></td><td>${data.memo || '-'}</td><td style="text-align: right; ${type === "income" ? "color:#00ff66;" : "color:#ff3366;"} font-weight:bold;">${type === "income" ? "+" : "-"}¥${amount.toLocaleString()}</td></tr>`;
    }
  });
  
  // BS/PL UI更新
  let grandTotalAsset = 0;
  Object.keys(methodAssets).forEach(k => {
    const config = methodConfigs[k] || { type: "asset" };
    if(config.type === "asset" || config.type === "asset-debit") grandTotalAsset += methodAssets[k];
  });

  document.getElementById("homeTotalAsset").innerText = `¥${grandTotalAsset.toLocaleString()}`;
  document.getElementById("totalAsset").innerText = `¥${grandTotalAsset.toLocaleString()}`;
  document.getElementById("totalIncome").innerText = `¥${totalIncomeSum.toLocaleString()}`;
  document.getElementById("totalExpense").innerText = `¥${totalExpenseSum.toLocaleString()}`;
  document.getElementById("transactionRowsHome").innerHTML = tableHtml;

  const homePLStatus = document.getElementById("homePLStatus");
  const homePLSubText = document.getElementById("homePLSubText");
  const currentMonthNet = totalIncomeSum - totalExpenseSum;

  if (currentMonthNet >= 0) {
    homePLStatus.innerText = `+¥${currentMonthNet.toLocaleString()}`;
    homePLStatus.className = "value neon-green";
    homePLSubText.innerText = "👍 今月は黒字安全圏をキープ中！";
    homePLSubText.style.color = "#00ff66";
  } else {
    homePLStatus.innerText = `-¥${Math.abs(currentMonthNet).toLocaleString()}`;
    homePLStatus.className = "value neon-red";
    homePLSubText.innerText = "⚠️ 防衛ライン突破（赤字）。支出を警戒せよ";
    homePLSubText.style.color = "#ff3366";
  }

  const MONTHLY_BUDGET = 100000;
  const budgetPercent = Math.min(Math.floor((totalExpenseSum / MONTHLY_BUDGET) * 100), 100);
  
  document.getElementById("homeBudgetPercent").innerText = `${budgetPercent}%`;
  const budgetBar = document.getElementById("homeBudgetBar");
  budgetBar.style.width = `${budgetPercent}%`;
  
  if (budgetPercent >= 80) {
    budgetBar.style.background = "#ff3366";
    budgetBar.style.boxShadow = "0 0 10px #ff3366";
    document.getElementById("homeBudgetPercent").className = "value neon-red";
  } else {
    budgetBar.style.background = "#00bfff";
    budgetBar.style.boxShadow = "0 0 10px #00bfff";
    document.getElementById("homeBudgetPercent").className = "value neon-blue";
  }

  let assetHtml = ""; let bsAssetHtml = ""; let bsLiabilityHtml = ""; let assetTotalSum = 0; let liabilityTotalSum = 0;

  Object.keys(methodAssets).forEach(k => {
    const config = methodConfigs[k] || { type: "asset" }; 
    const bal = methodAssets[k] || 0;
    const color = bal >= 0 ? "#00ff66" : "#ff3366";
    assetHtml += `<tr class="clickable-row" onclick="openMethodModal('${k}')"><td>${k}</td><td style="text-align: right; color:${color}; font-family:monospace; font-weight:bold;">¥${bal.toLocaleString()}</td></tr>`;
    
    if (config.type === "asset" || config.type === "asset-debit") {
      assetTotalSum += bal;
      let assetBadge = `<span class="badge-bs" style="color:#00bfff; border:1px solid #00bfff;">資産</span>`;
      if (config.type === "asset-debit") assetBadge += `<span class="badge-bs" style="color:#ccff00; border:1px solid #ccff00; margin-left:4px;">デビット</span>`;
      
      bsAssetHtml += `<div style="display: flex; justify-content: space-between; margin-bottom: 12px; padding: 0 10px;"><span style="color: #ccc; font-size: 14px;">${k} ${assetBadge}</span><span style="color: #00bfff; font-family: monospace; font-size: 15px; font-weight:bold;">¥ ${bal.toLocaleString()}</span></div>`;
    } else if (config.type === "credit") {
      const liabilityVal = bal < 0 ? Math.abs(bal) : 0;
      liabilityTotalSum += liabilityVal;
      bsLiabilityHtml += `<div style="display: flex; justify-content: space-between; margin-bottom: 12px; padding: 0 10px;"><span style="color: #ccc; font-size: 14px;">${k} <span class="badge-bs" style="color:#ff3366; border:1px solid #ff3366;">負債</span></span><span style="color: #ff3366; font-family: monospace; font-size: 15px; font-weight:bold;">¥ ${liabilityVal.toLocaleString()}</span></div>`;
    }
  });

  document.getElementById("assetTableRows").innerHTML = assetHtml;
  document.getElementById("bsAssetList").innerHTML = bsAssetHtml || `<p style="color:#555; text-align:center;">資産データなし</p>`;
  document.getElementById("bsLiabilityList").innerHTML = bsLiabilityHtml || `<p style="color:#555; text-align:center;">負債データなし</p>`;
  document.getElementById("bsCapitalValue").innerText = `¥ ${totalCapital.toLocaleString()}`;
  const reColor = totalPLProfit >= 0 ? "#00ff66" : "#ff3366";
  document.getElementById("bsRetainedEarningsValue").style.color = reColor;
  document.getElementById("bsRetainedEarningsValue").innerText = `${totalPLProfit >= 0 ? "" : "-"}¥ ${Math.abs(totalPLProfit).toLocaleString()}`;
  
  const rightTotalSum = liabilityTotalSum + totalCapital + totalPLProfit;
  document.getElementById("bsAssetTotal").innerText = `¥ ${assetTotalSum.toLocaleString()}`;
  document.getElementById("bsLiabilityEquityTotal").innerText = `¥ ${rightTotalSum.toLocaleString()}`;

  // 2️⃣ 📈 グラフ用の計算エンジン（古い順に処理して累計を出す！）
  const chronologicalData = [...globalTransactionData].reverse(); 
  const chartRunningBalances = {}; // 💥名前を変えてエラーを回避！
  const dailyAccountBalances = {};
  
  Object.keys(methodConfigs).forEach(m => {
    chartRunningBalances[m] = 0;
    dailyAccountBalances[m] = {};
  });

  chronologicalData.forEach(d => {
    const type = d.type || "expense";
    const amt = d.amount || 0;
    
    const dateObj = d.date ? d.date.toDate() : new Date();
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const dateStr = `${y}/${m}/${day}`; 

    // 💥 グラフ用の計算にも振替ロジックを完全追加！
    if (type === "transfer") {
      const fromAcc = d.fromAccount;
      const toAcc = d.toAccount;
      if (isStealthMode && stealthTargets.methods && (stealthTargets.methods.includes(fromAcc) || stealthTargets.methods.includes(toAcc))) return;

      if (fromAcc && chartRunningBalances[fromAcc] !== undefined) {
        chartRunningBalances[fromAcc] -= amt;
        dailyAccountBalances[fromAcc][dateStr] = chartRunningBalances[fromAcc];
      }
      if (toAcc && chartRunningBalances[toAcc] !== undefined) {
        chartRunningBalances[toAcc] += amt;
        dailyAccountBalances[toAcc][dateStr] = chartRunningBalances[toAcc];
      }
    } else {
      const method = d.paymentMethod;
      if(!method || chartRunningBalances[method] === undefined) return;
      
      const category = d.category || "その他";
      const isTarget = (stealthTargets.methods || []).includes(method) || (stealthTargets.categories || []).includes(category);
      if (isStealthMode && isTarget) return;

      if (type === "income") chartRunningBalances[method] += amt;
      else chartRunningBalances[method] -= amt;
      
      dailyAccountBalances[method][dateStr] = chartRunningBalances[method];
    }
  });

  // グラフとカレンダーの更新！
  updateECharts(categoriesData, dailyAccountBalances);
  renderCalendar();
  
  const d3Data = {};
  Object.keys(methodAssets).forEach(key => { d3Data[key] = methodAssets[key]; });
  if (typeof drawD3Simulation === 'function') drawD3Simulation(d3Data);
}
// --------------------------------=========

// --------------------------------=========
// 📈 ECharts グラフ描画エンジン（ボタン切替 ＆ ゼロスタート完全対応版）
// --------------------------------=========
function updateECharts(categories, accountBalances) {
  // --- レーダーチャート（カテゴリ比率）の描画 ---
  const catKeys = Object.keys(categories); 
  const catValues = Object.values(categories); 
  const maxVal = Math.max(...catValues, 1000); 
  const radarIndicators = catKeys.map(k => ({ name: k, max: maxVal }));
  
  const categoryOption = { 
    backgroundColor: 'transparent', tooltip: { trigger: 'item', backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#00ff66', textStyle: { color: '#fff' } }, 
    radar: { indicator: radarIndicators.length > 0 ? radarIndicators : [{name:'データなし', max:100}], shape: 'polygon', splitNumber: 4, axisName: { color: '#00ff66', fontWeight: 'bold' }, splitLine: { lineStyle: { color: ['rgba(0, 255, 102, 0.1)', 'rgba(0, 255, 102, 0.2)', 'rgba(0, 255, 102, 0.4)', 'rgba(0, 255, 102, 0.6)'].reverse() } }, splitArea: { show: false }, axisLine: { lineStyle: { color: 'rgba(0, 255, 102, 0.5)' } } }, 
    series: [{ name: 'カテゴリ内訳', type: 'radar', data: [{ value: catValues, name: '支出・収入' }], symbol: 'circle', symbolSize: 6, itemStyle: { color: '#00ff66', borderColor: '#fff' }, lineStyle: { color: '#00ff66', width: 2, shadowColor: '#00ff66', shadowBlur: 10 }, areaStyle: { color: 'rgba(0, 255, 102, 0.3)' }, animationDuration: 1500, animationEasing: 'elasticOut' }] 
  };
  if(eCategoryChart) eCategoryChart.setOption(categoryOption); 
  const miniCatOpt = JSON.parse(JSON.stringify(categoryOption)); miniCatOpt.radar.axisName.show = false; 
  if(eHomeCategoryChart) eHomeCategoryChart.setOption(miniCatOpt);

  // --- 📈 口座別残高推移タイムライン（完全手動化 ＆ 全画面対応版） ---
 // --- 📈 口座別残高推移タイムライン（完全手動化 ＆ 全画面対応版） ---
  window.chartAccountData = accountBalances;

  // 💥 修正1：ステルスモードの口座はリストから完全に抹消する！（存在を消す）
  window.chartAccountsList = Object.keys(methodConfigs).filter(acc => {
    const isHidden = typeof isStealthMode !== 'undefined' && isStealthMode && stealthTargets.methods && stealthTargets.methods.includes(acc);
    return !isHidden; // 隠されていない口座だけを生き残らせる
  });

  // 自動切り替えのタイマーを完全に破壊
  if (window.chartInterval) clearInterval(window.chartInterval);

  // 💡 ホーム画面と収支確認画面の両方にボタンを作る関数
  function createButtons(containerId) {
    const selectorDiv = document.getElementById(containerId);
    if (!selectorDiv) return;
    selectorDiv.innerHTML = ""; 
    
    if (window.chartAccountsList.length === 0) {
      selectorDiv.innerHTML = "<span style='color:#888; font-size:12px;'>表示できる口座がありません</span>";
      return;
    }
    
    window.chartAccountsList.forEach((acc, index) => {
      const btn = document.createElement("button");
      btn.innerText = acc;
      btn.style.cssText = "background: #1a231f; border: 1px solid #00bfff; color: #00bfff; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: 0.2s;";
      
      btn.onmouseover = () => { btn.style.background = "#00bfff"; btn.style.color = "#000"; };
      btn.onmouseout = () => { 
        if(window.currentChartIndex !== index) { btn.style.background = "#1a231f"; btn.style.color = "#00bfff"; } 
      };
      
      btn.onclick = (e) => {
        e.stopPropagation();
        window.currentChartIndex = index;
        renderTrendChart(); 
      };
      selectorDiv.appendChild(btn);
    });
  }

  createButtons("bankChartSelector");       
  createButtons("trendPageBankSelector");   

  // ステルス切り替え時にインデックスがはみ出さないように調整
  if (window.currentChartIndex >= window.chartAccountsList.length) {
    window.currentChartIndex = 0;
  }

  // 手動でグラフを描画する関数
  function renderTrendChart() {
    if(!window.chartAccountsList || window.chartAccountsList.length === 0) {
      if(eHomeTrendChart) eHomeTrendChart.clear();
      if(eTrendChart) eTrendChart.clear();
      const balancesGrid = document.getElementById('trendBalancesGrid');
      if (balancesGrid) balancesGrid.innerHTML = ''; // パネルも消滅させる
      return;
    }

    const accountName = window.chartAccountsList[window.currentChartIndex];
    let dataObj = window.chartAccountData[accountName] || {};
    let dates = Object.keys(dataObj).sort();
    let balances = dates.map(d => dataObj[d]);

    // 💥 修正2：今日の日付まで「水平線」を引く（残高維持を表現）
    const todayObj = new Date();
    const ty = todayObj.getFullYear();
    const tm = String(todayObj.getMonth() + 1).padStart(2, '0');
    const td = String(todayObj.getDate()).padStart(2, '0');
    const todayStr = `${ty}/${tm}/${td}`;

    if (dates.length === 0) {
      dates = [todayStr];
      balances = [0];
    } else {
      const lastDate = dates[dates.length - 1];
      if (lastDate !== todayStr) {
        dates.push(todayStr); // グラフの末尾に「今日」を追加
        balances.push(balances[balances.length - 1]); // 最新の残高をそのまま引き継ぐ！
      }
    }

    // 両方の画面のボタンの色を更新
    ['bankChartSelector', 'trendPageBankSelector'].forEach(id => {
      const div = document.getElementById(id);
      if(div && div.children.length > 0) {
        Array.from(div.children).forEach((b, i) => {
          b.style.background = (i === window.currentChartIndex) ? "#00bfff" : "#1a231f";
          b.style.color = (i === window.currentChartIndex) ? "#000" : "#00bfff";
          b.style.fontWeight = (i === window.currentChartIndex) ? "bold" : "normal";
        });
      }
    });

    // 💥 全口座の「パッと見」現在残高パネルを生成
    // （すでにステルス口座はリストから消されているので、ここではそのまま描画するだけで完璧に隠れる！）
    const balancesGrid = document.getElementById('trendBalancesGrid');
    if (balancesGrid) {
      balancesGrid.innerHTML = '';
      window.chartAccountsList.forEach((acc, i) => {
        const accData = window.chartAccountData[acc] || {};
        const accDates = Object.keys(accData).sort();
        const latestBalance = accDates.length > 0 ? accData[accDates[accDates.length - 1]] : 0;
        
        const isSelected = (i === window.currentChartIndex);
        const bgColor = isSelected ? 'rgba(0, 191, 255, 0.1)' : '#11141a';
        const borderColor = isSelected ? '#00bfff' : '#252838';
        const textColor = isSelected ? '#00bfff' : '#fff';
        const shadow = isSelected ? 'box-shadow: 0 0 15px rgba(0,191,255,0.3);' : '';

        balancesGrid.innerHTML += `
          <div style="flex: 1; min-width: 110px; background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 8px; padding: 12px 10px; text-align: center; transition: 0.3s; ${shadow}">
            <div style="font-size: 11px; color: #aaa; margin-bottom: 5px; white-space: nowrap;">${acc}</div>
            <div style="font-size: 15px; color: ${textColor}; font-weight: bold;">¥${latestBalance.toLocaleString()}</div>
          </div>
        `;
      });
    }

    const trendOption = {
      backgroundColor: 'transparent',
      title: { text: `🏦 ${accountName} の残高推移`, left: 'center', textStyle: { color: '#00bfff', fontSize: 14 } },
      tooltip: { 
        trigger: 'axis', backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#00bfff', textStyle: { color: '#fff' },
        formatter: function(params) {
          return `${params[0].name}<br/>${accountName}残高: ¥${params[0].value.toLocaleString()}`;
        }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '25%', containLabel: true },
      xAxis: { type: 'category', data: dates, boundaryGap: true, axisLine: { lineStyle: { color: '#252838' } }, axisLabel: { color: '#aaa' } },
      yAxis: { type: 'value', boundaryGap: ['5%', '10%'], splitLine: { lineStyle: { color: '#252838' } }, axisLabel: { color: '#aaa' } },
      series: [{ 
        data: balances, type: 'line', smooth: true, symbol: 'circle', symbolSize: 8, 
        itemStyle: { color: '#00bfff', borderColor: '#fff', borderWidth: 2 }, 
        lineStyle: { width: 4, color: '#00bfff', shadowColor: '#00bfff', shadowBlur: 15, shadowOffsetY: 5 }, 
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(0, 191, 255, 0.5)' }, { offset: 1, color: 'rgba(0, 191, 255, 0.0)' }]) }, 
        animationDuration: 500, animationEasing: 'cubicOut' 
      }] 
    };
    
    const miniTrendOpt = JSON.parse(JSON.stringify(trendOption));
    miniTrendOpt.title.show = false; 
    miniTrendOpt.xAxis.show = false; 
    miniTrendOpt.yAxis.show = false; 
    miniTrendOpt.grid = { left: 0, right: 0, top: 10, bottom: 0 };
    
    if(eHomeTrendChart) eHomeTrendChart.setOption(miniTrendOpt, true); 
    if(eTrendChart) eTrendChart.setOption(trendOption, true);
    
    const homeTitle = document.querySelector("#tab-home .clickable-card h3");
    if (homeTitle) homeTitle.innerText = `📈 ${accountName} の残高推移`;
  }

  // 初回のみ手動描画を実行
  renderTrendChart();
}

  // 初回起動 ＆ ループタイマー
  cycleChart();
  window.chartInterval = setInterval(() => {
    window.currentChartIndex = (window.currentChartIndex + 1) % window.chartAccountsList.length;
    cycleChart();
  }, 8000);

  

  if (window.chartInterval) clearInterval(window.chartInterval);
  window.currentChartIndex = 0;

  // グラフ切り替えエンジン
  function cycleChart(isManual = false) {
    if(!window.chartAccountsList || window.chartAccountsList.length === 0) {
      if(eHomeTrendChart) eHomeTrendChart.clear();
      return;
    }

    const accountName = window.chartAccountsList[window.currentChartIndex];
    const dataObj = window.chartAccountData[accountName];
    const dates = Object.keys(dataObj).sort();
    const balances = dates.map(d => dataObj[d]);

    // 💡 現在表示中のボタンを光らせる
    if(selectorDiv && selectorDiv.children.length > 0) {
      Array.from(selectorDiv.children).forEach((b, i) => {
        b.style.background = (i === window.currentChartIndex) ? "#00bfff" : "#1a231f";
        b.style.color = (i === window.currentChartIndex) ? "#000" : "#00bfff";
        b.style.fontWeight = (i === window.currentChartIndex) ? "bold" : "normal";
      });
    }

    const trendOption = {
      backgroundColor: 'transparent',
      title: { text: `🏦 ${accountName} の残高推移`, left: 'center', textStyle: { color: '#00bfff', fontSize: 14 } },
      tooltip: { 
        trigger: 'axis', backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#00bfff', textStyle: { color: '#fff' },
        formatter: function(params) {
          return `${params[0].name}<br/>${accountName}残高: ¥${params[0].value.toLocaleString()}`;
        }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '25%', containLabel: true },
      xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#252838' } }, axisLabel: { color: '#aaa' } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#252838' } }, axisLabel: { color: '#aaa' } },
      series: [{ 
        data: balances, type: 'line', smooth: true, symbol: 'circle', symbolSize: 8, 
        itemStyle: { color: '#00bfff', borderColor: '#fff', borderWidth: 2 }, 
        lineStyle: { width: 4, color: '#00bfff', shadowColor: '#00bfff', shadowBlur: 15, shadowOffsetY: 5 }, 
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(0, 191, 255, 0.5)' }, { offset: 1, color: 'rgba(0, 191, 255, 0.0)' }]) }, 
        animationDuration: 500, animationEasing: 'cubicOut' 
      }] 
    };
    
    // ミニグラフ用設定
    const miniTrendOpt = JSON.parse(JSON.stringify(trendOption));
    miniTrendOpt.title.show = false; 
    miniTrendOpt.xAxis.show = false; 
    miniTrendOpt.yAxis.show = false; 
    miniTrendOpt.grid = { left: 0, right: 0, top: 10, bottom: 0 };
    if(eHomeTrendChart) eHomeTrendChart.setOption(miniTrendOpt, true); // trueで完全上書き
    if(eTrendChart) eTrendChart.setOption(trendOption, true);
    
    const homeTitle = document.querySelector("#tab-home .clickable-card h3");
    if (homeTitle) homeTitle.innerText = `📈 ${accountName} の残高推移`;

    // 💡 手動クリックされた場合は、自動タイマーをリセットして8秒後から再開させる
    if (isManual) {
      clearInterval(window.chartInterval);
      window.chartInterval = setInterval(() => {
        window.currentChartIndex = (window.currentChartIndex + 1) % window.chartAccountsList.length;
        cycleChart();
      }, 8000);
    }
  }

  // 初回描画とタイマースタート
  cycleChart();
  window.chartInterval = setInterval(() => {
    window.currentChartIndex = (window.currentChartIndex + 1) % window.chartAccountsList.length;
    cycleChart();
  }, 8000);


// --------------------------------=========
// 🎈 資産の重力場（D3.js フォースバブル - 超サイバーホログラム版）
// --------------------------------=========
function drawD3Simulation(methodAssets) {
    const paymentChartDiv = document.getElementById("paymentChart");
    if (paymentChartDiv) {
      paymentChartDiv.innerHTML = ""; 
      
      const width = paymentChartDiv.clientWidth || 800;
      const height = paymentChartDiv.clientHeight || 400;
      
      const svg = d3.select("#paymentChart")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

      // 💡 超クールな「ネオン発光フィルター」をSVG空間に定義する
      const defs = svg.append("defs");
      const filter = defs.append("filter").attr("id", "neonGlow");
      filter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "coloredBlur");
      const feMerge = filter.append("feMerge");
      feMerge.append("feMergeNode").attr("in", "coloredBlur");
      feMerge.append("feMergeNode").attr("in", "SourceGraphic");

      // 💡 ステルス機能：隠す設定の口座は「配列から完全に抹消」して存在を消す！
      const visibleAccounts = window.chartAccountsList.filter(acc => {
        const isHidden = typeof isStealthMode !== 'undefined' && isStealthMode && stealthTargets.methods && stealthTargets.methods.includes(acc);
        return !isHidden; // 隠されていない口座だけを生き残らせる
      });

      // バブル用のデータを作成
      const nodes = visibleAccounts.map(acc => {
        const accData = window.chartAccountData[acc] || {};
        const accDates = Object.keys(accData).sort();
        const bal = accDates.length > 0 ? accData[accDates[accDates.length - 1]] : 0;
        return {
          id: acc,
          value: bal,
          // 💡 バブルを少し大きめにして見栄えを強化（最低30、最大80）
          radius: Math.max(30, Math.min(80, bal / 2500 + 30))
        };
      });

      const color = d3.scaleOrdinal(d3.schemeCategory10);

      const simulation = d3.forceSimulation(nodes)
        .force("charge", d3.forceManyBody().strength(15)) // 反発力を少し強くして動きを良くする
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(d => d.radius + 8)); // ぶつかる距離を広げてスタイリッシュに

      const node = svg.append("g")
        .selectAll("g")
        .data(nodes)
        .enter().append("g")
        .call(d3.drag()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended));

      // 💡 ホログラム風の超カッコいい球体デザイン！
      node.append("circle")
        .attr("r", d => d.radius)
        .attr("fill", "#0a0c10") // 中身は宇宙空間のようなダークカラーで透けさせる
        .attr("stroke", d => color(d.id)) // 縁（フチ）をカラーリング
        .attr("stroke-width", 3) // 縁を太く
        .style("fill-opacity", 0.7) // 半透明
        .style("filter", "url(#neonGlow)") // 定義したネオンフィルターで激しく光らせる！
        // 💡 マウスを乗せると白くフラッシュするギミック
        .on("mouseover", function() { d3.select(this).attr("stroke", "#fff").attr("stroke-width", 5); })
        .on("mouseout", function(e, d) { d3.select(this).attr("stroke", color(d.id)).attr("stroke-width", 3); });

      // 口座名（ど真ん中配置 ＆ 発光テキスト）
      node.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "-0.3em")
        .text(d => d.id)
        .style("font-size", "13px")
        .style("fill", "#fff")
        .style("font-weight", "bold")
        .style("pointer-events", "none")
        .style("text-shadow", "0px 0px 5px rgba(255, 255, 255, 0.8)"); // 文字の周りに後光を射す

      // 金額（ど真ん中配置 ＆ サイバーグリーン発光）※ステルスはすでに抹消済みなのでそのまま表示！
      node.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "1.2em")
        .text(d => "¥" + d.value.toLocaleString())
        .style("font-size", "12px")
        .style("fill", "#00ff66")
        .style("font-weight", "bold")
        .style("pointer-events", "none")
        .style("text-shadow", "0px 0px 5px rgba(0, 255, 102, 0.8)");

      simulation.on("tick", () => {
        node.attr("transform", d => {
            // 画面外に飛んでいかないように壁を作る
            d.x = Math.max(d.radius, Math.min(width - d.radius, d.x));
            d.y = Math.max(d.radius, Math.min(height - d.radius, d.y));
            return `translate(${d.x},${d.y})`;
        });
      });

      function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      }
      function dragged(event, d) {
        d.fx = event.x; d.fy = event.y;
      }
      function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      }
    }
}

// --------------------------------=========
// 📅 カレンダー描画エンジン
// --------------------------------=========
let currentCalDate = new Date(); // 現在表示しているカレンダーの年月

window.changeCalendarMonth = function(offset) {
  currentCalDate.setMonth(currentCalDate.getMonth() + offset);
  renderCalendar();
};

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  if (!grid) return; 

  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  
  document.getElementById('calendarMonthYear').innerText = `${year}年 ${month + 1}月`;
  
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  let html = '';
  
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  days.forEach((d, i) => {
    const color = i === 0 ? '#ff3366' : i === 6 ? '#00bfff' : '#888'; 
    html += `<div class="calendar-header-day" style="color: ${color};">${d}</div>`;
  });
  
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="calendar-cell" style="opacity: 0.1; border: none;"></div>`;
  }
  
  const today = new Date();
  
  for (let d = 1; d <= daysInMonth; d++) {
    let dayIncome = 0;
    let dayExpense = 0;
    
    // 💡 既存の残高初期化処理のあとに動いているループを探してね
    
   globalTransactionData.forEach(tx => {
      if (!tx.date) return;
      const txDate = tx.date.toDate();
      
      if (txDate.getFullYear() === year && txDate.getMonth() === month && txDate.getDate() === d) {
        
        // 🔒 ステルスモードの強力な判定ゲート！
        const method = tx.paymentMethod || "未設定";
        const category = tx.category || "その他";
        if (isStealthMode) {
          if ((stealthTargets.methods || []).includes(method) || (stealthTargets.categories || []).includes(category)) {
            return; // 👈 ステルス対象なら、この日の合計金額には一切足さずにスキップ！
          }
        }

        // 振替は無視して、純粋な収入と支出だけをカレンダーに足す
        if (tx.type === 'income') dayIncome += (tx.amount || 0);
        else if (tx.type === 'expense') dayExpense += (tx.amount || 0);
      }
    });
    // 💡 さっき消えちゃってたのはここ！今日かどうかの判定
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    const todayClass = isToday ? 'today' : '';
    
    let amountHtml = '';
    if (dayIncome > 0) amountHtml += `<div class="cal-income">+¥${dayIncome.toLocaleString()}</div>`;
    if (dayExpense > 0) amountHtml += `<div class="cal-expense">-¥${dayExpense.toLocaleString()}</div>`;
    
    // 💡 ポップアップを開くクリック機能付き！
    html += `
      <div class="calendar-cell ${todayClass}" onclick="openDayDetailModal(${year}, ${month}, ${d})">
        <div class="calendar-date">${d}</div>
        <div style="flex:1;"></div>
        ${amountHtml}
      </div>
    `;
  }
  
  grid.innerHTML = html;
}


// --------------------------------=========
// 🔓 日別明細ポップアップの制御
// --------------------------------=========
window.openDayDetailModal = function(year, month, day) {
  document.getElementById('dayDetailTitle').innerText = `📅 ${year}年 ${month + 1}月 ${day}日の明細`;
  const rowsContainer = document.getElementById('dayDetailRows');
  rowsContainer.innerHTML = ''; // 一旦リセット

  let hasData = false;

  

  if (!hasData) {
    rowsContainer.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#555; padding: 20px 0; font-size:12px;">この日の取引履歴はありません。</td></tr>`;
  }

  // モーダルを表示
  const modal = document.getElementById("dayDetailModal");
  modal.style.display = "flex";
  setTimeout(() => modal.classList.add("open"), 10);
};

window.closeDayDetailModal = function(e) {
  if (e === null || e.target === document.getElementById("dayDetailModal")) {
    const modal = document.getElementById("dayDetailModal");
    modal.classList.remove("open");
    setTimeout(() => modal.style.display = "none", 300);
  }
};
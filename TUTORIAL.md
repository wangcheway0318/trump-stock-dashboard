# 完整部署教學（新手版）

從零到網站上線，預計 30~60 分鐘。我會把每一步拆得很細，跟著做就好。

---

## 第 0 步：先看看你拿到了什麼

打開 `trump-stock-dashboard` 資料夾，你會看到：

```
trump-stock-dashboard/
├── index.html               ← 網站主頁面（包含所有 UI 與前端邏輯）
├── netlify.toml             ← Netlify 部署設定
├── package.json             ← 專案描述（給 Netlify 看）
├── .gitignore               ← 告訴 Git 哪些檔案不用上傳
├── netlify/
│   └── functions/
│       ├── trump-posts.js               ← 後端：抓 Trump 推文
│       ├── institutional-investors.js   ← 後端：抓三大法人
│       └── stock-news.js                ← 後端：抓股市新聞
└── TUTORIAL.md              ← 這份教學（你正在看）
```

**先不用懂這些檔案在做什麼。** 我們先讓網站上線，之後你想學再回頭看。

---

## 第 1 步：註冊三個免費帳號

部署這個網站需要兩個服務（GitHub 存程式碼、Netlify 部署網站），總共三個帳號：

### 1-1. 註冊 GitHub

1. 開瀏覽器到 [https://github.com/signup](https://github.com/signup)
2. 用 email 註冊（建議用你常用的 email，方便記住）
3. 收驗證信、輸入驗證碼
4. 跳過所有問卷（直接點 Skip 或 Continue）

### 1-2. 註冊 Netlify

1. 到 [https://app.netlify.com/signup](https://app.netlify.com/signup)
2. **直接點「Sign up with GitHub」**（重要：用 GitHub 帳號登入，會省掉之後一堆設定）
3. 同意授權

完成後你會看到 Netlify 的儀表板。

---

## 第 2 步：把專案上傳到 GitHub

這一步最容易卡住，我提供兩種方法，**選一種你覺得簡單的**就好。

### 方法 A：用 GitHub 網頁直接拖拉（最簡單，推薦新手）

1. 到 GitHub 點右上角 `+` → `New repository`
2. Repository name 填：`trump-stock-dashboard`
3. 選 **Public**（免費版必須是 Public）
4. **不要**勾「Add README」、「Add .gitignore」
5. 按 `Create repository`
6. 在新頁面找到 **「uploading an existing file」** 連結（藍字），點下去
7. **把整個 `trump-stock-dashboard` 資料夾裡的東西**（注意：是裡面的東西，不是資料夾本身）拖到上傳區
   - 包含 `index.html`、`netlify.toml`、`package.json`、`.gitignore`、整個 `netlify` 子資料夾
8. 下方按 `Commit changes`

> ⚠️ **常見問題**：拖完後沒看到 `netlify/functions/*.js` 檔案？
> 可能是瀏覽器把資料夾上傳「攤平」了，這樣會壞掉。改用方法 B，或先用 Mac 內建的「壓縮」功能把資料夾壓成 zip，傳上去後 GitHub 會自動解壓。

### 方法 B：用 GitHub Desktop App（更穩，推薦長期使用）

1. 下載 [GitHub Desktop](https://desktop.github.com/)
2. 安裝後用你的 GitHub 帳號登入
3. 選單 `File` → `Add local repository`，選 `trump-stock-dashboard` 資料夾
4. 它會問你「This directory does not appear to be a Git repository. Would you like to create a repository here instead?」→ 點 **Create a repository**
5. 確認 Name 是 `trump-stock-dashboard`，按 `Create repository`
6. 左下角輸入 commit message 寫 `Initial commit`，按 `Commit to main`
7. 上方按 `Publish repository`，**取消勾選 Keep this code private**，按 `Publish repository`

完成後到 [https://github.com/](https://github.com/) → 點頭像 → Your repositories，應該能看到剛上傳的專案。

---

## 第 3 步：用 Netlify 部署

1. 回到 [https://app.netlify.com/](https://app.netlify.com/)
2. 點 **Add new site** → **Import an existing project**
3. 選 **Deploy with GitHub**（如果跳出授權視窗，選 All repositories 或只授權這個專案都行）
4. 在清單中選 `trump-stock-dashboard`
5. 看到部署設定畫面，**全部維持預設**（因為 `netlify.toml` 已經幫你設定好了）：
   - Branch: `main`
   - Build command: 留空或 `echo build`
   - Publish directory: `.`（一個點）
6. 點 **Deploy trump-stock-dashboard**

接下來會看到 Netlify 跑部署。約 1~2 分鐘後會看到綠色的 **「Published」**。

---

## 第 4 步：打開你的網站

1. 在 Netlify 專案頁面上方會看到一個網址，類似 `https://random-name-12345.netlify.app/`
2. 點下去 → 你的網站就上線了

打開後第一次載入可能要 5~10 秒（後端在喚醒），之後就會很快。

> 💡 想換個漂亮的網址（例如 `wayne-dashboard.netlify.app`）？
> 點左側 **Site configuration** → **Change site name**，輸入你想要的名字。

---

## 第 5 步：驗證功能

打開網站後檢查：

- ✅ 頁面分成三欄（Trump、三大法人、新聞）
- ✅ 右上角有時鐘 + 「台股盤中／休市」狀態
- ✅ 手機開啟會看到上方有 Tab 切換
- ✅ 等 5~10 秒，三個欄位的「載入中」骨架圖會被實際資料取代

如果某一欄一直顯示「載入失敗」或「暫無資料」：
- **Trump 那欄空白**：Truth Social 的 API 偶爾會擋伺服器請求。先等幾分鐘再試，或參考下方「疑難排解」。
- **三大法人那欄寫「尚無當日資料」**：表示今天是假日 / 還沒開盤。盤後 15:00 之後就會有資料。
- **新聞那欄空白**：通常是鉅亨網 API 暫時不通，重新整理試試。

---

## 第 6 步：之後要怎麼修改？

只要你之前有把專案連到 GitHub，**修改流程超簡單**：

### 改文字 / 顏色 / 樣式

1. 用 [VS Code](https://code.visualstudio.com/)（免費的編輯器）打開專案資料夾
2. 改 `index.html`（所有 UI 都在這個檔）
3. 存檔
4. 開 GitHub Desktop → 看到下方有變更的紅綠標示 → 寫一句 commit message 例如「改首頁顏色」→ `Commit to main` → 右上 `Push origin`
5. **Netlify 會自動偵測 GitHub 有更新，1~2 分鐘自動重新部署**

完全不用重新走 Netlify 的流程，這就是 Git 連動部署的好處。

### 想試 AI 改網站？

把 `index.html` 整份貼給我（或任何 AI 助手），告訴我你想改什麼（「把背景改白色」、「加一欄美股資料」），我可以給你修改後的完整檔案。

---

## 自訂功能小抄

| 想做的事 | 改哪個檔案 | 改哪一行 |
| --- | --- | --- |
| 改網站標題 | `index.html` | 找 `<title>` 跟 `<h1>` |
| 換顏色配色 | `index.html` | 找 `tailwind.config` 區塊 |
| 換新聞來源 | `netlify/functions/stock-news.js` | 改 `CNYES_API` 那一行 |
| 改 Trump 換成別人 | `netlify/functions/trump-posts.js` | 改 `TRUMP_ID`（要先在 Truth Social 找到對方帳號 ID） |
| 改更新頻率 | `index.html` | 找 `schedulePolling` 函式 |
| 加你自己的網域 | Netlify 後台 | Site configuration → Domain management |

---

## 疑難排解

### Q1：Trump 那欄一直空白

Truth Social 的 API 沒有正式公開文件，偶爾會擋掉雲端 IP 的請求。如果穩定不通，有三個替代方案：

**方案 A：改用新聞 API 抓「Trump 相關新聞」**
最穩定。請我幫你把 `trump-posts.js` 換成 NewsAPI 或 GNews 的版本。

**方案 B：嵌入 Truth Social 官方 widget**
在 `index.html` 把 Trump 那一區塊改成 `<iframe>` 嵌入 [https://truthsocial.com/@realDonaldTrump/embed](https://truthsocial.com/@realDonaldTrump/embed)。

**方案 C：用第三方鏡像服務**
例如 trumpstruth.org 有公開的網頁可以解析。

跟我說哪個方案你想試，我直接給你改好的程式碼。

### Q2：Netlify 部署失敗（紅色 Failed）

點進那次部署 → 看 **Deploy log**，最常見的錯誤：

- `Module not found` → 通常是 `netlify/functions/` 資料夾沒上傳完整。回 GitHub 確認三個 `.js` 檔都在。
- `Function timeout` → 後端 API 太慢，重新部署一次通常會好。

### Q3：手機看版面跑掉

可能是瀏覽器快取舊版。試試：
- iPhone Safari：設定 → Safari → 清除歷史記錄與網站資料
- 或在瀏覽器網址後加 `?v=2` 強制重新載入

### Q4：想要自訂網域（例如 `dashboard.你的名字.com`）

1. 先到 [Cloudflare](https://www.cloudflare.com/)、Google Domains、GoDaddy 買網域（年費約 NT$300~500）
2. Netlify 後台 → Domain management → Add custom domain
3. 照畫面提示把網域的 DNS 指到 Netlify（通常加兩筆 CNAME 紀錄）
4. Netlify 會自動幫你申請 SSL 憑證（免費），完成後 https 就會通

---

## 預期費用

整個方案的成本：

| 項目 | 費用 |
| --- | --- |
| GitHub 帳號 | 免費 |
| Netlify 部署 + Functions（每月 125,000 次以內） | 免費 |
| Truth Social 公開 API | 免費 |
| 證交所三大法人 API | 免費 |
| 鉅亨網新聞 API | 免費 |
| 自訂網域（選用） | 約 NT$300~500/年 |

**完全不用付任何月費**，除非你的網站每天有破萬訪客（不太可能 😄）。

---

## 下一步可以做什麼？

當你熟悉了這個專案後，可以加上：

- 加美股三大指數（道瓊、那斯達克、S&P 500）
- 加台幣匯率走勢
- 加 Trump 推文的關鍵字過濾（例如只顯示提到 China / Tariff 的）
- 加深色 / 淺色主題切換按鈕
- 加把 Trump 推文翻成中文的功能（用 OpenAI 或 Anthropic API）

想加任何功能，把你的需求告訴我，我都可以接著幫你做。
